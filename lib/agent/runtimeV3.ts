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
import {
  isSearchIntentAuthorizedForPrimary,
} from './authorization';
import {
  hasPromotedBroadenedPrimaryCandidates,
  promoteAuthorizedBroadenedResults,
} from './broadenAdmission';
import { UserGoalSchema } from './schemas/goal';
import { SearchPlanSchema } from './schemas/plan';
import { finalizeRecommendations } from './resultAssembler';
import {
  extractKnownFoodTerms,
  DEFAULT_POI_TYPE,
  isGenericSearchKeyword,
  lookupFoodPoiTypes,
  normalizeSearchKeywords,
} from './poiTaxonomy';
import { applyKeywordExpansion, runKeywordExpansionAgent } from './subagents/keywordExpansionAgent';
import { runEvaluationAgent, type EvaluationAgentInput } from './subagents/evaluationAgent';
import { getAmapFoodPoiType } from './amapPoiTypeCatalog';
import {
  deriveContextInvalidationPlan,
  deriveGoalSignature,
  markStaleCandidatesForContext,
  withUpdatedGoalVersion,
} from './goalVersion';
import type { ContextInvalidationPlan } from './goalVersion';
import type {
  AgentAction,
  AgentContext,
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

export async function runSearchAgentV3(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: 'SupervisorPlannerAgent 正在维护目标并选择下一步动作...' });

  const supervisorOutput = normalizeExplicitOpenRecommendation(
    input,
    await getSupervisorPlannerOutput(input)
  );
  const conversationMode = inferRuntimeConversationMode(input, supervisorOutput);
  const baseGoal = withUpdatedGoalVersion(
    resolveSupervisorGoal(input, supervisorOutput),
    conversationMode === 'start_new_goal' ? undefined : input.runtimeState?.goal
  );
  const invalidationPlan = deriveContextInvalidationPlan(
    input.runtimeState?.goal,
    baseGoal,
    input.previousLocation,
    input.location
  );
  const resetPlan = deriveSearchStateResetPlan(invalidationPlan, conversationMode);
  let goal = baseGoal;
  if (!supervisorOutput.question && baseGoal.clarificationNeeded.length === 0) {
    emit({ type: 'status', message: 'KeywordExpansionHelper 正在生成搜索联想词...' });
    goal = applyKeywordExpansion(
      baseGoal,
      await runKeywordExpansionAgent({
        goal: baseGoal,
        attempts: resetPlan.clearAttempts ? [] : (input.runtimeState?.attempts ?? []),
        preferenceSummary: input.preferenceSummary,
      })
    );
  }
  const context = createInitialContext(input, goal, resetPlan);
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
  const clarifyingQuestion = supervisorOutput.question
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
    const action: AgentAction = {
      type: 'finish',
      selectedIds: context.candidates
        .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
        .map((candidate) => candidate.restaurant.id),
      explanation: '用户已授权放宽，已将上一轮候补结果重新纳入主推荐。',
      confidence: 0.66,
    };
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

    const observation = await executeSearchAction(
      actionRecord.id,
      guarded.action.plan,
      context,
      searchPlaces,
      emit
    );
    context.observations.push(observation);

    emit({
      type: 'observation',
      actionId: observation.actionId,
      traceId: observation.traceId,
      found: observation.rawCount,
      accepted: observation.acceptedPrimaryIds.length,
      rejected: observation.hardRejected.length,
    });

    if (context.attempts.length >= context.maxSearchCalls) {
      const fallback: AgentAction = hasPrimaryCandidates(context)
        ? {
            type: 'finish',
            selectedIds: context.candidates
              .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
              .map((candidate) => candidate.restaurant.id),
            explanation: '已达到搜索上限，返回当前通过验证的推荐。',
            confidence: 0.62,
          }
        : {
            type: 'ask_user',
            question: buildNoPrimaryQuestion(context),
      };
      appendTrace(context, 'runtime_decision', {
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
        message: '已达到本轮搜索动作上限，Runtime 强制进入结束或追问。',
        severity: 'warn',
      });

      if (fallback.type === 'ask_user') {
        return buildPausedResult(context, fallback.question);
      }

      return finish(context, fallback, emit);
    }
  }

  const forcedFinish: Extract<AgentAction, { type: 'finish' }> = {
    type: 'finish',
    explanation: '已达到 Agent 动作上限，返回当前通过验证的结果。',
    confidence: 0.6,
  };
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
  input: AgentInput
): Promise<Awaited<ReturnType<typeof runSupervisorPlanner>>> {
  try {
    return await runSupervisorPlanner({
      message: input.query,
      previousGoal: input.runtimeState?.goal,
      pendingQuestion: input.runtimeState?.pendingQuestion,
      messages: input.messages,
      preferenceSummary: input.preferenceSummary,
      attempts: input.runtimeState?.attempts,
    });
  } catch (error) {
    if (isInitialExplicitOpenRecommendation(input) && isTruncatedFunctionArgumentsError(error)) {
      return {
        goal: buildOpenRecommendationGoal(input.query),
        conversationMode: 'start_new_goal',
        nextAction: 'plan',
      };
    }

    throw error;
  }
}

