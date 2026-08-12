import type { Restaurant } from '@/types';
import {
  applyGoalPatch,
  clarificationNeedToPendingQuestion,
  createActionRecord,
  runSupervisorPlanner,
  summarizeAction,
} from './supervisorPlanner';
import { evaluateSearchResult, mergeCandidates } from './evaluator';
import { applyHardConstraintGuard, applyVerdictGuard } from './guards';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import { createTurnLogger } from './turnLogger';
import { summarizeTurnMetrics, type MetricsSink } from './metrics';
import { describeFinish, internalFinishNote, type FinishReason } from './finishReason';
import {
  buildDegradedGoalFromQuery,
  buildEmptyDegradedGoal,
  DEGRADED_CLARIFYING_QUESTION,
  DEGRADED_GOAL_NOTICE,
} from './degraded';
import { isSearchIntentAuthorizedForPrimary } from './authorization';
import {
  buildNoPrimaryQuestion,
  buildPostAuthorizationNoPrimaryQuestion,
  inferPoiTypesForGoalKeyword,
  buildSearchPlan,
  createPlanId,
  distinctPrimaryBrandCount,
  getStrictDistanceMaxMeters,
  hasPrimaryCandidates,
  hasTriedIntent,
  hasTriedPlan,
  nextUntriedTarget,
  questionAsksForBroadenAuthorization,
  resolveSearchActionPoiType,
  untriedTargets,
} from './policy';
import {
  hasPromotedBroadenedPrimaryCandidates,
  promoteAuthorizedBroadenedResults,
} from './broadenAdmission';
import { SearchPlanSchema } from './schemas/plan';
import { finalizeRecommendations } from './resultAssembler';
import { DEFAULT_POI_TYPE, isGenericSearchKeyword, normalizeSearchKeywords } from './poiTaxonomy';
import { applyKeywordExpansion, runKeywordExpansionAgent } from './subagents/keywordExpansionAgent';
import { runEvaluationAgent, type EvaluationAgentInput } from './subagents/evaluationAgent';
import {
  deriveContextInvalidationPlan,
  deriveGoalSignature,
  markStaleCandidatesForContext,
  withUpdatedGoalVersion,
} from './goalVersion';
import type { ContextInvalidationPlan } from './goalVersion';
import { AgentRunError } from './types';
import type {
  AgentAction,
  AgentContext,
  AgentErrorCode,
  AgentFinalResult,
  AgentInput,
  AgentObservation,
  AgentRuntimeState,
  AgentTraceItem,
  CandidateVerdict,
  ConversationMode,
  EmitAgentEvent,
  EvaluationAgentOutput,
  GoalPatch,
  GuardrailDecision,
  GuardrailViolation,
  PendingQuestion,
  RestaurantCandidate,
  SearchKeywordTarget,
  SearchPlan,
  UserGoal,
} from './types';

interface AgentV3Context extends AgentContext {
  actions: NonNullable<AgentRuntimeState['actions']>;
  observations: NonNullable<AgentRuntimeState['observations']>;
  trace: AgentTraceItem[];
  turnId: string;
  maxActions: number;
}

interface SearchStateResetPlan {
  clearAttempts: boolean;
  clearCandidates: boolean;
  clearActionHistory: boolean;
  clearObservations: boolean;
  reason?: string;
}

const DEFAULT_AGENT_MAX_SEARCH_CALLS = parsePositiveInt(process.env.AGENT_MAX_SEARCH_CALLS, 4);
const DEFAULT_AGENT_EVALUATION_BUFFER = parsePositiveInt(process.env.AGENT_EVALUATION_BUFFER, 4);
const DEFAULT_AGENT_EVALUATION_BATCH_SIZE = parsePositiveInt(process.env.AGENT_EVALUATION_BATCH_SIZE, 6);
const DEFAULT_AGENT_EVALUATION_CONCURRENCY = parsePositiveInt(process.env.AGENT_EVALUATION_CONCURRENCY, 2);
const CONFIGURED_AGENT_EVALUATION_LIMIT = parseOptionalPositiveInt(process.env.AGENT_EVALUATION_LIMIT);
const MAX_HARD_REJECTED_REASON_DETAILS = 6;
const MAX_HARD_REJECTED_OBSERVATIONS = 20;
/** 并行搜索开关：关闭时一次 action 只执行一个计划，行为与串行完全一致。 */
const AGENT_PARALLEL_SEARCH = process.env.AGENT_PARALLEL_SEARCH === 'true';
const AGENT_SEARCH_CONCURRENCY = parsePositiveInt(process.env.AGENT_SEARCH_CONCURRENCY, 3);

/**
 * 执行一轮 Agent 搜索。
 *
 * 失败时抛出 {@link AgentRunError}，其中携带失败前的运行状态，
 * 供 route 层把这一轮的 trace 落库——失败路径与成功路径同等留痕。
 */
export async function runSearchAgentV3(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  const contextRef: { current?: AgentV3Context } = {};

  try {
    return await runAgentTurn(input, emit, searchPlaces, contextRef);
  } catch (error) {
    if (error instanceof AgentRunError) {
      throw error;
    }

    const code = toAgentErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    const context = contextRef.current;

    if (context) {
      appendTrace(context, 'error', {
        error: { code, message, retryable: isRetryableAgentError(code) },
      });
      throw new AgentRunError(message, code, snapshotRuntimeState(context), error);
    }

    throw new AgentRunError(message, code, undefined, error);
  }
}

