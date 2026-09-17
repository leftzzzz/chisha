/**
 * 编排层的执行器。
 *
 * 只做三件事：按 policy 的决策发起调用、发 SSE 事件、提交状态与 trace。
 * "下一步做什么"一律来自 `./policy`——这里不再自行推导动作。
 */

import type { Restaurant } from '@/types';
import {
  applyGoalPatch,
  clarificationNeedToPendingQuestion,
} from '../goal';
import { runGoalUnderstandingModel } from '../models/goalUnderstandingModel';
import { runSearchReplan, summarizeExhaustedSearch } from '../models/searchReplanModel';
import { evaluateSearchResult, mergeCandidates } from '../evaluator';
import { applyHardConstraintGuard, applyVerdictGuard } from '../guards';
import {
  applyFinalGuard,
  isPrimaryRecommendationEligible,
} from '../finalGuard';
import { createTurnLogger } from '../turnLogger';
import { summarizeTurnMetrics, type MetricsSink } from '../metrics';
import { describeFinish, internalFinishNote, type FinishReason } from '../finishReason';
import {
  buildFallbackPrimaryEffect,
  buildNoPrimaryQuestion,
  decideAskOrConverge,
  decideContextReset,
  decideNextAction,
  decideScouting,
  decideTurnEntry,
  hasPrimaryCandidates,
  inferPoiTypesForGoalKeyword,
  isOpenExplorationContext,
  partitionPlansByValidity,
  planSearchBatch,
  primaryCandidates,
  type PolicyDecision,
  type RejectedPlan,
  type SearchStateResetPlan,
} from './policy';
import {
  buildNearbyCategoryQuestion,
  summarizeNearbyCategories,
} from '../nearbyCategories';
import {
  hasPromotedBroadenedPrimaryCandidates,
  promoteAuthorizedBroadenedResults,
} from '../broadenAdmission';
import { assembleRecommendations } from '../resultAssembler';
import { isGenericSearchKeyword, normalizeSearchKeywords } from '../poiTaxonomy';
import { applyKeywordExpansion, runKeywordExpansionModel } from '../models/keywordExpansionModel';
import { runEvaluationModel, type EvaluationModelInput } from '../models/evaluationModel';
import {
  deriveContextInvalidationPlan,
  markStaleCandidatesForContext,
  withUpdatedGoalVersion,
} from '../goalVersion';
import { createVerdictCache, type VerdictCache } from '../evaluationCache';
import { AgentError, AgentRunError, isAgentError } from '../types';
import type {
  AgentAction,
  AgentActionRecord,
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
  EvaluationModelOutput,
  FinalGuardResult,
  FinishRecommendation,
  GoalPatch,
  PendingQuestion,
  RestaurantCandidate,
  SearchKeywordTarget,
  SearchPlan,
  UserGoal,
} from '../types';

interface AgentV3Context extends AgentContext {
  actions: NonNullable<AgentRuntimeState['actions']>;
  observations: NonNullable<AgentRuntimeState['observations']>;
  trace: AgentTraceItem[];
  turnId: string;
  maxActions: number;
  /** 本轮候选裁决缓存；跨计划复用，避免重叠 POI 被反复送评估。 */
  verdictCache: VerdictCache;
  /** 本轮是否已经用掉那次 replan 机会 */
  replanUsed?: boolean;
  /** 上一轮追问的指纹，用于阻止同一个问题连问两次。 */
  lastQuestionFingerprint?: string;
  /** 连续追问轮数，任何一次产出结果的轮次都会清零。 */
  consecutiveAskTurns?: number;
}

