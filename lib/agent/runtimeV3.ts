import type { Restaurant } from '@/types';
import {
  applyGoalPatch,
  clarificationNeedToPendingQuestion,
  runSearchSupervisor,
} from './supervisor';
import { evaluateSearchResult, mergeCandidates } from './evaluator';
import { applyHardConstraintGuard, applyVerdictGuard } from './guards';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import { UserGoalSchema } from './schemas/goal';
import { SearchPlanSchema } from './schemas/plan';
import { finalizeRecommendations } from './resultAssembler';
import {
  extractKnownFoodTerms,
  isGenericSearchKeyword,
  lookupFoodPoiTypes,
  normalizeSearchKeywords,
} from './poiTaxonomy';
import { applyKeywordExpansion, runKeywordExpansionAgent } from './subagents/keywordExpansionAgent';
import { runPoiTypeSelectionAgent } from './subagents/poiTypeSelectionAgent';
import { runEvaluationAgent } from './subagents/evaluationAgent';
import {
  createActionRecord,
  decideSearchSupervisorAction,
  summarizeAction,
} from './supervisorAction';
import type {
  AgentAction,
  AgentContext,
  AgentFinalResult,
  AgentInput,
  AgentObservation,
  AgentRuntimeState,
  CandidateVerdict,
  EmitAgentEvent,
  GoalPatch,
  PendingQuestion,
  RestaurantCandidate,
  SearchPlan,
  UserGoal,
} from './types';

interface AgentV3Context extends AgentContext {
  actions: NonNullable<AgentRuntimeState['actions']>;
  observations: NonNullable<AgentRuntimeState['observations']>;
  maxActions: number;
}

const DEFAULT_AGENT_MAX_SEARCH_CALLS = parsePositiveInt(process.env.AGENT_MAX_SEARCH_CALLS, 3);

interface GuardedAction {
  action: AgentAction;
  guardrails: string[];
}

export async function runSearchAgentV3(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: 'SearchSupervisorAgent 正在维护目标并选择下一步动作...' });

  const supervisorOutput = normalizeExplicitOpenRecommendation(
    input,
    await getSearchSupervisorOutput(input)
  );
  const baseGoal = resolveSupervisorGoal(input, supervisorOutput);
  const resetSearchState = shouldResetSearchStateAfterGoalUpdate(input, baseGoal);
  let goal = baseGoal;
  if (!supervisorOutput.question && baseGoal.clarificationNeeded.length === 0) {
    emit({ type: 'status', message: 'KeywordExpansionAgent 正在生成搜索联想词...' });
    goal = applyKeywordExpansion(
      baseGoal,
      await runKeywordExpansionAgent({
        goal: baseGoal,
        attempts: resetSearchState ? [] : (input.runtimeState?.attempts ?? []),
        preferenceSummary: input.preferenceSummary,
      })
    );
  }
  const context = createInitialContext(input, goal, resetSearchState);
  const clarifyingQuestion = supervisorOutput.question
    ?? getInitialClarifyingQuestion(goal);

  if (clarifyingQuestion) {
    const action: AgentAction = { type: 'ask_user', question: clarifyingQuestion };
    appendAction(context, action, emit);
    return buildPausedResult(context, clarifyingQuestion);
  }

  while (context.actions.length < context.maxActions) {
    const rawAction = await decideSearchSupervisorAction(
      {
        message: input.query,
        goal: context.goal,
        messages: input.messages ?? [],
        attempts: context.attempts,
        observations: context.observations,
        candidates: context.candidates,
        preferenceSummary: context.preferenceSummary,
        limits: {
          maxSearchCalls: context.maxSearchCalls,
          remainingSearchCalls: Math.max(0, context.maxSearchCalls - context.attempts.length),
          targetCount: context.targetCount,
        },
      },
      context
    );
    const guarded = await guardAction(rawAction, context);
    const actionRecord = appendAction(context, guarded.action, emit);

    for (const message of guarded.guardrails) {
      emit({ type: 'guardrail', actionId: actionRecord.id, message, severity: 'warn' });
    }

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

  return finish(context, {
    type: 'finish',
    explanation: '已达到 Agent 动作上限，返回当前通过验证的结果。',
    confidence: 0.6,
  }, emit);
}