async function runAgentTurn(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  contextRef: { current?: AgentV3Context }
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: '正在分析您的需求...' });

  // context 要等目标解析完才能构造，先用独立容器收集这一阶段的模型指标。
  const turnMetrics: MetricsSink = {};
  const resolution = await resolveTurnGoal(input, turnMetrics);
  const supervisorOutput = resolution.supervisorOutput;
  const conversationMode = resolution.conversationMode;
  const baseGoal = withUpdatedGoalVersion(
    resolution.goal,
    conversationMode === 'start_new_goal' ? undefined : input.runtimeState?.goal
  );

  if (resolution.degraded) {
    emit({ type: 'status', message: DEGRADED_GOAL_NOTICE });
  }

  const invalidationPlan = deriveContextInvalidationPlan(
    input.runtimeState?.goal,
    baseGoal,
    input.previousLocation,
    input.location
  );
  const resetPlan = deriveSearchStateResetPlan(invalidationPlan, conversationMode);
  let goal = baseGoal;
  if (!supervisorOutput?.question && baseGoal.clarificationNeeded.length === 0) {
    emit({ type: 'status', message: '正在联想相关搜索词...' });
    goal = applyKeywordExpansion(
      baseGoal,
      await runKeywordExpansionAgent({
        metricsSink: turnMetrics,
        goal: baseGoal,
        attempts: resetPlan.clearAttempts ? [] : (input.runtimeState?.attempts ?? []),
        preferenceSummary: input.preferenceSummary,
      })
    );
  }
  const context = createInitialContext(input, goal, resetPlan);
  context.modelCallMetrics = turnMetrics.modelCallMetrics ?? [];
  contextRef.current = context;
  if (resolution.degraded) {
    appendTrace(context, 'error', { error: resolution.degraded });
  }
  appendTrace(context, 'user_message', {
    input: {
      message: input.query,
      location: input.location,
    },
  });
  appendTrace(context, 'model_goal', {
    input: {
      message: input.query,
      previousGoal: input.runtimeState?.goal,
      pendingQuestion: input.runtimeState?.pendingQuestion,
    },
    output: {
      supervisorOutput,
      conversationMode,
      invalidationPlan,
      resetPlan,
    },
  });
  const clarifyingQuestion = resolution.clarifyingQuestion
    ?? supervisorOutput?.question
    ?? getInitialClarifyingQuestion(goal);

  if (clarifyingQuestion) {
    const action: AgentAction = { type: 'ask_user', question: clarifyingQuestion };
    appendAction(context, action, emit);
    return buildPausedResult(context, clarifyingQuestion);
  }

  const promotion = promoteAuthorizedBroadenedResults(context);
  if (
    promotion.promotedCandidates > 0
    || hasPromotedBroadenedPrimaryCandidates(context)
  ) {
    const action = buildFinishAction(context, 'BROADEN_PROMOTION', 0.66);
    appendAction(context, action, emit);
    return finish(context, action, emit);
  }

  while (context.actions.length < context.maxActions) {
    const guarded = await resolveGuardedAction(input, context);
    const actionRecord = appendAction(context, guarded.action, emit);

    emitGuardrailMessages(guarded.messages, actionRecord.id, emit);

    if (guarded.action.type === 'ask_user') {
      return buildPausedResult(context, guarded.action.question);
    }

    if (guarded.action.type === 'finish') {
      return finish(context, guarded.action, emit);
    }

    const observations = await executeSearchBatch(
      actionRecord.id,
      planParallelBatch(context, guarded.action.plan),
      context,
      searchPlaces,
      emit
    );

    for (const observation of observations) {
      context.observations.push(observation);
      emit({
        type: 'observation',
        actionId: observation.actionId,
        traceId: observation.traceId,
        found: observation.rawCount,
        accepted: observation.acceptedPrimaryIds.length,
        rejected: observation.hardRejected.length,
      });
    }

    if (context.attempts.length >= context.maxSearchCalls) {
      const fallback: AgentAction = hasPrimaryCandidates(context)
        ? buildFinishAction(context, 'SEARCH_BUDGET_EXHAUSTED', 0.62)
        : { type: 'ask_user', question: buildNoPrimaryQuestion(context) };
      const decisionTrace = appendTrace(context, 'runtime_decision', {
        output: {
          reason: 'search_budget_exhausted',
          action: fallback,
          attempts: context.attempts.length,
          maxSearchCalls: context.maxSearchCalls,
        },
      });
      const fallbackRecord = appendAction(context, fallback, emit);
      emit({
        type: 'guardrail',
        actionId: fallbackRecord.id,
        traceId: decisionTrace.id,
        message: '已达到本轮搜索动作上限，Runtime 强制进入结束或追问。',
        severity: 'warn',
      });

      if (fallback.type === 'ask_user') {
        return buildPausedResult(context, fallback.question);
      }

      return finish(context, fallback, emit);
    }
  }

  const forcedFinish = buildFinishAction(context, 'ACTION_BUDGET_EXHAUSTED', 0.6, false);
  appendTrace(context, 'runtime_decision', {
    output: {
      reason: 'action_budget_exhausted',
      action: forcedFinish,
      actions: context.actions.length,
      maxActions: context.maxActions,
    },
  });
  return finish(context, forcedFinish, emit);
}

/**
 * 构造一个内部 finish 动作。
 *
 * 用户可见文案由 reason 决定（describeFinish），explanation 只进 trace。
 */
function buildFinishAction(
  context: AgentV3Context,
  reason: FinishReason,
  confidence: number,
  withSelectedIds = true
): Extract<AgentAction, { type: 'finish' }> {
  return {
    type: 'finish',
    reason,
    selectedIds: withSelectedIds
      ? context.candidates
          .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
          .map((candidate) => candidate.restaurant.id)
      : undefined,
    explanation: internalFinishNote(reason),
    confidence,
  };
}

interface TurnGoalResolution {
  goal: UserGoal;
  conversationMode: ConversationMode;
  supervisorOutput: Awaited<ReturnType<typeof runSupervisorPlanner>> | null;
  degraded?: { code: AgentErrorCode; message: string; retryable: boolean };
  clarifyingQuestion?: PendingQuestion;
}

/**
 * 解析本轮目标。
 *
 * Supervisor 不可用时降级为"按原文关键词搜索"，抽不出关键词则转为追问，
 * 而不是让整轮请求失败——这是入口唯一没有降级路径的历史缺口。
 */