const DEFAULT_AGENT_MAX_SEARCH_CALLS = parsePositiveInt(process.env.AGENT_MAX_SEARCH_CALLS, 4);
const DEFAULT_AGENT_EVALUATION_BUFFER = parsePositiveInt(process.env.AGENT_EVALUATION_BUFFER, 4);
const DEFAULT_AGENT_EVALUATION_BATCH_SIZE = parsePositiveInt(process.env.AGENT_EVALUATION_BATCH_SIZE, 6);
const DEFAULT_AGENT_EVALUATION_CONCURRENCY = parsePositiveInt(process.env.AGENT_EVALUATION_CONCURRENCY, 2);
const CONFIGURED_AGENT_EVALUATION_LIMIT = parseOptionalPositiveInt(process.env.AGENT_EVALUATION_LIMIT);
const MAX_HARD_REJECTED_REASON_DETAILS = 6;
const MAX_HARD_REJECTED_OBSERVATIONS = 20;

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
    if (isAbortError(error)) {
      throw error;
    }
    if (error instanceof AgentRunError) {
      throw error;
    }

    const code = toAgentErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);
    const context = contextRef.current;

    if (context) {
      appendTrace(context, 'error', {
        error: { code, message, retryable: isRetryableAgentError(error, code) },
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

  const invalidationPlan = deriveContextInvalidationPlan(
    input.runtimeState?.goal,
    baseGoal,
    input.previousLocation,
    input.location
  );
  const resetPlan = decideContextReset(conversationMode, invalidationPlan);
  const context = createInitialContext(input, baseGoal, resetPlan);
  context.modelCallMetrics = turnMetrics.modelCallMetrics ?? [];
  contextRef.current = context;
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
    ?? getInitialClarifyingQuestion(context.goal);

  if (clarifyingQuestion) {
    const groundedQuestion = await groundQuestionInNearbyCategories(
      context,
      clarifyingQuestion,
      searchPlaces,
      emit
    );
    return askOrConverge(context, groundedQuestion, emit);
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

  await expandKeywordsAlongsideFirstSearch(context, searchPlaces, emit);

  while (context.actions.length < context.maxActions) {
    const decision = await nextExecutableDecision(context, emit);

    if (decision.kind === 'abort') {
      throw context.evaluationError
        ?? new AgentError('Candidate evaluation failed', decision.reason, true);
    }

    if (decision.kind === 'ask') {
      return askOrConverge(context, decision.question, emit);
    }

    if (decision.kind === 'finish') {
      const action = finishActionFromDecision(decision);
      appendAction(context, action, emit);
      return finish(context, action, emit);
    }

    await runSearchStep(context, decision.plans, searchPlaces, emit);
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
 * 用附近实际的品类分布替换追问选项。
 *
 * 追问发生在搜索之前，模型对"这一带有什么"一无所知，只能复述自己 prompt
 * 里的例子（线上实测三次都是「火锅/日料/川菜/西餐」）。这里先花一次搜索
 * 探路，把选项换成真实存在的品类——顺序反过来：先观察，再提问。
 *
 * 探路失败不影响追问：拿不到数据就用模型原来的问题，绝不让追问因此报错。
 */
async function groundQuestionInNearbyCategories(
  context: AgentV3Context,
  question: PendingQuestion,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<PendingQuestion> {
  const scouting = decideScouting(context);
  if (scouting.kind === 'skip') {
    return question;
  }

  emit({ type: 'status', message: '正在看看附近都有什么...' });

  try {
    const restaurants = await searchPlaces(scouting.plan);
    const categories = summarizeNearbyCategories(restaurants);
    const grounded = buildNearbyCategoryQuestion(categories, buildFallbackPrimaryEffect());

    appendTrace(context, 'runtime_decision', {
      output: {
        kind: 'scout_nearby_categories',
        found: restaurants.length,
        categories,
        grounded: Boolean(grounded),
      },
    });

    return grounded ?? question;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    createTurnLogger(context.sessionId, context.turnId).warn(
      'Nearby category scouting failed; keeping the model question',
      { error: error instanceof Error ? error.message : String(error) }
    );
    return question;
  }
}

/**
 * 联想搜索词，并把不依赖它的首批搜索并发跑掉。
 *
 * 首批计划来自用户明确表达的目标（或开放授权下的通用兜底），完全不依赖联想词——
 * 联想词要到第二批才用得上。所以没有理由让每一个查询都先等一次
 * KeywordExpansion 往返再开始搜。
 *
 * 前提：applyKeywordExpansion 只写 related/broadened 字段，不参与
 * deriveGoalSignature，因此首批产出的候选不会因为目标"变了"而失效。
 * 该前提由 __tests__/lib/agent/goalVersion.test.ts 锁死。
 */
async function expandKeywordsAlongsideFirstSearch(
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<void> {
  emit({ type: 'status', message: '正在联想相关搜索词...' });

  // 指标直接记到 context：它此刻已经存在，再走 turnMetrics 转一手会和
  // 并发首批里评估 agent 的记录互相覆盖。
  const expansion = runKeywordExpansionModel({
    signal: context.signal,
    metricsSink: context,
    goal: context.goal,
    attempts: context.attempts,
    preferenceSummary: context.preferenceSummary,
  });

  // 开放推荐要等联想词：它的首批计划本来就应该是模型给的多样化探索词
  // （火锅/日料/烧烤），并发跑会让首批退化成一个通用词「餐厅」，
  // 转盘的品类分布就只剩高德排序的运气。
  const firstBatchPartition = concurrentFirstSearchEnabled() && !isOpenExplorationContext(context)
    ? partitionPlansByValidity(context, planSearchBatch(context))
    : { plans: [], rejectedPlans: [] };
  reportRejectedPlans(context, firstBatchPartition.rejectedPlans, emit);
  const firstBatch = firstBatchPartition.plans;
  if (firstBatch.length > 0) {
    appendTrace(context, 'runtime_decision', {
      output: {
        kind: 'search',
        stage: 'first_batch',
        plans: firstBatch.map((plan) => plan.keywords[0]),
        attempts: context.attempts.length,
        maxSearchCalls: context.maxSearchCalls,
      },
    });
  }
  const searching = firstBatch.length > 0
    ? runSearchStep(context, firstBatch, searchPlaces, emit)
    : Promise.resolve();

  const [expanded] = await Promise.all([expansion, searching]);
  context.goal = applyKeywordExpansion(context.goal, expanded);
}

function concurrentFirstSearchEnabled(): boolean {
  return process.env.AGENT_CONCURRENT_FIRST_SEARCH !== 'false';
}

/** 执行一批搜索计划：记动作、并行跑、提交观察。 */
async function runSearchStep(
  context: AgentV3Context,
  plans: SearchPlan[],
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<void> {
  const actionRecord = appendAction(context, { type: 'search', plan: plans[0] }, emit);
  const observations = await executeSearchBatch(
    actionRecord.id,
    plans,
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
}

/** 策略决策在 Runtime 侧的可执行形态：replan 与 invalid_plans 已被消解掉。 */
type ExecutableDecision = Exclude<PolicyDecision, { kind: 'replan' | 'invalid_plans' }>;

/**
 * 需要 Runtime 做点事情之后再问一次策略的分支数量上限。
 *
 * 只有两个分支会要求重问：replan（补上新关键词）与 invalid_plans（把被拒的
 * 计划记为已尝试）。两者一轮各最多一次，所以 3 次决策足够收敛。
 */
const MAX_DECISION_ROUNDS = 3;

/**
 * 取下一个可执行决策。
 *
 * "下一步做什么"完全来自 `decideNextAction`——这里不再自行判断计划合不合法、
 * 该不该重试。剩下的循环只服务于两个"先做点事再重问"的分支。
 */
async function nextExecutableDecision(
  context: AgentV3Context,
  emit: EmitAgentEvent
): Promise<ExecutableDecision> {
  for (let round = 0; round < MAX_DECISION_ROUNDS; round += 1) {
    const decision = decideNextAction(context, { replanUsed: context.replanUsed });
    appendTrace(context, 'runtime_decision', {
      output: {
        kind: decision.kind,
        attempts: context.attempts.length,
        maxSearchCalls: context.maxSearchCalls,
        ...(decision.kind === 'search'
          ? { plans: decision.plans.map((plan) => plan.keywords[0]) }
          : {}),
        ...(decision.kind === 'finish' ? { reason: decision.reason } : {}),
      },
    });

    if (decision.kind === 'search') {
      reportRejectedPlans(context, decision.rejectedPlans, emit);
      return decision;
    }

    if (decision.kind === 'invalid_plans') {
      reportRejectedPlans(context, decision.rejectedPlans, emit);
      // 记为已尝试，避免下一次决策又挑中同一批词。
      decision.rejectedPlans.forEach(({ plan }) =>
        recordFailedAttempt(context, plan, '计划未通过校验，未执行搜索。')
      );
      continue;
    }

    if (decision.kind === 'replan') {
      context.replanUsed = true;
      const question = await applyReplan(context, emit);
      if (question) {
        return { kind: 'ask', question };
      }
      continue;
    }

    return decision;
  }

  return hasPrimaryCandidates(context)
    ? {
        kind: 'finish',
        reason: 'NO_MORE_STRATEGY',
        selectedIds: primaryCandidates(context).map((candidate) => candidate.restaurant.id),
        candidateIds: [],
        confidence: 0.6,
      }
    : { kind: 'ask', question: buildNoPrimaryQuestion(context) };
}

/**
 * 上报被 guard 拒绝的计划。
 *
 * 计划由 policy 生成，因此违规意味着策略有 bug——除了重复计划（可能来自并发
 * 批次的竞态）之外都按 error 级别记录，让 eval 与日志抓得到。
 */
function reportRejectedPlans(
  context: AgentV3Context,
  rejectedPlans: RejectedPlan[],
  emit: EmitAgentEvent
): void {
  for (const { plan, violations } of rejectedPlans) {
    const trace = appendTrace(context, 'guard_decision', {
      guardDecision: { type: 'reject', violations },
      output: { plan },
    });
    for (const violation of violations) {
      if (violation.severity === 'error') {
        createTurnLogger(context.sessionId, context.turnId).error(
          'policy produced an invalid search plan',
          { code: violation.code, message: violation.message, plan }
        );
      }
      emit({
        type: 'guardrail',
        actionId: context.actions.at(-1)?.id ?? 'pending',
        traceId: trace.id,
        message: violation.message,
        severity: violation.severity === 'info' ? 'info' : 'warn',
      });
    }
  }
}

/**
 * 策略枯竭时向模型要一个新方向。
 *
 * 返回 PendingQuestion 表示模型建议改为追问；返回 undefined 表示要么补上了
 * 新关键词（调用方重新决策），要么模型也没有方向（调用方回落模板追问）。
 */
async function applyReplan(
  context: AgentV3Context,
  emit: EmitAgentEvent
): Promise<PendingQuestion | undefined> {
  emit({ type: 'status', message: '正在换个思路继续找...' });

  const replan = await runSearchReplan({
    signal: context.signal,
    metricsSink: context,
    message: context.query,
    goal: context.goal,
    messages: context.messages ?? [],
    exhausted: summarizeExhaustedSearch(context.attempts, context.observations),
    preferenceSummary: context.preferenceSummary,
  });

  appendTrace(context, 'model_action', {
    input: { kind: 'replan' },
    output: replan ?? { targets: [], question: undefined },
  });

  if (replan?.targets?.length) {
    context.goal = {
      ...context.goal,
      relatedKeywords: uniqueStrings([
        ...context.goal.relatedKeywords,
        ...replan.targets.map((target) => target.keyword),
      ]),
      relatedTargets: [...(context.goal.relatedTargets ?? []), ...replan.targets],
    };
    return undefined;
  }

  return replan?.question;
}

function finishActionFromDecision(
  decision: Extract<PolicyDecision, { kind: 'finish' }>
): Extract<AgentAction, { type: 'finish' }> {
  return {
    type: 'finish',
    reason: decision.reason,
    selectedIds: decision.selectedIds,
    candidateIds: decision.candidateIds,
    explanation: internalFinishNote(decision.reason),
    confidence: decision.confidence,
  };
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
          .filter((candidate) => isPrimaryRecommendationEligible(candidate, context))
          .slice(0, context.targetCount)
          .map((candidate) => candidate.restaurant.id)
      : undefined,
    explanation: internalFinishNote(reason),
    confidence,
  };
}

interface TurnGoalResolution {
  goal: UserGoal;
  conversationMode: ConversationMode;
  supervisorOutput: Awaited<ReturnType<typeof runGoalUnderstandingModel>> | null;
  clarifyingQuestion?: PendingQuestion;
}

/**
 * 解析本轮目标。
 *
 * 两条互斥的入口：
 * 1. 用户点了追问选项（optionId）——按 id 查 effect，确定性应用，不调模型；
 * 2. 用户输入了自由文本——交给 Supervisor 理解，代码不猜语义。
 *
 * 模型不可用时**直接抛错**，不再降级成"按原文词表抽菜名继续搜"。用硬编码
 * 语义冒充模型判断，既给不出可信结果，又制造了追问死循环。
 */
async function resolveTurnGoal(
  input: AgentInput,
  metricsSink: MetricsSink
): Promise<TurnGoalResolution> {
  const entry = decideTurnEntry(input);

  if (entry.kind === 'invalid_option') {
    throw new AgentError(
      entry.reason === 'no_label'
        ? `Clarification option has no label: ${entry.optionId}`
        : `Clarification option is no longer available: ${entry.optionId}`,
      'INVALID_OPTION',
      false
    );
  }

  if (entry.kind === 'rerun_current_goal') {
    return {
      goal: entry.goal,
      conversationMode: 'continue_current_goal',
      supervisorOutput: null,
    };
  }

  if (entry.kind === 'ask') {
    return {
      goal: entry.goal,
      conversationMode: 'continue_current_goal',
      supervisorOutput: null,
      clarifyingQuestion: entry.question,
    };
  }

  if (entry.kind === 'apply_effect') {
    return {
      goal: entry.goal,
      conversationMode: entry.conversationMode,
      supervisorOutput: null,
    };
  }

  // entry.kind === 'understand'：交给模型角色。带 effect 的选项走不到这里；
  // 模型自己写的选项没有 effect，它的 label 就是一句预填的用户回答。
  const effectiveInput = entry.message === input.query
    ? input
    : { ...input, query: entry.message, optionId: undefined };

  const supervisorOutput = await getGoalUnderstandingOutput(effectiveInput, metricsSink);

  // 模型只提问、不给目标是合法输出（"这句话还不够，我得先问清楚"）。
  // 此时用一个空目标承载本轮上下文——不做任何关键词猜测。
  if (!supervisorOutput.goal && !supervisorOutput.patch && supervisorOutput.question) {
    return {
      goal: input.runtimeState?.goal ?? buildPlaceholderGoal(input.query),
      conversationMode: input.runtimeState?.goal ? 'continue_current_goal' : 'start_new_goal',
      supervisorOutput,
      clarifyingQuestion: supervisorOutput.question,
    };
  }

  return {
    goal: resolveSupervisorGoal(input, supervisorOutput),
    conversationMode: resolveConversationMode(input, supervisorOutput),
    supervisorOutput,
    clarifyingQuestion: supervisorOutput.question,
  };
}

/**
 * 仅用于"模型要求先追问"时承载上下文的空目标。
 *
 * 刻意不从 query 里抽任何词：抽词就是用硬编码语义冒充理解，
 * 那正是被删掉的降级路径干的事。
 */
function buildPlaceholderGoal(query: string): UserGoal {
  return withUpdatedGoalVersion({
    intent: 'find_restaurants',
    rawQuery: query.trim(),
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [],
    allowBroaden: false,
  });
}

/**
 * 取错误码。
 *
 * 抛出点带了码就用它——不再对 message 做正则猜测，那会把任何碰巧包含
 * "poi" 的错误判成数据源故障，而这个码直接决定前端让不让用户重试。
 */
function toAgentErrorCode(error: unknown): AgentErrorCode {
  return isAgentError(error) ? error.code : 'UNKNOWN';
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableAgentError(error: unknown, code: AgentErrorCode): boolean {
  if (isAgentError(error)) {
    return error.retryable;
  }

  return code !== 'CONFIG_MISSING' && code !== 'SESSION_EXPIRED';
}

function resolveSupervisorGoal(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runGoalUnderstandingModel>>
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

  throw new AgentError('GoalUnderstandingModel returned no goal or patch', 'SUPERVISOR_UNAVAILABLE', true);
}

async function getGoalUnderstandingOutput(
  input: AgentInput,
  metricsSink: MetricsSink
): Promise<Awaited<ReturnType<typeof runGoalUnderstandingModel>>> {
  return runGoalUnderstandingModel({
    signal: input.signal,
    metricsSink,
    message: input.query,
    previousGoal: input.runtimeState?.goal,
    pendingQuestion: input.runtimeState?.pendingQuestion,
    messages: input.messages,
    preferenceSummary: input.preferenceSummary,
  });
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
    verdictCache: createVerdictCache(),
    unmetConstraints: [],
    maxSteps: 8,
    maxActions: (resetPlan.clearActionHistory ? 0 : (input.runtimeState?.actions?.length ?? 0)) + 8,
    maxSearchCalls: previousAttempts.length + DEFAULT_AGENT_MAX_SEARCH_CALLS,
    targetCount: 8,
    lastQuestionFingerprint: input.runtimeState?.lastQuestionFingerprint,
    consecutiveAskTurns: input.runtimeState?.consecutiveAskTurns ?? 0,
  };
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

/**
 * 取本轮的会话模式。
 *
 * "这句话与上文什么关系"是语义判断，归 GoalUnderstandingModel——它的
 * normalize 恒会填这个字段。这里只处理它够不到的两种情况：没有历史目标
 * （必然是新会话），以及给了 patch（按定义就是在改当前目标）。
 *
 * 此前这里还有一份完整的签名比较推导，与模型角色 那份逻辑重复且不等价，
 * 且因为上面两个分支永远先命中而从未执行过。
 */
function resolveConversationMode(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runGoalUnderstandingModel>>
): ConversationMode {
  if (!input.runtimeState?.goal) {
    return 'start_new_goal';
  }

  if (output.patch) {
    return 'patch_current_goal';
  }

  return output.conversationMode ?? 'continue_current_goal';
}

function getInitialClarifyingQuestion(goal: UserGoal): PendingQuestion | null {
  const clarificationNeed = goal.clarificationNeeded[0];
  return clarificationNeed ? clarificationNeedToPendingQuestion(clarificationNeed) : null;
}

/**
 * 执行一批搜索计划。
 *
 * 批内计划并行发起（Amap 请求 + 候选验证），attempts 在串行提交阶段按 plans
 * 顺序追加，保证 candidate.sourceAttempt 索引稳定；单个计划失败不影响同批其他计划。
 */
async function executeSearchBatch(
  actionId: string,
  plans: SearchPlan[],
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<AgentObservation[]> {
  const baseRound = context.attempts.length + 1;
  const results = await mapWithConcurrency(plans, plans.length, async (plan, index) => {
    try {
      return {
        result: await runSearchPlan(actionId, plan, baseRound + index, context, searchPlaces, emit),
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return { result: null, error };
    }
  });

  const observations: AgentObservation[] = [];
  const failures: unknown[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const outcome = results[index];
    const plan = plans[index];
    if (outcome.result) {
      observations.push(commitSearchPlanResult(outcome.result, context, emit));
      continue;
    }

    const failure = outcome.error ?? new Error('Search plan failed without an error');
    failures.push(failure);
    createTurnLogger(context.sessionId, context.turnId).warn('Parallel search plan failed', {
      keywords: plan.keywords,
      error: failure instanceof Error ? failure.message : String(failure),
    });
    appendTrace(context, 'error', {
      actionId,
      input: { plan },
      error: {
        code: isAgentError(failure) ? failure.code : 'SEARCH_PROVIDER_FAILED',
        message: failure instanceof Error ? failure.message : String(failure),
        retryable: isAgentError(failure) ? failure.retryable : true,
      },
    });
    // 记为一次已尝试：否则这个关键词会被反复选中，直到预算耗尽。
    recordFailedAttempt(context, plan);
  }

  // A partial batch can still produce useful evidence. If every provider call
  // failed, treating the outage as "zero nearby restaurants" would mislead the
  // user and spend the remaining search budget on a dead path.
  if (observations.length === 0 && failures.length > 0) {
    throw failures.find(isAgentError) ?? failures[0];
  }

  return observations;
}

interface SearchPlanResult {
  actionId: string;
  plan: SearchPlan;
  restaurants: Restaurant[];
  provider: AgentObservation['provider'];
  fetchedAt: number;
  hardGuard: ReturnType<typeof applyHardConstraintGuard>;
  hardRejectedReasons: string[];
  evaluationRestaurants: Restaurant[];
  agentEvaluation: EvaluationModelOutput;
}

/** 一个搜索计划的候选验证结果，区分"这次真判了几家"与"复用了几家"。 */
interface PlanEvaluation {
  /** 拿到裁决的餐厅，顺序与后续 verdicts 一一对应 */
  restaurants: Restaurant[];
  output: EvaluationModelOutput;
  error?: EvaluationModelOutput['error'];
  modelEvaluated: number;
  cacheHits: number;
}

/**
 * 搜索计划整体失败时记录一次空 attempt。
 *
 * searchPlaces 内部已经有 Amap → OSM 的回退，走到这里说明两个数据源都失败了。
 * 记录下来既能让策略换个关键词继续，也能让这一轮不会因为单个数据源抖动整体失败。
 */
function recordFailedAttempt(
  context: AgentV3Context,
  plan: SearchPlan,
  note = `搜索「${plan.keywords.join('、')}」时数据源不可用，本轮未取到结果。`
): void {
  context.attempts.push({
    keywords: plan.keywords,
    radius: plan.radiusMeters,
    poiType: plan.poiType,
    searchIntent: plan.searchIntent,
    allowedForPrimary: plan.allowedForPrimary,
    reason: plan.reason,
    found: 0,
    accepted: 0,
  });
  context.unmetConstraints.push(note);
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
  const fetchedAt = Date.now();
  const toolDurationMs = fetchedAt - toolStartedAt;
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

  const evaluation = await evaluatePlanCandidates(plan, context, hardGuard.passed, restaurants.length, emit);
  appendTrace(context, 'evaluation', {
    actionId,
    input: {
      plan,
      restaurantIds: evaluation.restaurants.map((restaurant) => restaurant.id),
      modelEvaluated: evaluation.modelEvaluated,
      cacheHits: evaluation.cacheHits,
    },
    output: {
      verdictCount: evaluation.output.verdicts.length,
      selectedIds: evaluation.output.selectedIds,
      candidateIds: evaluation.output.candidateIds,
      unmetConstraints: evaluation.output.unmetConstraints,
      source: evaluation.output.source,
    },
    error: evaluation.error,
  });

  return {
    actionId,
    plan,
    restaurants,
    provider,
    fetchedAt,
    hardGuard,
    hardRejectedReasons,
    evaluationRestaurants: evaluation.restaurants,
    agentEvaluation: evaluation.output,
  };
}

/**
 * 验证一个计划的候选。
 *
 * 先向本轮裁决缓存申领：已经判过的直接复用，正在被同批其他计划判的等待其结果，
 * 只有真正没人判过的才走模型。这样一轮之内同一家店最多进一次 EvaluationModel，
 * 无论它被几个关键词召回。
 */
async function evaluatePlanCandidates(
  plan: SearchPlan,
  context: AgentV3Context,
  hardPassed: Restaurant[],
  rawCount: number,
  emit: EmitAgentEvent
): Promise<PlanEvaluation> {
  const shortlist = selectRestaurantsForEvaluation(hardPassed, context.targetCount);
  if (shortlist.length === 0) {
    return {
      restaurants: [],
      output: {
        verdicts: [],
        selectedIds: [],
        candidateIds: [],
        explanation: 'No candidates to evaluate after deterministic filtering.',
        unmetConstraints: [],
        source: 'model',
      },
      modelEvaluated: 0,
      cacheHits: 0,
    };
  }

  const cache = context.verdictCache;
  let error: EvaluationModelOutput['error'];
  const outputs: EvaluationModelOutput[] = [];
  let pending = shortlist;

  // 两轮：第一轮把同批其他计划正在判的餐厅让出去等结果；等完之后若某些餐厅
  // 在当前镜头下仍然没有可复用裁决（例如它在别的关键词下判了失败），第二轮
  // 自己判。没有这一轮，并发批次会把"换个关键词本该通过"的候选吃掉。
  for (let round = 0; round < 2 && pending.length > 0; round += 1) {
    const claim = cache.claim(pending.map((restaurant) => restaurant.id), plan);
    const owned = new Set(claim.own);
    const toEvaluate = pending.filter((restaurant) => owned.has(restaurant.id));

    if (toEvaluate.length > 0) {
      emit({
        type: 'status',
        message: toEvaluate.length < rawCount
          ? `正在验证前 ${toEvaluate.length} 家候选餐厅...`
          : '正在验证候选餐厅...',
      });

      try {
        const output = await runBatchedEvaluationModel({
          signal: context.signal,
          metricsSink: context,
          goal: context.goal,
          plan,
          restaurants: toEvaluate,
          existingCandidates: context.candidates.map((candidate) => ({
            restaurant: candidate.restaurant,
            verdict: candidateToVerdict(candidate),
            sourceAttempt: candidate.sourceAttempt,
          })),
          targetCount: context.targetCount,
          preferenceSummary: context.preferenceSummary,
        });
        cache.settle(output.verdicts, plan);
        outputs.push(output);
      } catch (evaluationError) {
        if (isAbortError(evaluationError)) {
          throw evaluationError;
        }
        error = evaluationFailureFromError(evaluationError);
        context.evaluationFailed = true;
        context.evaluationError = isAgentError(evaluationError)
          ? evaluationError
          : new AgentError(
              evaluationError instanceof Error ? evaluationError.message : String(evaluationError),
              'EVALUATION_FAILED',
              true,
              { cause: evaluationError }
            );
        // 验证失败不再合成 unverified 候选：那是拿"没验证过"冒充验证结果。
        // 失败裁决同样不入缓存，别的计划不该继承一次抖动的结论。
      } finally {
        claim.done();
      }
    } else {
      claim.done();
    }

    if (claim.waits.length > 0) {
      await Promise.all(claim.waits);
    }

    const resolved = new Set(outputs.flatMap((output) => output.verdicts.map((v) => v.restaurantId)));
    pending = shortlist.filter(
      (restaurant) => !resolved.has(restaurant.id) && !cache.lookup(restaurant.id, plan)
    );
  }

  return combinePlanVerdicts(
    shortlist,
    plan,
    cache,
    outputs.length > 0 ? mergeEvaluationOutputs(outputs, error) : undefined,
    error
  );
}

/**
 * 把模型本次产出的裁决与缓存命中的裁决合成一份计划级输出。
 *
 * 复用的是**模型原始裁决**，`primaryEligible` 仍会在 applyVerdictGuard 里
 * 与当前计划的 allowedForPrimary 相与，因此授权语义不会被缓存绕过。
 */
function combinePlanVerdicts(
  shortlist: Restaurant[],
  plan: SearchPlan,
  cache: VerdictCache,
  modelOutput: EvaluationModelOutput | undefined,
  error: EvaluationModelOutput['error']
): PlanEvaluation {
  const verdictById = new Map<string, CandidateVerdict>(
    (modelOutput?.verdicts ?? []).map((verdict) => [verdict.restaurantId, verdict])
  );
  const modelEvaluated = verdictById.size;
  let cacheHits = 0;

  for (const restaurant of shortlist) {
    if (verdictById.has(restaurant.id)) {
      continue;
    }

    const cached = cache.lookup(restaurant.id, plan);
    if (cached) {
      verdictById.set(restaurant.id, cached);
      cacheHits += 1;
    }
  }

  const restaurants = shortlist.filter((restaurant) => verdictById.has(restaurant.id));

  return {
    restaurants,
    output: {
      verdicts: restaurants.map((restaurant) => verdictById.get(restaurant.id)!),
      selectedIds: modelOutput?.selectedIds ?? [],
      candidateIds: modelOutput?.candidateIds ?? [],
      explanation: modelOutput?.explanation
        ?? `复用本轮已有裁决 ${cacheHits} 家，未重复调用候选验证。`,
      unmetConstraints: modelOutput?.unmetConstraints ?? [],
      source: resolveEvaluationSource(modelEvaluated, cacheHits, error),
      error,
    },
    error,
    modelEvaluated,
    cacheHits,
  };
}

function resolveEvaluationSource(
  modelEvaluated: number,
  cacheHits: number,
  error: EvaluationModelOutput['error']
): NonNullable<EvaluationModelOutput['source']> {
  if (error) {
    return 'error';
  }

  return modelEvaluated === 0 && cacheHits > 0 ? 'cache' : 'model';
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
  // attempt 必须先入栈：候选的准入判定要按 sourceAttempt 反查 attempt，
  // 先合并会让新候选查不到自己的 attempt，被当成不可进主推荐。
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
  mergeCandidates(context, evaluated.acceptedCandidates);

  const verdicts = verdictGuard.output.verdicts;
  // 口径与 FinalGuard 严格准入一致：observation.accepted 是可进入主推荐的家数。
  const acceptedPrimaryIds = evaluated.acceptedCandidates
    .filter((candidate) => isPrimaryRecommendationEligible(candidate, context))
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
    fetchedAt: result.fetchedAt,
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

function evaluationFailureFromError(error: unknown): NonNullable<EvaluationModelOutput['error']> {
  const message = error instanceof Error ? error.message : String(error);

  if (isAgentError(error)) {
    return {
      code: error.code === 'RATE_LIMITED' ? 'EVALUATION_RATE_LIMITED' : 'EVALUATION_AGENT_FAILED',
      message,
      retryable: error.retryable,
    };
  }

  // schema / 截断类失败由 modelClient 以普通 Error 抛出，它们是结构问题不是配置问题。
  const parseFailure = /schema|parse|invalid|truncated|function arguments/i.test(message);

  return {
    code: parseFailure ? 'EVALUATION_PARSE_ERROR' : 'EVALUATION_AGENT_FAILED',
    message,
    retryable: !parseFailure,
  };
}

async function runBatchedEvaluationModel(input: EvaluationModelInput): Promise<EvaluationModelOutput> {
  const batchSize = Math.max(1, DEFAULT_AGENT_EVALUATION_BATCH_SIZE);
  if (input.restaurants.length <= batchSize) {
    return runEvaluationModel(input);
  }

  const batches = chunkRestaurants(input.restaurants, batchSize);
  const concurrency = Math.min(
    Math.max(1, DEFAULT_AGENT_EVALUATION_CONCURRENCY),
    batches.length
  );

  try {
    const outputs = await mapWithConcurrency(batches, concurrency, (restaurants) =>
      runEvaluationModel({ ...input, restaurants })
    );
    return mergeEvaluationOutputs(outputs);
  } catch (error) {
    if (concurrency <= 1 || !isLikelyEvaluationRateLimit(error)) {
      throw error;
    }

    const outputs: EvaluationModelOutput[] = [];
    for (const restaurants of batches) {
      outputs.push(await runEvaluationModel({ ...input, restaurants }));
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

function mergeEvaluationOutputs(
  outputs: EvaluationModelOutput[],
  error?: EvaluationModelOutput['error']
): EvaluationModelOutput {
  return {
    verdicts: outputs.flatMap((output) => output.verdicts),
    selectedIds: uniqueStrings(outputs.flatMap((output) => output.selectedIds)),
    candidateIds: uniqueStrings(outputs.flatMap((output) => output.candidateIds)),
    explanation: outputs
      .map((output) => output.explanation)
      .filter(Boolean)
      .join(' '),
    unmetConstraints: uniqueStrings(outputs.flatMap((output) => output.unmetConstraints)),
    // 分批只发生在真正调模型的路径上；缓存命中在上一层就被摘走了。
    source: error ? 'error' : 'model',
    error,
  };
}

function isLikelyEvaluationRateLimit(error: unknown): boolean {
  return isAgentError(error) && error.code === 'RATE_LIMITED';
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

/**
 * 执行 policy 的追问/收敛决策。
 *
 * 收敛时给结果而不是报错：报错会让会话卡在待答状态，用户依然出不去。
 */
function askOrConverge(
  context: AgentV3Context,
  question: PendingQuestion,
  emit: EmitAgentEvent
): AgentFinalResult {
  const decision = decideAskOrConverge(context, question);

  if (decision.kind === 'converge') {
    appendTrace(context, 'runtime_decision', {
      output: {
        kind: 'clarification_stalled',
        repeated: decision.repeated,
        consecutiveAskTurns: decision.consecutiveAskTurns,
        question: question.question,
      },
    });
    context.lastQuestionFingerprint = undefined;
    context.consecutiveAskTurns = 0;

    const action = buildFinishAction(context, decision.reason, 0.5);
    appendAction(context, action, emit);
    return finish(context, action, emit, { allowClarification: false });
  }

  context.lastQuestionFingerprint = decision.nextState.lastQuestionFingerprint;
  context.consecutiveAskTurns = decision.nextState.consecutiveAskTurns;
  appendAction(context, { type: 'ask_user', question: decision.question }, emit);
  return buildPausedResult(context, decision.question);
}

function finish(
  context: AgentV3Context,
  action: Extract<AgentAction, { type: 'finish' }>,
  emit: EmitAgentEvent,
  options: { allowClarification?: boolean } = {}
): AgentFinalResult {
  emit({
    type: 'filtering',
    message: '正在为您筛选最佳推荐...',
    total: context.candidates.length,
  });

  const proposal: FinishRecommendation = {
    selectedIds: action.selectedIds,
    candidateIds: action.candidateIds,
    explanation: describeFinish(action.reason, action.explanation),
    confidence: action.confidence,
  };
  const guarded = runFinalGuard(context, proposal, 'final');
  const finalResult = assembleRecommendations(context, guarded, proposal);

  if (finalResult.restaurants.length === 0 && options.allowClarification !== false) {
    return askOrConverge(context, buildNoPrimaryQuestion(context), emit);
  }

  // 产出结果的轮次把追问计数清零：下一次遇到同样的问题应当被视为新的一次追问。
  context.lastQuestionFingerprint = undefined;
  context.consecutiveAskTurns = 0;

  const warnings = buildFinalWarnings(context, guarded);
  const finalTrace = appendTrace(context, 'final', {
    output: {
      restaurantIds: finalResult.restaurants.map((restaurant) => restaurant.id),
      candidateIds: finalResult.candidates.map((restaurant) => restaurant.id),
      explanation: finalResult.explanation,
      unmetConstraints: finalResult.unmetConstraints,
      warnings,
    },
  });
  emit({
    type: 'final',
    traceId: finalTrace.id,
    sessionId: context.sessionId,
    ...finalResult,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
  recordTurnMetrics(context, 'final');

  return {
    ...finalResult,
    ...(warnings.length > 0 ? { warnings } : {}),
    runtimeState: snapshotRuntimeState(context),
  };
}

/** 结果可用但有瑕疵时的提示。 */
function buildFinalWarnings(
  context: AgentV3Context,
  guarded: FinalGuardResult
): string[] {
  return [
    ...(context.evaluationFailed
      ? ['部分候选餐厅没能完成验证，已只保留通过验证的结果。']
      : []),
    ...(guarded.verdict === 'accepted'
      ? []
      : ['部分提议候选未通过最终校验，已降为候补或移除。']),
  ];
}

function buildPausedResult(context: AgentV3Context, question: PendingQuestion): AgentFinalResult {
  const proposal: FinishRecommendation = {
    explanation: question.reason ?? '需要用户补充信息后继续搜索。',
    confidence: 0.4,
  };
  const guarded = runFinalGuard(context, proposal, 'partial');
  const partialResult = assembleRecommendations(context, guarded, proposal);
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

function runFinalGuard(
  context: AgentV3Context,
  proposal: FinishRecommendation,
  mode: 'final' | 'partial'
): FinalGuardResult {
  const guarded = applyFinalGuard(context, proposal);
  appendTrace(context, 'guard_decision', {
    input: {
      kind: 'final',
      mode,
      selectedIds: proposal.selectedIds,
      candidateIds: proposal.candidateIds,
    },
    output: {
      verdict: guarded.verdict,
      primaryIds: guarded.primaryCandidates.map((candidate) => candidate.restaurant.id),
      backupIds: guarded.backupCandidates.map((candidate) => candidate.restaurant.id),
      violations: guarded.violations,
    },
  });
  return guarded;
}

function candidateToVerdict(candidate: RestaurantCandidate): CandidateVerdict {
  return {
    restaurantId: candidate.restaurant.id,
    status: candidate.verification.status,
    primaryEligible: candidate.verification.primaryEligible,
    confidence: candidate.verification.confidence,
    matchedItems: candidate.verification.itemMatches.map((match) => match.requestedItem),
    matchedCategories: candidate.verification.categoryMatches,
    targetEvidence: candidate.verification.targetEvidence,
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
    lastQuestionFingerprint: context.lastQuestionFingerprint,
    consecutiveAskTurns: context.consecutiveAskTurns ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 动作记录
//
// 原先住在 supervisorPlanner.ts——但"把一个动作记成一条 record"本就是执行层的事，
// 与目标理解无关。随该文件拆分一并迁入。
// ---------------------------------------------------------------------------

export function summarizeAction(action: AgentAction): string {
  if (action.type === 'search') {
    return `搜索「${action.plan.keywords.join('、')}」：${action.plan.reason}`;
  }

  if (action.type === 'ask_user') {
    return action.question.reason ?? action.question.question;
  }

  return action.explanation;
}

export function createActionRecord(action: AgentAction): AgentActionRecord {
  return {
    id: createActionId(),
    action,
    createdAt: Date.now(),
    summary: summarizeAction(action),
  };
}

function createActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