function normalizeExplicitOpenRecommendation(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSupervisorPlanner>>
): Awaited<ReturnType<typeof runSupervisorPlanner>> {
  if (
    input.runtimeState?.pendingQuestion
    || input.runtimeState?.goal
    || !isExplicitOpenRecommendationQuery(input.query)
  ) {
    return output;
  }

  return {
    goal: buildOpenRecommendationGoal(input.query, output.goal),
    conversationMode: 'start_new_goal',
    nextAction: 'plan',
  };
}

function isInitialExplicitOpenRecommendation(input: AgentInput): boolean {
  return !input.runtimeState?.pendingQuestion
    && !input.runtimeState?.goal
    && isExplicitOpenRecommendationQuery(input.query);
}

function isExplicitOpenRecommendationQuery(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }

  if (extractKnownFoodTerms(normalized).length > 0) {
    return false;
  }

  return /(随便|随意|随机|都行|都可以|无所谓|你决定|你看着办|帮我决定|直接推荐|不知道吃啥|不知道吃什么|不知道吃啥好|不知道吃什么好|没有具体|没具体)/u
    .test(normalized);
}

function isTruncatedFunctionArgumentsError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('returned truncated function arguments');
}

function buildOpenRecommendationGoal(query: string, modelGoal?: UserGoal): UserGoal {
  const existingPreferences = modelGoal?.softPreferences ?? [];
  const hasDefaultDiversity = existingPreferences.some((preference) =>
    preference.name === '默认多样性'
  );

  return UserGoalSchema.parse({
    intent: 'find_restaurants',
    rawQuery: modelGoal?.rawQuery || query,
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: modelGoal?.hardConstraints ?? [],
    softPreferences: hasDefaultDiversity
      ? existingPreferences
      : [
          ...existingPreferences,
          { name: '默认多样性', weight: 1, verifiable: true },
        ],
    exclusions: modelGoal?.exclusions ?? [],
    ambiguity: [
      ...(modelGoal?.ambiguity ?? []),
      '用户明确表示随意或随机推荐，已按开放餐饮候选处理。',
    ],
    clarificationNeeded: [],
    authorizations: [
      {
        id: `auth_fallback_primary_${Date.now().toString(36)}`,
        kind: 'fallback_primary',
        createdAt: Date.now(),
        reason: '用户授权开放推荐，可将兜底餐饮候选作为主推荐。',
        constraints: {
          allowedSearchIntents: ['fallback'],
        },
      },
    ],
    allowBroaden: true,
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

  return { type: 'allow', action };
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

  const keywords = normalizeSearchKeywords(action.plan.keywords)
    .filter((keyword) => !context.goal.exclusions.some((exclusion) => keyword.includes(exclusion)))
    .slice(0, 5);
  if (keywords.length !== action.plan.keywords.length) {
    notes.push('已移除命中明确排除项的搜索关键词。');
  }

  if (keywords.length === 0) {
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

  const guardedKeywords = keywords.slice(0, 1);
  const hasMultipleKeywords = keywords.length > guardedKeywords.length;

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
    planBeforePoiType.data.keywords[0],
    action.plan.poiType,
    context.goal
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

  const guardedAction: AgentAction = { type: 'search', plan: parsed.data };
  if (hasMultipleKeywords) {
    return {
      type: 'request_rewrite',
      violations: [
        violation('MULTI_INTENT_KEYWORDS', '模型输出了多关键词搜索计划，需要拆成单关键词 action。', 'warn', {
          originalKeywords: keywords,
          suggestedKeywords: guardedKeywords,
        }),
      ],
      instruction: '将 SearchPlan.keywords 改为单个餐饮意图词；如果仍需搜索其他关键词，请在后续 action 中逐个输出。',
      suggestedAction: guardedAction,
    };
  }

  return {
    type: 'allow',
    action: guardedAction,
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

  const primaryCandidates = context.candidates.filter((candidate) =>
    isPrimaryRecommendationAllowed(candidate, context)
  );
  if (primaryCandidates.length >= context.targetCount) {
    return null;
  }

  const relatedTarget = nextUntriedGoalTarget(context, context.goal.relatedTargets, context.goal.relatedKeywords);
  if (relatedTarget) {
    return {
      type: 'search',
      plan: buildRuntimePlan(context, relatedTarget, 'synonym', true, '主推荐未满目标数，继续尝试 Agent 联想关键词。'),
    };
  }

  const broadenedTarget = primaryCandidates.length === 0
    ? nextUntriedGoalTarget(context, context.goal.broadenedTargets, context.goal.broadenedKeywords)
    : null;
  if (broadenedTarget) {
    return {
      type: 'search',
      plan: buildRuntimePlan(
        context,
        broadenedTarget,
        'broadened',
        isSearchIntentAuthorizedForPrimary(context.goal, 'broadened', [broadenedTarget.keyword]),
        isSearchIntentAuthorizedForPrimary(context.goal, 'broadened', [broadenedTarget.keyword])
          ? '用户允许放宽，继续尝试 Agent 联想到的相邻品类。'
          : '没有主推荐，搜索 Agent 联想到的相邻品类作为候补。'
      ),
    };
  }

  return null;
}

async function executeSearchAction(
  actionId: string,
  plan: SearchPlan,
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<AgentObservation> {
  const round = context.attempts.length + 1;
  emit({ type: 'searching', keywords: plan.keywords, round });
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
  });
  emit({
    type: 'search_result',
    found: restaurants.length,
    total: restaurants.length,
    restaurants: summarizeRestaurantsForEvent(restaurants),
  });

  const hardGuard = applyHardConstraintGuard(restaurants, context.goal);
  const hardRejectedReasons = summarizeHardRejectedReasons(hardGuard.rejected);
  context.unmetConstraints.push(...hardRejectedReasons);

  const evaluationRestaurants = selectRestaurantsForEvaluation(hardGuard.passed, context.targetCount);
  if (evaluationRestaurants.length > 0) {
    emit({
      type: 'status',
      message: evaluationRestaurants.length < restaurants.length
        ? `EvaluationAgent 正在验证前 ${evaluationRestaurants.length} 家候选餐厅...`
        : 'EvaluationAgent 正在验证候选餐厅...',
    });
  }

  let evaluationError: EvaluationAgentOutput['error'];
  const agentEvaluation = evaluationRestaurants.length > 0
    ? await runBatchedEvaluationAgent({
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
    round,
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

function finish(
  context: AgentV3Context,
  action: Extract<AgentAction, { type: 'finish' }>,
  emit: EmitAgentEvent
): AgentFinalResult {
  emit({
    type: 'filtering',
    message: '正在进行 FinalGuard 主推荐准入并组装推荐...',
    total: context.candidates.length,
  });

  const finalResult = finalizeRecommendations(context, {
    selectedIds: action.selectedIds,
    candidateIds: action.candidateIds,
    explanation: action.explanation,
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
  appendTrace(context, 'question', {
    output: {
      question,
      partialRestaurantIds: partialResult.restaurants.map((restaurant) => restaurant.id),
      partialCandidateIds: partialResult.candidates.map((restaurant) => restaurant.id),
    },
  });

  return {
    ...partialResult,
    paused: true,
    question,
    runtimeState: {
      ...snapshotRuntimeState(context),
      pendingQuestion: question,
    },
  };
}

function buildNoPrimaryQuestion(context: AgentV3Context): PendingQuestion {
  const target = [
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.primaryKeywords,
  ].filter(Boolean).slice(0, 3).join('、');
  const hasStrictDistance = context.goal.hardConstraints.some((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  if (hasStrictDistance) {
    return {
      reason: '当前严格距离范围内没有找到通过主推荐准入的餐厅。',
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      options: ['扩大范围', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '扩大范围': {
          allowBroaden: true,
          setDistanceMaxMeters: 5000,
          addAuthorizations: [{
            id: `auth_distance_expansion_${Date.now().toString(36)}`,
            kind: 'distance_expansion',
            createdAt: Date.now(),
            reason: '用户授权扩大距离范围。',
            constraints: { maxMeters: 5000 },
          }],
        },
      },
    };
  }

  return {
    reason: '没有找到通过主推荐准入的餐厅。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
      : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    options: ['允许放宽', '换个类型'],
    allowFreeText: true,
    optionEffects: {
      '允许放宽': allowBroadenQuestionEffect(context.goal),
    },
  };
}

function allowBroadenQuestionEffect(goal: UserGoal): NonNullable<PendingQuestion['optionEffects']>[string] {
  const hasPrimaryTarget = [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].some((item) => item.trim().length > 0);
  const kind = hasPrimaryTarget ? 'category_broaden' : 'fallback_primary';
  const searchIntent = hasPrimaryTarget ? 'broadened' : 'fallback';

  return {
    allowBroaden: true,
    addAuthorizations: [{
      id: `auth_${kind}_${Date.now().toString(36)}`,
      kind,
      createdAt: Date.now(),
      reason: hasPrimaryTarget
        ? '用户授权放宽到相邻品类。'
        : '用户授权开放推荐，可将兜底餐饮候选作为主推荐。',
      constraints: {
        allowedSearchIntents: [searchIntent],
      },
    }],
  };
}

function hasPrimaryCandidates(context: AgentV3Context): boolean {
  return context.candidates.some((candidate) =>
    isPrimaryRecommendationAllowed(candidate, context)
  );
}

function hasTriedPlan(context: AgentV3Context, plan: SearchPlan): boolean {
  const key = searchPlanKey(plan);
  return context.attempts.some((attempt) =>
    `${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}` === key
  );
}

function nextUntriedGoalTarget(
  context: AgentV3Context,
  targets: SearchKeywordTarget[] | undefined,
  fallbackKeywords: string[]
): SearchKeywordTarget | null {
  const baseTargets = targets && targets.length > 0
    ? targets
    : fallbackKeywords.map((keyword) => ({
        keyword,
        poiTypes: lookupFoodPoiTypes(keyword)?.split('|'),
      }));

  return baseTargets.find((target) => !hasTriedKeyword(context, target.keyword)) ?? null;
}

function hasTriedKeyword(context: AgentV3Context, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return context.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

function buildRuntimePlan(
  context: AgentV3Context,
  target: string[] | SearchKeywordTarget,
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const targetKeywords = Array.isArray(target) ? target : [target.keyword];
  const normalizedKeywords = normalizeSearchKeywords(targetKeywords);
  const targetPoiTypes = Array.isArray(target) ? undefined : target.poiTypes;
  const poiType = normalizedKeywords.length === 1
    ? resolveRuntimePlanPoiType(normalizedKeywords[0], targetPoiTypes, context.goal)
    : undefined;

  return SearchPlanSchema.parse({
    keywords: normalizedKeywords,
    radiusMeters: nextRuntimeRadius(context),
    poiType,
    searchIntent,
    allowedForPrimary,
    reason,
  });
}

function resolveRuntimePlanPoiType(
  keyword: string,
  targetPoiTypes: string[] | undefined,
  goal: UserGoal
): string | undefined {
  const sanitizedTargetPoiTypes = Array.from(new Set(targetPoiTypes ?? []))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== DEFAULT_POI_TYPE);
  if (sanitizedTargetPoiTypes.length > 0) {
    return sanitizedTargetPoiTypes.join('|');
  }

  return inferPoiTypesForGoalKeyword(goal, keyword) ?? goal.poiType;
}

function resolveSearchActionPoiType(
  keyword: string,
  planPoiType: string | undefined,
  goal: UserGoal
): string | undefined {
  const keywordPoiType = inferPoiTypesForGoalKeyword(goal, keyword);
  if (keywordPoiType) {
    return keywordPoiType;
  }

  const sanitizedPlanPoiTypes = sanitizePoiTypeCodes(planPoiType);
  if (sanitizedPlanPoiTypes.length > 0) {
    return sanitizedPlanPoiTypes.join('|');
  }

  return sanitizePoiTypeCodes(goal.poiType).join('|') || undefined;
}

function inferPoiTypesForGoalKeyword(goal: UserGoal | undefined, keyword: string): string | undefined {
  const direct = lookupFoodPoiTypes(keyword);
  if (direct && direct !== DEFAULT_POI_TYPE) {
    return direct;
  }

  if (!goal) {
    return direct;
  }

  const relatedTerms = [
    ...goal.requestedItems
      .filter((item) => item.name === keyword || item.aliases.includes(keyword))
      .flatMap((item) => [item.name, ...item.aliases]),
    ...goal.acceptableCategories.map((category) => category.name),
  ];
  for (const term of relatedTerms) {
    const inferred = lookupFoodPoiTypes(term);
    if (inferred && inferred !== DEFAULT_POI_TYPE) {
      return inferred;
    }
  }

  return direct;
}

function sanitizePoiTypeCodes(poiType: string | undefined): string[] {
  return Array.from(new Set((poiType ?? '').split('|')))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== DEFAULT_POI_TYPE)
    .slice(0, 5);
}

function nextRuntimeRadius(context: AgentV3Context): number {
  const strictMax = getStrictDistanceMaxMeters(context.goal);
  if (strictMax !== undefined) {
    return Math.max(300, Math.min(5000, strictMax));
  }

  const latestRadius = context.attempts.at(-1)?.radius ?? 1800;
  return Math.min(5000, Math.max(300, Math.round(latestRadius * 1.25)));
}

function searchPlanKey(plan: SearchPlan): string {
  return `${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
}

function getStrictDistanceMaxMeters(goal: UserGoal): number | undefined {
  const strictDistance = goal.hardConstraints.find((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  return strictDistance?.maxMeters
    ?? (typeof strictDistance?.value === 'number' ? strictDistance.value : undefined);
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