async function resolveTurnGoal(
  input: AgentInput,
  metricsSink: MetricsSink
): Promise<TurnGoalResolution> {
  try {
    const supervisorOutput = await getSupervisorPlannerOutput(input, metricsSink);
    return {
      goal: resolveSupervisorGoal(input, supervisorOutput),
      conversationMode: inferRuntimeConversationMode(input, supervisorOutput),
      supervisorOutput,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    createTurnLogger(input.sessionId).warn(
      'SupervisorPlannerAgent unavailable, falling back to raw query search',
      { error: message }
    );

    const degraded = {
      code: 'SUPERVISOR_UNAVAILABLE' as const,
      message,
      retryable: true,
    };
    const degradedGoal = buildDegradedGoalFromQuery(input.query);

    if (degradedGoal) {
      return {
        goal: degradedGoal,
        conversationMode: 'start_new_goal',
        supervisorOutput: null,
        degraded,
      };
    }

    return {
      goal: buildEmptyDegradedGoal(input.query),
      conversationMode: 'start_new_goal',
      supervisorOutput: null,
      degraded,
      clarifyingQuestion: { ...DEGRADED_CLARIFYING_QUESTION },
    };
  }
}

function toAgentErrorCode(error: unknown): AgentErrorCode {
  const message = error instanceof Error ? error.message : String(error);

  if (/OPENAI_API_KEY|AMAP_API_KEY|is required/i.test(message)) {
    return 'CONFIG_MISSING';
  }

  if (/429|rate\s*limit|too many requests/i.test(message)) {
    return 'RATE_LIMITED';
  }

  if (/SupervisorPlannerAgent/i.test(message)) {
    return 'SUPERVISOR_UNAVAILABLE';
  }

  if (/EvaluationAgent/i.test(message)) {
    return 'EVALUATION_FAILED';
  }

  if (/amap|osm|搜索超时|poi/i.test(message)) {
    return 'SEARCH_PROVIDER_FAILED';
  }

  return 'UNKNOWN';
}

function isRetryableAgentError(code: AgentErrorCode): boolean {
  return code !== 'CONFIG_MISSING' && code !== 'SESSION_EXPIRED';
}

function resolveSupervisorGoal(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSupervisorPlanner>>
): UserGoal {
  if (output.goal) {
    return output.goal;
  }

  if (output.patch && input.runtimeState?.goal) {
    return applyGoalPatch(
      input.runtimeState.goal,
      output.patch,
      patchedRawQuery(input.runtimeState.goal, output.patch, input.query)
    );
  }

  throw new Error('SupervisorPlannerAgent returned no goal or patch');
}

async function getSupervisorPlannerOutput(
  input: AgentInput,
  metricsSink: MetricsSink
): Promise<Awaited<ReturnType<typeof runSupervisorPlanner>>> {
  return runSupervisorPlanner({
    metricsSink,
    message: input.query,
    previousGoal: input.runtimeState?.goal,
    pendingQuestion: input.runtimeState?.pendingQuestion,
    messages: input.messages,
    preferenceSummary: input.preferenceSummary,
    attempts: input.runtimeState?.attempts,
  });
}

function inferRuntimeConversationMode(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSupervisorPlanner>>
): ConversationMode {
  if (!input.runtimeState?.goal) {
    return 'start_new_goal';
  }

  if (output.patch) {
    return 'patch_current_goal';
  }

  if (output.conversationMode) {
    return output.conversationMode;
  }

  if (!output.goal) {
    return 'continue_current_goal';
  }

  if (primaryTargetSignature(input.runtimeState.goal) !== primaryTargetSignature(output.goal)) {
    return 'start_new_goal';
  }

  return deriveGoalSignature(input.runtimeState.goal) === deriveGoalSignature(output.goal)
    ? 'continue_current_goal'
    : 'patch_current_goal';
}

function deriveSearchStateResetPlan(
  invalidationPlan: ContextInvalidationPlan,
  conversationMode: ConversationMode
): SearchStateResetPlan {
  if (conversationMode === 'start_new_goal') {
    return {
      clearAttempts: true,
      clearCandidates: true,
      clearActionHistory: true,
      clearObservations: true,
      reason: 'start_new_goal',
    };
  }

  if (invalidationPlan.primaryTargetChanged) {
    return {
      clearAttempts: true,
      clearCandidates: true,
      clearActionHistory: true,
      clearObservations: true,
      reason: 'primary_target_changed',
    };
  }

  if (
    invalidationPlan.hardConstraintsChanged
    || invalidationPlan.exclusionsChanged
    || invalidationPlan.locationChanged
  ) {
    return {
      clearAttempts: true,
      clearCandidates: false,
      clearActionHistory: true,
      clearObservations: true,
      reason: invalidationPlan.reasons[0] ?? 'context_changed',
    };
  }

  return {
    clearAttempts: false,
    clearCandidates: false,
    clearActionHistory: false,
    clearObservations: false,
  };
}

function createInitialContext(input: AgentInput, goal: UserGoal, resetPlan: SearchStateResetPlan): AgentV3Context {
  const previousAttempts = resetPlan.clearAttempts ? [] : (input.runtimeState?.attempts ?? []);
  const hydratedGoal = hydrateGoalSearchTargets(goal);
  const previousCandidates = resetPlan.clearCandidates
    ? []
    : markStaleCandidatesForContext(input.runtimeState?.candidates ?? [], hydratedGoal, input.location);

  return {
    ...input,
    goal: hydratedGoal,
    attempts: [...previousAttempts],
    candidates: previousCandidates,
    actions: resetPlan.clearActionHistory ? [] : [...(input.runtimeState?.actions ?? [])],
    observations: resetPlan.clearObservations ? [] : [...(input.runtimeState?.observations ?? [])],
    trace: [...(input.runtimeState?.trace ?? [])],
    turnId: createTraceId('turn'),
    unmetConstraints: [],
    maxSteps: 8,
    maxActions: (resetPlan.clearActionHistory ? 0 : (input.runtimeState?.actions?.length ?? 0)) + 8,
    maxSearchCalls: previousAttempts.length + DEFAULT_AGENT_MAX_SEARCH_CALLS,
    targetCount: 8,
  };
}

function buildSupervisorPlannerActionInput(
  input: AgentInput,
  context: AgentV3Context,
  rewriteInstruction?: string
) {
  return {
    message: input.query,
    goal: context.goal,
    messages: input.messages ?? [],
    attempts: context.attempts,
    observations: context.observations,
    candidates: context.candidates,
    preferenceSummary: context.preferenceSummary,
    rewriteInstruction,
    limits: {
      maxSearchCalls: context.maxSearchCalls,
      remainingSearchCalls: Math.max(0, context.maxSearchCalls - context.attempts.length),
      targetCount: context.targetCount,
    },
  };
}

async function getSupervisorPlannerAction(
  plannerInput: ReturnType<typeof buildSupervisorPlannerActionInput>,
  context: AgentV3Context
): Promise<AgentAction> {
  const output = await runSupervisorPlanner(plannerInput, context);
  if (!output.action) {
    throw new Error('SupervisorPlannerAgent returned no action');
  }

  return output.action;
}

function hydrateGoalSearchTargets(goal: UserGoal): UserGoal {
  return {
    ...goal,
    relatedTargets: (goal.relatedTargets?.length ?? 0) > 0
      ? goal.relatedTargets
      : goal.relatedKeywords.map((keyword) => buildGoalSearchTarget(goal, keyword)),
    broadenedTargets: (goal.broadenedTargets?.length ?? 0) > 0
      ? goal.broadenedTargets
      : goal.broadenedKeywords.map((keyword) => buildGoalSearchTarget(goal, keyword)),
  };
}

function buildGoalSearchTarget(goal: UserGoal, keyword: string): SearchKeywordTarget {
  return {
    keyword,
    poiTypes: inferPoiTypesForGoalKeyword(goal, keyword)?.split('|'),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function patchedRawQuery(goal: UserGoal, patch: GoalPatch, message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return goal.rawQuery;
  }

  if (
    (patch.replacePrimaryKeywords || patch.replaceRequestedItems || patch.replaceCategories)
    && replacementTargetsComeFromMessage(patch, trimmed)
  ) {
    return trimmed;
  }

  return goal.rawQuery.includes(trimmed) ? goal.rawQuery : `${goal.rawQuery}，${trimmed}`;
}

function replacementTargetsComeFromMessage(patch: GoalPatch, message: string): boolean {
  const replacementTargets = [
    ...(patch.replacePrimaryKeywords ?? []),
    ...(patch.replaceRequestedItems ?? []).map((item) => item.name),
    ...(patch.replaceCategories ?? []).map((category) => category.name),
  ].filter(Boolean);

  if (replacementTargets.length === 0) {
    return true;
  }

  const normalizedMessageTargets = normalizeSearchKeywords([message])
    .filter((keyword) => !isGenericSearchKeyword(keyword));
  const messageTargetSet = new Set([message.trim(), ...normalizedMessageTargets]);

  return replacementTargets.every((target) => messageTargetSet.has(target));
}

function primaryTargetSignature(goal: UserGoal): string {
  return Array.from(new Set([
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].map((item) => item.trim()).filter(Boolean))).sort().join('|');
}

function getInitialClarifyingQuestion(goal: UserGoal): PendingQuestion | null {
  const clarificationNeed = goal.clarificationNeeded[0];
  return clarificationNeed ? clarificationNeedToPendingQuestion(clarificationNeed) : null;
}

interface GuardedActionResolution {
  action: AgentAction;
  messages: GuardrailMessage[];
}

interface GuardrailMessage {
  message: string;
  severity: 'info' | 'warn';
  traceId?: string;
}

async function resolveGuardedAction(
  input: AgentInput,
  context: AgentV3Context
): Promise<GuardedActionResolution> {
  const rawAction = await getSupervisorPlannerAction(
    buildSupervisorPlannerActionInput(input, context),
    context
  );
  appendTrace(context, 'model_action', { rawAction });

  const decision = await guardAction(rawAction, context);
  const decisionTrace = appendTrace(context, 'guard_decision', {
    rawAction,
    guardedAction: actionFromGuardDecision(decision),
    guardDecision: decision,
  });

  if (decision.type === 'allow') {
    return {
      action: decision.action,
      messages: messagesFromGuardDecision(decision, decisionTrace.id),
    };
  }

  if (decision.type === 'reject') {
    const fallback = fallbackActionForGuardDecision(decision, context)
      ?? buildNoPrimaryQuestionAction(context);
    appendTrace(context, 'runtime_decision', {
      rawAction,
      guardDecision: decision,
      output: {
        reason: 'guard_reject_fallback',
        action: fallback,
      },
    });
    return {
      action: fallback,
      messages: messagesFromGuardDecision(decision, decisionTrace.id),
    };
  }

  const rewrittenRawAction = await getSupervisorPlannerAction(
    buildSupervisorPlannerActionInput(input, context, decision.instruction),
    context
  );
  appendTrace(context, 'model_action', {
    input: { rewriteInstruction: decision.instruction },
    rawAction: rewrittenRawAction,
  });

  const rewrittenDecision = await guardAction(rewrittenRawAction, context);
  const rewrittenDecisionTrace = appendTrace(context, 'guard_decision', {
    rawAction: rewrittenRawAction,
    guardedAction: actionFromGuardDecision(rewrittenDecision),
    guardDecision: rewrittenDecision,
  });

  const messages = [
    ...messagesFromGuardDecision(decision, decisionTrace.id),
    ...messagesFromGuardDecision(rewrittenDecision, rewrittenDecisionTrace.id),
  ];

  if (rewrittenDecision.type === 'allow') {
    return {
      action: rewrittenDecision.action,
      messages,
    };
  }

  const fallback = fallbackActionForGuardDecision(rewrittenDecision, context)
    ?? decision.suggestedAction
    ?? buildNoPrimaryQuestionAction(context);
  appendTrace(context, 'runtime_decision', {
    rawAction: rewrittenRawAction,
    guardDecision: rewrittenDecision,
    output: {
      reason: 'guard_rewrite_exhausted',
      action: fallback,
    },
  });
  return {
    action: fallback,
    messages,
  };
}

function actionFromGuardDecision(decision: GuardrailDecision): AgentAction | undefined {
  if (decision.type === 'allow') {
    return decision.action;
  }

  return decision.type === 'request_rewrite' ? decision.suggestedAction : undefined;
}

function fallbackActionForGuardDecision(
  decision: Exclude<GuardrailDecision, { type: 'allow' }>,
  context: AgentV3Context
): AgentAction | undefined {
  if (decision.type === 'request_rewrite') {
    return decision.suggestedAction;
  }

  if (decision.fallback === 'finish' && hasPrimaryCandidates(context)) {
    return {
      type: 'finish',
      selectedIds: context.candidates
        .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
        .map((candidate) => candidate.restaurant.id),
      explanation: 'Guard 拒绝继续执行该动作，返回当前通过验证的推荐。',
      confidence: 0.62,
    };
  }

  if (decision.fallback === 'ask_user' || decision.fallback === 'error') {
    return buildNoPrimaryQuestionAction(context);
  }

  return hasPrimaryCandidates(context)
    ? {
        type: 'finish',
        selectedIds: context.candidates
          .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
          .map((candidate) => candidate.restaurant.id),
        explanation: 'Guard 拒绝继续执行该动作，返回当前通过验证的推荐。',
        confidence: 0.62,
      }
    : buildNoPrimaryQuestionAction(context);
}

function buildNoPrimaryQuestionAction(context: AgentV3Context): AgentAction {
  return { type: 'ask_user', question: buildNoPrimaryQuestion(context) };
}

function messagesFromGuardDecision(
  decision: GuardrailDecision,
  traceId?: string
): GuardrailMessage[] {
  if (decision.type === 'allow') {
    return (decision.notes ?? []).map((message) => ({ message, severity: 'warn', traceId }));
  }

  const messages = decision.violations.map((violation) => ({
    message: violation.message,
    severity: violation.severity === 'info' ? 'info' as const : 'warn' as const,
    traceId,
  }));

  if (decision.type === 'request_rewrite') {
    messages.push({
      message: `已要求 Supervisor 重写动作：${decision.instruction}`,
      severity: 'warn',
      traceId,
    });
  }

  return messages;
}

function emitGuardrailMessages(
  messages: GuardrailMessage[],
  actionId: string,
  emit: EmitAgentEvent
): void {
  for (const item of messages) {
    emit({
      type: 'guardrail',
      actionId,
      traceId: item.traceId,
      message: item.message,
      severity: item.severity,
    });
  }
}

function violation(
  code: GuardrailViolation['code'],
  message: string,
  severity: GuardrailViolation['severity'] = 'warn',
  details?: unknown
): GuardrailViolation {
  return { code, message, severity, details };
}

async function guardAction(action: AgentAction, context: AgentV3Context): Promise<GuardrailDecision> {
  if (action.type === 'search') {
    return guardSearchAction(action, context);
  }

  if (action.type === 'finish') {
    return guardFinishAction(action, context);
  }

  if (action.type === 'ask_user') {
    return guardAskUserAction(action, context);
  }

  return { type: 'allow', action };
}

function guardAskUserAction(
  action: Extract<AgentAction, { type: 'ask_user' }>,
  context: AgentV3Context
): GuardrailDecision {
  const exhaustedQuestion = buildPostAuthorizationNoPrimaryQuestion(context);
  if (!exhaustedQuestion || !questionAsksForBroadenAuthorization(action.question)) {
    return { type: 'allow', action };
  }

  return {
    type: 'allow',
    action: {
      type: 'ask_user',
      question: exhaustedQuestion,
    },
    notes: ['已避免重复询问“允许放宽”，改为请求用户更换类型或授权开放推荐。'],
  };
}

async function guardSearchAction(
  action: Extract<AgentAction, { type: 'search' }>,
  context: AgentV3Context
): Promise<GuardrailDecision> {
  const notes: string[] = [];

  if (context.attempts.length >= context.maxSearchCalls) {
    return {
      type: 'reject',
      violations: [
        violation('SEARCH_BUDGET_EXCEEDED', '模型请求继续搜索，但本轮已达到搜索上限。'),
      ],
      fallback: hasPrimaryCandidates(context) ? 'finish' : 'ask_user',
    };
  }

  // SearchPlanSchema 已经把"一次搜索一个意图词"约束在类型层，
  // 这里只负责剔除命中排除项的关键词。
  const guardedKeywords = normalizeSearchKeywords(action.plan.keywords)
    .filter((keyword) => !context.goal.exclusions.some((exclusion) => keyword.includes(exclusion)))
    .slice(0, 1);
  if (guardedKeywords.length !== action.plan.keywords.length) {
    notes.push('已移除命中明确排除项的搜索关键词。');
  }

  if (guardedKeywords.length === 0) {
    return {
      type: 'reject',
      violations: [
        violation('INVALID_PLAN_SCHEMA', '搜索关键词全部命中排除项，无法执行搜索计划。', 'error', {
          originalKeywords: action.plan.keywords,
        }),
      ],
      fallback: 'ask_user',
    };
  }

  const strictMax = getStrictDistanceMaxMeters(context.goal);
  const requestedRadius = Number.isFinite(action.plan.radiusMeters)
    ? action.plan.radiusMeters
    : 1800;
  const radiusMeters = strictMax !== undefined
    ? Math.min(requestedRadius, strictMax)
    : requestedRadius;
  if (strictMax !== undefined && requestedRadius > strictMax) {
    notes.push(`已将搜索半径限制在严格距离 ${strictMax}m 内。`);
  }

  const broadIntent = action.plan.searchIntent === 'broadened'
    || action.plan.searchIntent === 'fallback';
  const allowedForPrimary = action.plan.allowedForPrimary
    && (!broadIntent || isSearchIntentAuthorizedForPrimary(
      context.goal,
      action.plan.searchIntent,
      action.plan.keywords
    ));
  if (action.plan.allowedForPrimary && !allowedForPrimary) {
    notes.push('未获得用户放宽授权，放宽/兜底搜索结果只能进入候补。');
  }

  const planBeforePoiType = SearchPlanSchema.safeParse({
    ...action.plan,
    keywords: guardedKeywords,
    poiType: undefined,
    radiusMeters: Math.max(300, Math.min(5000, Math.round(radiusMeters))),
    allowedForPrimary,
  });

  if (!planBeforePoiType.success) {
    return {
      type: 'reject',
      violations: [
        violation('INVALID_PLAN_SCHEMA', `搜索计划结构无效：${planBeforePoiType.error.message}`, 'error'),
      ],
      fallback: 'ask_user',
    };
  }

  const selectedPoiType = resolveSearchActionPoiType(
    context.goal,
    planBeforePoiType.data.keywords[0],
    action.plan.poiType
  );

  const parsed = SearchPlanSchema.safeParse({
    ...planBeforePoiType.data,
    poiType: selectedPoiType === DEFAULT_POI_TYPE ? undefined : selectedPoiType,
  });

  if (!parsed.success) {
    return {
      type: 'reject',
      violations: [
        violation('INVALID_POI_TYPE', `POI type 选择后搜索计划无效：${parsed.error.message}`, 'error'),
      ],
      fallback: 'ask_user',
    };
  }

  if (hasTriedPlan(context, parsed.data)) {
    return {
      type: 'reject',
      violations: [
        violation('DUPLICATE_PLAN', '模型输出了重复搜索计划，已阻止重复调用。', 'warn', {
          plan: parsed.data,
        }),
      ],
      fallback: hasPrimaryCandidates(context) ? 'finish' : 'ask_user',
    };
  }

  return {
    type: 'allow',
    action: { type: 'search', plan: parsed.data },
    notes,
  };
}

function guardFinishAction(
  action: Extract<AgentAction, { type: 'finish' }>,
  context: AgentV3Context
): GuardrailDecision {
  const expansionSearch = buildExpansionSearchBeforeFinish(context);
  if (expansionSearch) {
    return {
      type: 'request_rewrite',
      violations: [
        violation('PREMATURE_FINISH', '模型请求结束，但仍有未尝试的 Agent 联想关键词。', 'warn'),
      ],
      instruction: '当前主推荐数量不足且仍有未尝试的联想关键词，请输出 search action 继续探索，而不是 finish。',
      suggestedAction: expansionSearch,
    };
  }

  const observedIds = new Set(context.candidates.map((candidate) => candidate.restaurant.id));
  const selectedIds = (action.selectedIds ?? []).filter((id) => observedIds.has(id));
  const candidateIds = (action.candidateIds ?? []).filter((id) => observedIds.has(id));
  const removed = (action.selectedIds ?? []).length - selectedIds.length
    + (action.candidateIds ?? []).length - candidateIds.length;

  return {
    type: 'allow',
    action: {
      ...action,
      selectedIds,
      candidateIds,
    },
    notes: removed > 0
      ? ['finish 动作包含未观察到的候选 id，已移除。']
      : [],
  };
}

function buildExpansionSearchBeforeFinish(context: AgentV3Context): AgentAction | null {
  if (context.attempts.length >= context.maxSearchCalls) {
    return null;
  }

  const distinctBrands = distinctPrimaryBrandCount(context);
  if (distinctBrands >= context.targetCount) {
    return null;
  }

  const relatedTarget = nextUntriedTarget(context, 'related');
  if (relatedTarget && !hasTriedIntent(context, 'synonym')) {
    return {
      type: 'search',
      plan: buildSearchPlan(context, relatedTarget, 'synonym', true, '主推荐未满目标数，继续尝试 Agent 联想关键词。'),
    };
  }

  const broadenedTarget = distinctBrands === 0 ? nextUntriedTarget(context, 'broadened') : null;
  if (broadenedTarget) {
    const authorized = isSearchIntentAuthorizedForPrimary(context.goal, 'broadened', [
      broadenedTarget.keyword,
    ]);
    return {
      type: 'search',
      plan: buildSearchPlan(
        context,
        broadenedTarget,
        'broadened',
        authorized,
        authorized
          ? '用户允许放宽，继续尝试 Agent 联想到的相邻品类。'
          : '没有主推荐，搜索 Agent 联想到的相邻品类作为候补。'
      ),
    };
  }

  if (relatedTarget) {
    return {
      type: 'search',
      plan: buildSearchPlan(context, relatedTarget, 'synonym', true, '主推荐未满目标数，继续尝试 Agent 联想关键词。'),
    };
  }

  return null;
}

/**
 * 决定本轮可以并行铺开哪些搜索计划。
 *
 * 模型仍然只输出一个计划（"下一步做什么"由模型决定），
 * 能不能顺带把已知的未尝试关键词一起搜（"这一步铺多宽"）由策略决定。
 * 关闭开关时恒返回单计划，行为与串行完全一致。
 */
function planParallelBatch(context: AgentV3Context, primaryPlan: SearchPlan): SearchPlan[] {
  const plans = [withPlanId(primaryPlan)];
  const remaining = context.maxSearchCalls - context.attempts.length;

  if (!AGENT_PARALLEL_SEARCH || remaining <= 1 || primaryPlan.searchIntent === 'fallback') {
    return plans;
  }

  const budget = Math.min(AGENT_SEARCH_CONCURRENCY, remaining) - 1;
  if (budget <= 0) {
    return plans;
  }

  const plannedKeywords = new Set(primaryPlan.keywords);
  const companionKind = primaryPlan.searchIntent === 'broadened' ? 'broadened' : 'related';

  for (const target of untriedTargetsForParallel(context, companionKind)) {
    if (plans.length > budget) {
      break;
    }

    const [keyword] = normalizeSearchKeywords([target.keyword]);
    if (!keyword || plannedKeywords.has(keyword)) {
      continue;
    }

    plannedKeywords.add(keyword);
    plans.push(
      buildSearchPlan(
        context,
        target,
        primaryPlan.searchIntent,
        primaryPlan.allowedForPrimary,
        '与本轮主计划并行尝试的联想关键词。'
      )
    );
  }

  return plans;
}

function untriedTargetsForParallel(
  context: AgentV3Context,
  kind: 'related' | 'broadened'
): SearchKeywordTarget[] {
  const targets = untriedTargets(context, kind);
  return kind === 'related' ? targets : targets.filter(() => hasPrimaryCandidates(context) === false);
}

function withPlanId(plan: SearchPlan): SearchPlan {
  return plan.planId ? plan : { ...plan, planId: createPlanId() };
}

/**
 * 执行一批搜索计划。
 *
 * 批内计划并行发起（Amap 请求 + 候选验证），attempts 按 plans 顺序追加，
 * 保证 candidate.sourceAttempt 索引稳定；单个计划失败不影响同批其他计划。
 */
async function executeSearchBatch(
  actionId: string,
  plans: SearchPlan[],
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<AgentObservation[]> {
  if (plans.length === 1) {
    return [await executeSearchAction(actionId, plans[0], context, searchPlaces, emit)];
  }

  const baseRound = context.attempts.length + 1;
  const results = await mapWithConcurrency(plans, plans.length, async (plan, index) => {
    try {
      return await runSearchPlan(actionId, plan, baseRound + index, context, searchPlaces, emit);
    } catch (error) {
      createTurnLogger(context.sessionId, context.turnId).warn('Parallel search plan failed', {
        keywords: plan.keywords,
        error: error instanceof Error ? error.message : String(error),
      });
      appendTrace(context, 'error', {
        actionId,
        input: { plan },
        error: {
          code: 'SEARCH_PROVIDER_FAILED',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      });
      return null;
    }
  });

  const observations: AgentObservation[] = [];
  for (const result of results) {
    if (result) {
      observations.push(commitSearchPlanResult(result, context, emit));
    }
  }

  return observations;
}

interface SearchPlanResult {
  actionId: string;
  plan: SearchPlan;
  restaurants: Restaurant[];
  provider: AgentObservation['provider'];
  hardGuard: ReturnType<typeof applyHardConstraintGuard>;
  hardRejectedReasons: string[];
  evaluationRestaurants: Restaurant[];
  agentEvaluation: EvaluationAgentOutput;
}

async function executeSearchAction(
  actionId: string,
  plan: SearchPlan,
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<AgentObservation> {
  const result = await runSearchPlan(
    actionId,
    plan,
    context.attempts.length + 1,
    context,
    searchPlaces,
    emit
  );
  return commitSearchPlanResult(result, context, emit);
}

/**
 * 只读阶段：发起搜索并完成候选验证，不修改 context 的 attempts / candidates。
 *
 * 并行执行时多个计划同时处于该阶段，因此这里不能写入顺序敏感的状态。
 */
async function runSearchPlan(
  actionId: string,
  plan: SearchPlan,
  round: number,
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<SearchPlanResult> {
  emit({
    type: 'searching',
    keywords: plan.keywords,
    round,
    searchIntent: plan.searchIntent,
    planId: plan.planId,
  });
  const toolStartTrace = appendTrace(context, 'tool_start', {
    actionId,
    input: {
      tool: 'search_restaurants',
      args: plan,
    },
  });
  emit({
    type: 'tool_start',
    traceId: toolStartTrace.id,
    tool: 'search_restaurants',
    args: plan,
    planId: plan.planId,
  });

  const toolStartedAt = Date.now();
  const restaurants = await searchPlaces(plan);
  const toolDurationMs = Date.now() - toolStartedAt;
  const provider = inferObservationProvider(restaurants);
  const toolResultTrace = appendTrace(context, 'tool_result', {
    actionId,
    input: {
      tool: 'search_restaurants',
      args: plan,
    },
    output: {
      found: restaurants.length,
      provider,
      durationMs: toolDurationMs,
      restaurantIds: restaurants.map((restaurant) => restaurant.id),
    },
  });
  emit({
    type: 'tool_result',
    traceId: toolResultTrace.id,
    tool: 'search_restaurants',
    summary: {
      found: restaurants.length,
      provider,
      durationMs: toolDurationMs,
    },
    planId: plan.planId,
  });
  emit({
    type: 'search_result',
    found: restaurants.length,
    total: restaurants.length,
    planId: plan.planId,
    restaurants: summarizeRestaurantsForEvent(restaurants),
  });

  const hardGuard = applyHardConstraintGuard(restaurants, context.goal);
  const hardRejectedReasons = summarizeHardRejectedReasons(hardGuard.rejected);

  const evaluationRestaurants = selectRestaurantsForEvaluation(hardGuard.passed, context.targetCount);
  if (evaluationRestaurants.length > 0) {
    emit({
      type: 'status',
      message: evaluationRestaurants.length < restaurants.length
        ? `正在验证前 ${evaluationRestaurants.length} 家候选餐厅...`
        : '正在验证候选餐厅...',
    });
  }

  let evaluationError: EvaluationAgentOutput['error'];
  const agentEvaluation = evaluationRestaurants.length > 0
    ? await runBatchedEvaluationAgent({
      metricsSink: context,
      goal: context.goal,
      plan,
      restaurants: evaluationRestaurants,
      existingCandidates: context.candidates.map((candidate) => ({
        restaurant: candidate.restaurant,
        verdict: candidateToVerdict(candidate),
        sourceAttempt: candidate.sourceAttempt,
      })),
      targetCount: context.targetCount,
      preferenceSummary: context.preferenceSummary,
    }).catch((error) => {
      evaluationError = evaluationFailureFromError(error);
      context.evaluationDegraded = true;
      return buildUnverifiedEvaluationFallback(evaluationRestaurants, context.targetCount, evaluationError);
    })
    : {
      verdicts: [],
      selectedIds: [],
      candidateIds: [],
      explanation: 'No candidates to evaluate after deterministic filtering.',
      unmetConstraints: [],
      source: 'model' as const,
    };
  appendTrace(context, 'evaluation', {
    actionId,
    input: {
      plan,
      restaurantIds: evaluationRestaurants.map((restaurant) => restaurant.id),
    },
    output: {
      verdictCount: agentEvaluation.verdicts.length,
      selectedIds: agentEvaluation.selectedIds,
      candidateIds: agentEvaluation.candidateIds,
      unmetConstraints: agentEvaluation.unmetConstraints,
      source: agentEvaluation.source,
    },
    error: evaluationError,
  });

  return {
    actionId,
    plan,
    restaurants,
    provider,
    hardGuard,
    hardRejectedReasons,
    evaluationRestaurants,
    agentEvaluation,
  };
}

/**
 * 写入阶段：把一个计划的结果并入运行状态。
 *
 * 串行执行，attempts 按调用顺序追加，因此 sourceAttempt 索引始终稳定。
 */
function commitSearchPlanResult(
  result: SearchPlanResult,
  context: AgentV3Context,
  emit: EmitAgentEvent
): AgentObservation {
  const { actionId, plan, restaurants, provider, hardGuard, hardRejectedReasons } = result;
  const { evaluationRestaurants, agentEvaluation } = result;
  const sourceAttempt = context.attempts.length + 1;

  context.unmetConstraints.push(...hardRejectedReasons);
  if (!plan.allowedForPrimary && restaurants.length > 0) {
    context.unmetConstraints.push('未授权放宽或兜底结果只作为候补，不进入主推荐。');
  }

  const verdictGuard = applyVerdictGuard(
    agentEvaluation,
    evaluationRestaurants,
    context.goal,
    plan,
    context.targetCount
  );
  const evaluated = evaluateSearchResult(
    evaluationRestaurants,
    context,
    plan,
    sourceAttempt,
    verdictGuard.output
  );
  mergeCandidates(context, evaluated.acceptedCandidates);
  context.attempts.push({
    keywords: plan.keywords,
    radius: plan.radiusMeters,
    poiType: plan.poiType,
    searchIntent: plan.searchIntent,
    allowedForPrimary: plan.allowedForPrimary,
    reason: plan.reason,
    found: restaurants.length,
    accepted: evaluated.acceptedCandidates.length,
  });

  const verdicts = verdictGuard.output.verdicts;
  const acceptedPrimaryIds = evaluated.acceptedCandidates
    .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
    .map((candidate) => candidate.restaurant.id);
  const candidateIds = evaluated.acceptedCandidates
    .map((candidate) => candidate.restaurant.id);
  const unmetConstraints = Array.from(new Set([
    ...hardRejectedReasons,
    ...verdictGuard.output.unmetConstraints,
    ...verdictGuard.rejectedVerdicts.flatMap((verdict) => [
      ...verdict.conflicts,
      ...verdict.warnings,
    ]),
    ...evaluated.acceptedCandidates.flatMap((candidate) => [
      ...candidate.verification.hardFailures.map((failure) => failure.message),
      ...candidate.verification.warnings,
    ]),
  ]));

  emit({
    type: 'partial_results',
    restaurants: context.candidates
      .slice(0, context.targetCount)
      .map((candidate) => candidate.restaurant),
  });

  const observationTrace = appendTrace(context, 'observation', {
    actionId,
    output: {
      provider,
      rawCount: restaurants.length,
      hardRejectedCount: hardGuard.rejected.length,
      acceptedPrimaryIds,
      candidateIds,
      unmetConstraints,
    },
  });
  const observation: AgentObservation = {
    actionId,
    traceId: observationTrace.id,
    plan,
    provider,
    rawCount: restaurants.length,
    hardRejected: hardGuard.rejected.slice(0, MAX_HARD_REJECTED_OBSERVATIONS).map((item) => ({
      restaurantId: item.restaurant.id,
      reasons: item.reasons,
    })),
    verdicts,
    acceptedPrimaryIds,
    candidateIds,
    unmetConstraints,
  };
  appendTrace(context, 'state_update', {
    actionId,
    output: {
      kind: 'search_state_updated',
      attempts: context.attempts.length,
      candidates: context.candidates.length,
      accepted: evaluated.acceptedCandidates.length,
    },
  });

  return observation;
}

function inferObservationProvider(restaurants: Restaurant[]): AgentObservation['provider'] {
  return restaurants.some((restaurant) => restaurant.source === 'osm') ? 'osm' : 'amap';
}

function summarizeRestaurantsForEvent(restaurants: Restaurant[]): Array<{
  id: string;
  name: string;
  cuisineType: string;
  distance?: number;
}> {
  return restaurants.map((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    cuisineType: restaurant.cuisineType,
    distance: restaurant.distance,
  }));
}

function selectRestaurantsForEvaluation(restaurants: Restaurant[], targetCount: number): Restaurant[] {
  const dynamicLimit = targetCount + DEFAULT_AGENT_EVALUATION_BUFFER;
  const configuredLimit = CONFIGURED_AGENT_EVALUATION_LIMIT ?? dynamicLimit;
  const limit = Math.max(targetCount, configuredLimit);
  return restaurants.slice(0, limit);
}

function summarizeHardRejectedReasons(
  rejected: ReturnType<typeof applyHardConstraintGuard>['rejected']
): string[] {
  const reasons = rejected.flatMap((item) => item.reasons);
  if (reasons.length <= MAX_HARD_REJECTED_REASON_DETAILS) {
    return reasons;
  }

  return [
    ...reasons.slice(0, MAX_HARD_REJECTED_REASON_DETAILS),
    `还有 ${reasons.length - MAX_HARD_REJECTED_REASON_DETAILS} 条明确硬约束不匹配结果已被本地过滤。`,
  ];
}

function evaluationFailureFromError(error: unknown): NonNullable<EvaluationAgentOutput['error']> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = /429|rate\s*limit|too many requests|timeout|timed out|5\d\d|temporar/i
    .test(message);
  const code = /429|rate\s*limit|too many requests/i.test(message)
    ? 'EVALUATION_RATE_LIMITED'
    : /schema|parse|invalid|truncated|function arguments/i.test(message)
      ? 'EVALUATION_PARSE_ERROR'
      : 'EVALUATION_AGENT_FAILED';

  return {
    code,
    message,
    retryable,
  };
}

function buildUnverifiedEvaluationFallback(
  restaurants: Restaurant[],
  targetCount: number,
  error: NonNullable<EvaluationAgentOutput['error']>
): EvaluationAgentOutput {
  const warning = 'EvaluationAgent 验证失败，候选仅作为未验证候补，不进入主推荐。';

  return {
    verdicts: restaurants.map((restaurant) => ({
      restaurantId: restaurant.id,
      status: 'unverified',
      primaryEligible: false,
      confidence: 0,
      matchedItems: [],
      matchedCategories: [],
      conflicts: [],
      evidence: [],
      warnings: [warning],
    })),
    selectedIds: [],
    candidateIds: restaurants.slice(0, targetCount).map((restaurant) => restaurant.id),
    explanation: warning,
    unmetConstraints: [`${warning} ${error.message}`],
    source: 'error',
    error,
  };
}

async function runBatchedEvaluationAgent(input: EvaluationAgentInput): Promise<EvaluationAgentOutput> {
  const batchSize = Math.max(1, DEFAULT_AGENT_EVALUATION_BATCH_SIZE);
  if (input.restaurants.length <= batchSize) {
    return runEvaluationAgent(input);
  }

  const batches = chunkRestaurants(input.restaurants, batchSize);
  const concurrency = Math.min(
    Math.max(1, DEFAULT_AGENT_EVALUATION_CONCURRENCY),
    batches.length
  );

  try {
    const outputs = await mapWithConcurrency(batches, concurrency, (restaurants) =>
      runEvaluationAgent({ ...input, restaurants })
    );
    return mergeEvaluationOutputs(outputs);
  } catch (error) {
    if (concurrency <= 1 || !isLikelyEvaluationRateLimit(error)) {
      throw error;
    }

    const outputs: EvaluationAgentOutput[] = [];
    for (const restaurants of batches) {
      outputs.push(await runEvaluationAgent({ ...input, restaurants }));
    }
    return mergeEvaluationOutputs(outputs);
  }
}

function chunkRestaurants(restaurants: Restaurant[], size: number): Restaurant[][] {
  const chunks: Restaurant[][] = [];
  for (let index = 0; index < restaurants.length; index += size) {
    chunks.push(restaurants.slice(index, index + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

function mergeEvaluationOutputs(outputs: EvaluationAgentOutput[]): EvaluationAgentOutput {
  return {
    verdicts: outputs.flatMap((output) => output.verdicts),
    selectedIds: uniqueStrings(outputs.flatMap((output) => output.selectedIds)),
    candidateIds: uniqueStrings(outputs.flatMap((output) => output.candidateIds)),
    explanation: outputs
      .map((output) => output.explanation)
      .filter(Boolean)
      .join(' '),
    unmetConstraints: uniqueStrings(outputs.flatMap((output) => output.unmetConstraints)),
    source: outputs.some((output) => output.source === 'cache') ? 'cache' : 'model',
  };
}

function isLikelyEvaluationRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate\s*limit|too many requests/i.test(message);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function appendAction(
  context: AgentV3Context,
  action: AgentAction,
  emit: EmitAgentEvent
): ReturnType<typeof createActionRecord> {
  const record = createActionRecord(action);
  context.actions.push(record);
  const trace = appendTrace(context, 'state_update', {
    actionId: record.id,
    output: {
      kind: 'action_recorded',
      actionType: action.type,
      actionCount: context.actions.length,
    },
  });
  emit({
    type: 'action',
    actionId: record.id,
    traceId: trace.id,
    actionType: action.type,
    summary: summarizeAction(action),
  });
  return record;
}

function appendTrace(
  context: AgentV3Context,
  type: AgentTraceItem['type'],
  item: Partial<Omit<AgentTraceItem, 'id' | 'sessionId' | 'turnId' | 'type' | 'createdAt'>> = {}
): AgentTraceItem {
  const traceItem: AgentTraceItem = {
    id: createTraceId('trace'),
    sessionId: context.sessionId ?? 'transient',
    turnId: context.turnId,
    type,
    createdAt: Date.now(),
    ...item,
  };
  context.trace.push(traceItem);
  return traceItem;
}

function createTraceId(prefix: string): string {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * 汇总本轮模型调用指标，写入 trace 与日志。
 *
 * 逐次调用的明细留在 metrics 数组里，trace 只保留一条汇总，
 * 避免高频节点把 session 行撑大。
 */
function recordTurnMetrics(context: AgentV3Context, outcome: 'final' | 'paused'): void {
  const metrics = summarizeTurnMetrics(context);
  appendTrace(context, 'model_call', {
    output: { outcome, ...metrics },
  });
  createTurnLogger(context.sessionId, context.turnId).info('agent turn finished', {
    outcome,
    attempts: context.attempts.length,
    actions: context.actions.length,
    candidates: context.candidates.length,
    ...metrics,
  });
}

function finish(
  context: AgentV3Context,
  action: Extract<AgentAction, { type: 'finish' }>,
  emit: EmitAgentEvent
): AgentFinalResult {
  emit({
    type: 'filtering',
    message: '正在为您筛选最佳推荐...',
    total: context.candidates.length,
  });

  const finalResult = finalizeRecommendations(context, {
    selectedIds: action.selectedIds,
    candidateIds: action.candidateIds,
    explanation: describeFinish(action.reason, action.explanation),
    confidence: action.confidence,
  });

  if (finalResult.restaurants.length === 0) {
    const question = buildNoPrimaryQuestion(context);
    appendAction(context, { type: 'ask_user', question }, emit);
    return buildPausedResult(context, question);
  }

  const finalTrace = appendTrace(context, 'final', {
    output: {
      restaurantIds: finalResult.restaurants.map((restaurant) => restaurant.id),
      candidateIds: finalResult.candidates.map((restaurant) => restaurant.id),
      explanation: finalResult.explanation,
      unmetConstraints: finalResult.unmetConstraints,
    },
  });
  emit({ type: 'final', traceId: finalTrace.id, sessionId: context.sessionId, ...finalResult });
  recordTurnMetrics(context, 'final');

  return {
    ...finalResult,
    runtimeState: snapshotRuntimeState(context),
  };
}

function buildPausedResult(context: AgentV3Context, question: PendingQuestion): AgentFinalResult {
  const partialResult = finalizeRecommendations(context, {
    explanation: question.reason ?? '需要用户补充信息后继续搜索。',
    confidence: 0.4,
  });
  const questionTrace = appendTrace(context, 'question', {
    output: {
      question,
      partialRestaurantIds: partialResult.restaurants.map((restaurant) => restaurant.id),
      partialCandidateIds: partialResult.candidates.map((restaurant) => restaurant.id),
    },
  });

  recordTurnMetrics(context, 'paused');

  return {
    ...partialResult,
    paused: true,
    question,
    questionTraceId: questionTrace.id,
    runtimeState: {
      ...snapshotRuntimeState(context),
      pendingQuestion: question,
    },
  };
}

function candidateToVerdict(candidate: RestaurantCandidate): CandidateVerdict {
  return {
    restaurantId: candidate.restaurant.id,
    status: candidate.verification.status,
    primaryEligible: candidate.verification.primaryEligible,
    confidence: candidate.verification.confidence,
    matchedItems: candidate.verification.itemMatches.map((match) => match.requestedItem),
    matchedCategories: candidate.verification.categoryMatches,
    conflicts: candidate.verification.hardFailures.map((failure) => failure.message),
    evidence: candidate.matched,
    warnings: candidate.verification.warnings,
  };
}

function snapshotRuntimeState(context: AgentV3Context): AgentRuntimeState {
  return {
    goal: context.goal,
    attempts: [...context.attempts],
    candidates: [...context.candidates],
    actions: [...context.actions],
    observations: [...context.observations],
    trace: [...context.trace],
  };
}