function resolveSupervisorGoal(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSearchSupervisor>>
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

  throw new Error('SearchSupervisorAgent returned no goal or patch');
}

async function getSearchSupervisorOutput(
  input: AgentInput
): Promise<Awaited<ReturnType<typeof runSearchSupervisor>>> {
  try {
    return await runSearchSupervisor({
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
        nextAction: 'plan',
      };
    }

    throw error;
  }
}

function normalizeExplicitOpenRecommendation(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSearchSupervisor>>
): Awaited<ReturnType<typeof runSearchSupervisor>> {
  if (
    input.runtimeState?.pendingQuestion
    || input.runtimeState?.goal
    || !isExplicitOpenRecommendationQuery(input.query)
  ) {
    return output;
  }

  if (output.goal && hasPrimaryTargets(output.goal)) {
    return output;
  }

  return {
    goal: buildOpenRecommendationGoal(input.query, output.goal),
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
    allowBroaden: true,
  });
}

function hasPrimaryTargets(goal: UserGoal): boolean {
  return [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].some((item) => item.trim().length > 0);
}

function createInitialContext(input: AgentInput, goal: UserGoal, resetSearchState = false): AgentV3Context {
  const previousAttempts = resetSearchState ? [] : (input.runtimeState?.attempts ?? []);

  return {
    ...input,
    goal,
    attempts: [...previousAttempts],
    candidates: resetSearchState ? [] : [...(input.runtimeState?.candidates ?? [])],
    actions: resetSearchState ? [] : [...(input.runtimeState?.actions ?? [])],
    observations: resetSearchState ? [] : [...(input.runtimeState?.observations ?? [])],
    unmetConstraints: [],
    maxSteps: 8,
    maxActions: (resetSearchState ? 0 : (input.runtimeState?.actions?.length ?? 0)) + 8,
    maxSearchCalls: previousAttempts.length + DEFAULT_AGENT_MAX_SEARCH_CALLS,
    targetCount: 8,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function shouldResetSearchStateAfterGoalUpdate(input: AgentInput, nextGoal: UserGoal): boolean {
  const previousGoal = input.runtimeState?.goal;
  if (!previousGoal || !input.runtimeState?.pendingQuestion) {
    return false;
  }

  return primaryTargetSignature(previousGoal) !== primaryTargetSignature(nextGoal);
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

async function guardAction(action: AgentAction, context: AgentV3Context): Promise<GuardedAction> {
  if (action.type === 'search') {
    return guardSearchAction(action, context);
  }

  if (action.type === 'finish') {
    return guardFinishAction(action, context);
  }

  return { action, guardrails: [] };
}

async function guardSearchAction(
  action: Extract<AgentAction, { type: 'search' }>,
  context: AgentV3Context
): Promise<GuardedAction> {
  const guardrails: string[] = [];

  if (context.attempts.length >= context.maxSearchCalls) {
    return {
      action: hasPrimaryCandidates(context)
        ? {
            type: 'finish',
            selectedIds: context.candidates
              .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
              .map((candidate) => candidate.restaurant.id),
            explanation: '已达到搜索上限，停止继续搜索。',
            confidence: 0.62,
          }
        : { type: 'ask_user', question: buildNoPrimaryQuestion(context) },
      guardrails: ['模型请求继续搜索，但本轮已达到搜索上限。'],
    };
  }

  const keywords = normalizeSearchKeywords(action.plan.keywords)
    .filter((keyword) => !context.goal.exclusions.some((exclusion) => keyword.includes(exclusion)))
    .slice(0, 5);
  if (keywords.length !== action.plan.keywords.length) {
    guardrails.push('已移除命中明确排除项的搜索关键词。');
  }

  if (keywords.length === 0) {
    return {
      action: { type: 'ask_user', question: buildNoPrimaryQuestion(context) },
      guardrails: [...guardrails, '搜索关键词全部命中排除项，已改为追问。'],
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
    guardrails.push(`已将搜索半径限制在严格距离 ${strictMax}m 内。`);
  }

  const broadIntent = action.plan.searchIntent === 'broadened'
    || action.plan.searchIntent === 'fallback';
  const allowedForPrimary = action.plan.allowedForPrimary
    && (!broadIntent || context.goal.allowBroaden);
  if (action.plan.allowedForPrimary && !allowedForPrimary) {
    guardrails.push('未获得用户放宽授权，放宽/兜底搜索结果只能进入候补。');
  }

  const planBeforePoiType = SearchPlanSchema.safeParse({
    ...action.plan,
    keywords,
    poiType: undefined,
    radiusMeters: Math.max(300, Math.min(5000, Math.round(radiusMeters))),
    allowedForPrimary,
  });

  if (!planBeforePoiType.success) {
    return {
      action: { type: 'ask_user', question: buildNoPrimaryQuestion(context) },
      guardrails: [...guardrails, `搜索计划结构无效，已改为追问：${planBeforePoiType.error.message}`],
    };
  }

  const poiTypeSelection = await runPoiTypeSelectionAgent({
    goal: context.goal,
    plan: planBeforePoiType.data,
  });
  const selectedPoiType = poiTypeSelection.typeCodes.length > 0
    ? poiTypeSelection.typeCodes.join('|')
    : undefined;

  if (action.plan.poiType && action.plan.poiType !== selectedPoiType) {
    guardrails.push('已用 PoiTypeSelectionAgent 的官方分类表选择结果替换模型/旧词表 poiType。');
  }

  const parsed = SearchPlanSchema.safeParse({
    ...planBeforePoiType.data,
    poiType: selectedPoiType,
  });

  if (!parsed.success) {
    return {
      action: { type: 'ask_user', question: buildNoPrimaryQuestion(context) },
      guardrails: [...guardrails, `POI type 选择后搜索计划无效，已改为追问：${parsed.error.message}`],
    };
  }

  if (hasTriedPlan(context, parsed.data)) {
    return {
      action: hasPrimaryCandidates(context)
        ? {
            type: 'finish',
            selectedIds: context.candidates
              .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
              .map((candidate) => candidate.restaurant.id),
            explanation: '搜索计划已经执行过，返回当前通过验证的结果。',
            confidence: 0.66,
          }
        : { type: 'ask_user', question: buildNoPrimaryQuestion(context) },
      guardrails: [...guardrails, '模型输出了重复搜索计划，已阻止重复调用。'],
    };
  }

  return {
    action: { type: 'search', plan: parsed.data },
    guardrails,
  };
}

function guardFinishAction(
  action: Extract<AgentAction, { type: 'finish' }>,
  context: AgentV3Context
): GuardedAction {
  const expansionSearch = buildExpansionSearchBeforeFinish(context);
  if (expansionSearch) {
    return {
      action: expansionSearch,
      guardrails: ['模型请求结束，但仍有未尝试的 Agent 联想关键词，已继续搜索以提高召回。'],
    };
  }

  const observedIds = new Set(context.candidates.map((candidate) => candidate.restaurant.id));
  const selectedIds = (action.selectedIds ?? []).filter((id) => observedIds.has(id));
  const candidateIds = (action.candidateIds ?? []).filter((id) => observedIds.has(id));
  const removed = (action.selectedIds ?? []).length - selectedIds.length
    + (action.candidateIds ?? []).length - candidateIds.length;

  return {
    action: {
      ...action,
      selectedIds,
      candidateIds,
    },
    guardrails: removed > 0
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

  const relatedKeywords = untriedGoalKeywords(context, context.goal.relatedKeywords);
  if (relatedKeywords.length > 0) {
    return {
      type: 'search',
      plan: buildRuntimePlan(context, relatedKeywords, 'synonym', true, '主推荐未满目标数，继续尝试 Agent 联想关键词。'),
    };
  }

  const broadenedKeywords = primaryCandidates.length === 0
    ? untriedGoalKeywords(context, context.goal.broadenedKeywords)
    : [];
  if (broadenedKeywords.length > 0) {
    return {
      type: 'search',
      plan: buildRuntimePlan(
        context,
        broadenedKeywords,
        'broadened',
        context.goal.allowBroaden,
        context.goal.allowBroaden
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
  emit({ type: 'tool_start', tool: 'search_restaurants', args: plan });

  const restaurants = await searchPlaces(plan);
  const agentEvaluation = await runEvaluationAgent({
    goal: context.goal,
    plan,
    restaurants,
    existingCandidates: context.candidates.map((candidate) => ({
      restaurant: candidate.restaurant,
      verdict: candidateToVerdict(candidate),
      sourceAttempt: candidate.sourceAttempt,
    })),
    targetCount: context.targetCount,
    preferenceSummary: context.preferenceSummary,
  });
  const hardGuard = applyHardConstraintGuard(restaurants, context.goal);
  const hardRejectedReasons = hardGuard.rejected.flatMap((item) => item.reasons);
  context.unmetConstraints.push(...hardRejectedReasons);
  if (!plan.allowedForPrimary && restaurants.length > 0) {
    context.unmetConstraints.push('未授权放宽或兜底结果只作为候补，不进入主推荐。');
  }

  const verdictGuard = applyVerdictGuard(
    agentEvaluation,
    restaurants,
    context.goal,
    plan,
    context.targetCount
  );
  const evaluated = evaluateSearchResult(
    restaurants,
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
    type: 'search_result',
    found: restaurants.length,
    total: context.candidates.length,
    restaurants: context.candidates.map((candidate) => ({
      id: candidate.restaurant.id,
      name: candidate.restaurant.name,
      cuisineType: candidate.restaurant.cuisineType,
      distance: candidate.restaurant.distance,
    })),
  });
  emit({
    type: 'tool_result',
    tool: 'search_restaurants',
    summary: {
      found: restaurants.length,
      hardRejected: hardGuard.rejected.length,
      accepted: evaluated.acceptedCandidates.length,
      total: context.candidates.length,
    },
  });
  emit({
    type: 'partial_results',
    restaurants: context.candidates
      .slice(0, context.targetCount)
      .map((candidate) => candidate.restaurant),
  });

  return {
    actionId,
    plan,
    provider: inferObservationProvider(restaurants),
    rawCount: restaurants.length,
    hardRejected: hardGuard.rejected.map((item) => ({
      restaurantId: item.restaurant.id,
      reasons: item.reasons,
    })),
    verdicts,
    acceptedPrimaryIds,
    candidateIds,
    unmetConstraints,
  };
}

function inferObservationProvider(restaurants: Restaurant[]): AgentObservation['provider'] {
  return restaurants.some((restaurant) => restaurant.source === 'osm') ? 'osm' : 'amap';
}

function appendAction(
  context: AgentV3Context,
  action: AgentAction,
  emit: EmitAgentEvent
): ReturnType<typeof createActionRecord> {
  const record = createActionRecord(action);
  context.actions.push(record);
  emit({ type: 'action', actionId: record.id, actionType: action.type, summary: summarizeAction(action) });
  return record;
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

  emit({ type: 'final', sessionId: context.sessionId, ...finalResult });

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
        '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
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
      '允许放宽': { allowBroaden: true },
    },
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
    `${attempt.searchIntent}:${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}` === key
  );
}

function untriedGoalKeywords(context: AgentV3Context, keywords: string[]): string[] {
  return keywords.filter((keyword) =>
    !hasTriedKeyword(context, keyword)
  );
}

function hasTriedKeyword(context: AgentV3Context, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return context.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

function buildRuntimePlan(
  context: AgentV3Context,
  keywords: string[],
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const normalizedKeywords = normalizeSearchKeywords(keywords);
  const poiType = normalizedKeywords.length === 1
    ? lookupFoodPoiTypes(normalizedKeywords[0]) ?? context.goal.poiType
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

function nextRuntimeRadius(context: AgentV3Context): number {
  const strictMax = getStrictDistanceMaxMeters(context.goal);
  if (strictMax !== undefined) {
    return Math.max(300, Math.min(5000, strictMax));
  }

  const latestRadius = context.attempts.at(-1)?.radius ?? 1800;
  return Math.min(5000, Math.max(300, Math.round(latestRadius * 1.25)));
}

function searchPlanKey(plan: SearchPlan): string {
  return `${plan.searchIntent}:${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
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
  };
}
