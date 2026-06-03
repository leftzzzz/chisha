import { logger } from '@/lib/logger';
import { AgentActionSchema } from './schemas/action';
import {
  callJsonFunctionAgent,
  JSON_FUNCTION_MAX_TOKENS,
  JSON_FUNCTION_RETRY_MAX_TOKENS,
} from './modelClient';
import { DEFAULT_POI_TYPE, lookupFoodPoiTypes, normalizeSearchKeywords } from './poiTaxonomy';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import {
  isOpenExplorationAuthorized,
  isSearchIntentAuthorizedForPrimary,
} from './authorization';
import { getAmapFoodPoiType } from './amapPoiTypeCatalog';
import {
  runSearchSupervisor,
  type SearchSupervisorInput,
  type SearchSupervisorOutput,
} from './supervisor';
import type {
  AgentAction,
  AgentActionRecord,
  AgentContext,
  AgentMessage,
  AgentObservation,
  RestaurantCandidate,
  SearchAttempt,
  SearchKeywordTarget,
  SearchPlan,
  UserPreferenceSummary,
} from './types';

export {
  applyGoalPatch,
  applySupervisorClarifyingAnswer,
  clarificationNeedToPendingQuestion,
  understandSearchGoal,
} from './supervisor';
export type { SearchSupervisorInput, SearchSupervisorOutput } from './supervisor';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SUPERVISOR_PLANNER_ACTION_TIMEOUT = 60000;
const SUPERVISOR_PLANNER_ACTION_MAX_TOKENS = JSON_FUNCTION_MAX_TOKENS;
const SUPERVISOR_PLANNER_ACTION_RETRY_MAX_TOKENS = JSON_FUNCTION_RETRY_MAX_TOKENS;
const MIN_PRIMARY_BEFORE_OPTIONAL_EXPANSION = 6;

export interface SupervisorPlannerActionInput {
  message: string;
  goal: AgentContext['goal'];
  messages: AgentMessage[];
  attempts: SearchAttempt[];
  observations: AgentObservation[];
  candidates: RestaurantCandidate[];
  preferenceSummary?: UserPreferenceSummary;
  rewriteInstruction?: string;
  limits: {
    maxSearchCalls: number;
    remainingSearchCalls: number;
    targetCount: number;
  };
}

export type SupervisorPlannerInput = SearchSupervisorInput | SupervisorPlannerActionInput;

export interface SupervisorPlannerOutput extends SearchSupervisorOutput {
  action?: AgentAction;
}

const ACTION_SYSTEM_PROMPT = `你是 SupervisorPlannerAgent，也是餐厅搜索唯一策略 planner。你必须在每轮只输出一个 AgentAction。

可选动作：
1. search：给出下一次 search_restaurants 的 SearchPlan。
2. ask_user：需求不足、需要授权放宽、没有可验证主推荐时追问。
3. finish：已有足够可验证候选或达到合理搜索边界时结束。

硬规则：
- 不要编造餐厅事实、距离、营业状态、评分、菜单或排队情况。
- 不要生成高德 typecode；poiType 只能为空或沿用输入中已有值。
- SearchPlan.keywords 必须是单个餐饮意图词数组，例如 ["牛排"] 或 ["川菜","咖啡"]；不要输出整句，也不要用 "|" 拼接多个关键词。
- strict 距离、明确排除项、不吃辣等硬约束不能被自动放宽。
- 用户没有 allowBroaden 时，broadened/fallback 搜索的 allowedForPrimary 必须为 false。
- selectedIds 只能来自候选摘要中的 id；未验证或 failed 候选不能作为主推荐。
- relatedKeywords 还有未尝试词且主推荐少于目标数时，优先继续 search，不要过早 finish。
- 当 goal 没有明确主目标但 allowBroaden=true 时，第一轮优先 fallback 到通用餐饮词；通用结果不足时再尝试 broadenedKeywords。
- ask_user 必须包含非空 question.question，且 question.question 必须是可直接展示给用户的中文问句。
- ask_user 如果给出选项，尽量为选项提供 optionEffects。选项标签只是分类说明时，effect 必须指向历史上下文里的真实目标，不能把选项标签当搜索词。`;
const ACTION_REWRITE_PROMPT = `如果输入里包含 rewriteInstruction，说明上一轮 action 被 Runtime Guard 拒绝或要求重写。你必须根据 rewriteInstruction 修正 action；不要重复输出相同违规动作。`;

const ACTION_FUNCTION = {
  name: 'decideRestaurantSearchAction',
  description: 'Choose one controlled restaurant-search AgentAction.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['search', 'ask_user', 'finish'] },
      plan: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          radiusMeters: { type: 'number' },
          poiType: { type: 'string' },
          searchIntent: { type: 'string', enum: ['exact', 'synonym', 'broadened', 'fallback'] },
          allowedForPrimary: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      question: {
        type: 'object',
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 240 },
          question: { type: 'string', minLength: 1, maxLength: 160 },
          options: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 32 } },
          allowFreeText: { type: 'boolean' },
          optionEffects: {
            type: 'object',
            additionalProperties: actionClarificationEffectJsonSchema(),
          },
        },
        required: ['question'],
      },
      selectedIds: { type: 'array', items: { type: 'string' } },
      candidateIds: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['type'],
  },
};

export async function runSupervisorPlanner(
  input: SupervisorPlannerInput,
  context?: AgentContext
): Promise<SupervisorPlannerOutput> {
  if (isActionPlanningInput(input)) {
    if (!context) {
      throw new Error('SupervisorPlannerAgent action planning requires AgentContext');
    }

    return {
      action: await decideSupervisorPlannerAction(input, context),
    };
  }

  return runSearchSupervisor(input);
}

export async function decideSupervisorPlannerAction(
  input: SupervisorPlannerActionInput,
  context: AgentContext
): Promise<AgentAction> {
  if (shouldForceOpenExplorationSearch(input, context)) {
    return deterministicSupervisorPlannerAction(input, context);
  }

  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicSupervisorPlannerAction(input, context);
  }

  try {
    return await callSupervisorPlannerActionModel(input);
  } catch (error) {
    logger.warn('SupervisorPlannerAgent action model unavailable, using deterministic action', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicSupervisorPlannerAction(input, context);
  }
}

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

function isActionPlanningInput(input: SupervisorPlannerInput): input is SupervisorPlannerActionInput {
  return 'goal' in input && 'limits' in input;
}

function actionClarificationEffectJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      replaceRequestedItems: { type: 'array', items: { type: 'string' } },
      replaceCategories: { type: 'array', items: { type: 'string' } },
      replacePrimaryKeywords: { type: 'array', items: { type: 'string' } },
      addRequestedItems: { type: 'array', items: { type: 'string' } },
      addCategories: { type: 'array', items: { type: 'string' } },
      addSoftPreferences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            weight: { type: 'number' },
            verifiable: { type: 'boolean' },
          },
          required: ['name', 'weight', 'verifiable'],
        },
      },
      setDistanceMaxMeters: { type: 'number' },
      addAuthorizations: { type: 'array', items: actionAuthorizationJsonSchema() },
      allowBroaden: { type: 'boolean' },
    },
  };
}

function actionAuthorizationJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['distance_expansion', 'category_broaden', 'fallback_primary', 'unverified_backup_only'],
      },
      createdAt: { type: 'number' },
      sourceQuestionId: { type: 'string' },
      reason: { type: 'string' },
      constraints: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxMeters: { type: 'number' },
          allowedSearchIntents: {
            type: 'array',
            items: { type: 'string', enum: ['exact', 'synonym', 'broadened', 'fallback'] },
          },
          allowedKeywords: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['kind', 'reason'],
  };
}

function deterministicSupervisorPlannerAction(
  input: SupervisorPlannerActionInput,
  context: AgentContext
): AgentAction {
  const primaryCandidates = context.candidates.filter((candidate) =>
    isPrimaryRecommendationAllowed(candidate, context)
  );

  const shouldTryRelatedKeywords = hasUntriedRelatedKeywords(context)
    && primaryCandidates.length < Math.min(MIN_PRIMARY_BEFORE_OPTIONAL_EXPANSION, context.targetCount);
  const shouldTryBroadenedKeywords = hasUntriedBroadenedKeywords(context)
    && primaryCandidates.length === 0;

  if (
    primaryCandidates.length >= Math.min(3, context.targetCount)
    && !shouldTryRelatedKeywords
    && !shouldTryBroadenedKeywords
  ) {
    return {
      type: 'finish',
      selectedIds: primaryCandidates.slice(0, context.targetCount).map((candidate) => candidate.restaurant.id),
      candidateIds: context.candidates
        .filter((candidate) => !primaryCandidates.includes(candidate))
        .slice(0, 20)
        .map((candidate) => candidate.restaurant.id),
      explanation: '已找到通过主推荐准入的候选，停止继续搜索。',
      confidence: 0.82,
    };
  }

  if (input.limits.remainingSearchCalls <= 0) {
    return primaryCandidates.length > 0
      ? {
          type: 'finish',
          selectedIds: primaryCandidates.map((candidate) => candidate.restaurant.id),
          explanation: '已达到搜索上限，返回当前通过验证的结果。',
          confidence: 0.62,
        }
      : buildFailureQuestionAction(context);
  }

  if (hasUnauthorizedBroadenedCandidates(context)) {
    return buildFailureQuestionAction(context);
  }

  const exactTarget = nextUntriedInitialTarget(context);
  if (exactTarget) {
    return {
      type: 'search',
      plan: buildPlan(context, exactTarget, 'exact', true, '先搜索用户明确表达的餐饮目标。'),
    };
  }

  if (isOpenExplorationContext(context) && !hasTriedIntent(context, 'fallback')) {
    return {
      type: 'search',
      plan: buildPlan(context, ['餐厅', '美食'], 'fallback', true, '开放需求下先使用通用餐饮兜底搜索。'),
    };
  }

  const relatedTarget = nextUntriedRelatedTarget(context);
  if (relatedTarget && !hasTriedIntent(context, 'synonym')) {
    return {
      type: 'search',
      plan: buildPlan(context, relatedTarget, 'synonym', true, '原始搜索不足，继续尝试同义词和近似表达。'),
    };
  }

  const broadenedTarget = nextUntriedBroadenedTarget(context);
  const broadenedTargetAuthorized = broadenedTarget
    ? isSearchIntentAuthorizedForPrimary(context.goal, 'broadened', [broadenedTarget.keyword])
    : false;
  if (broadenedTarget && primaryCandidates.length === 0) {
    return {
      type: 'search',
      plan: buildPlan(
        context,
        broadenedTarget,
        'broadened',
        broadenedTargetAuthorized,
        broadenedTargetAuthorized
          ? '用户允许放宽，扩展到相邻品类。'
          : '原始目标不足，搜索相邻品类作为候补。'
      ),
    };
  }

  if (relatedTarget) {
    return {
      type: 'search',
      plan: buildPlan(context, relatedTarget, 'synonym', true, '原始搜索不足，继续尝试同义词和近似表达。'),
    };
  }

  if (broadenedTarget) {
    return {
      type: 'search',
      plan: buildPlan(
        context,
        broadenedTarget,
        'broadened',
        broadenedTargetAuthorized,
        broadenedTargetAuthorized
          ? '用户允许放宽，扩展到相邻品类。'
          : '原始目标不足，搜索相邻品类作为候补。'
      ),
    };
  }

  if (isOpenExplorationAuthorized(context.goal) && !hasTriedIntent(context, 'fallback')) {
    return {
      type: 'search',
      plan: buildPlan(context, ['餐厅', '美食'], 'fallback', true, '开放需求下使用通用餐饮兜底搜索。'),
    };
  }

  if (primaryCandidates.length > 0) {
    return {
      type: 'finish',
      selectedIds: primaryCandidates.map((candidate) => candidate.restaurant.id),
      explanation: '没有更多可验证搜索策略，返回当前通过验证的推荐。',
      confidence: 0.68,
    };
  }

  return buildFailureQuestionAction(context);
}

function shouldForceOpenExplorationSearch(
  input: SupervisorPlannerActionInput,
  context: AgentContext
): boolean {
  if (
    !isOpenExplorationAuthorized(context.goal)
    || input.limits.remainingSearchCalls <= 0
    || initialKeywords(context).length > 0
  ) {
    return false;
  }

  const primaryCandidates = context.candidates.some((candidate) =>
    isPrimaryRecommendationAllowed(candidate, context)
  );
  if (primaryCandidates) {
    return false;
  }

  return hasUntriedBroadenedKeywords(context)
    || hasUntriedRelatedKeywords(context)
    || !hasTriedIntent(context, 'fallback');
}

function buildFailureQuestionAction(context: AgentContext): AgentAction {
  const target = [
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.primaryKeywords,
  ].filter(Boolean).slice(0, 3).join('、');
  const hasStrictDistance = context.goal.hardConstraints.some((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  if (hasStrictDistance) {
    return {
      type: 'ask_user',
      question: {
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
      },
    };
  }

  return {
    type: 'ask_user',
    question: {
      reason: '没有找到通过主推荐准入的餐厅，需要用户调整或授权放宽。',
      question: target
        ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
        : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
      options: ['允许放宽', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '允许放宽': allowBroadenQuestionEffect(context),
      },
    },
  };
}

function allowBroadenQuestionEffect(
  context: AgentContext
): NonNullable<Extract<AgentAction, { type: 'ask_user' }>['question']['optionEffects']>[string] {
  const hasPrimaryTarget = initialKeywords(context).length > 0;
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

function buildPlan(
  context: AgentContext,
  target: string[] | SearchKeywordTarget,
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const targetKeywords = Array.isArray(target) ? target : [target.keyword];
  const normalizedKeywords = normalizeSearchKeywords(targetKeywords);
  const targetPoiTypes = Array.isArray(target) ? undefined : target.poiTypes;
  const poiType = normalizedKeywords.length === 1
    ? resolvePlanPoiType(normalizedKeywords[0], targetPoiTypes, context)
    : undefined;

  return {
    keywords: normalizedKeywords.length > 0 ? normalizedKeywords : ['餐厅'],
    radiusMeters: nextRadius(context),
    poiType: poiType === DEFAULT_POI_TYPE ? undefined : poiType,
    searchIntent,
    allowedForPrimary,
    reason,
  };
}

function initialKeywords(context: AgentContext): string[] {
  return [
    ...context.goal.primaryKeywords,
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.acceptableCategories.map((category) => category.name),
  ].filter(Boolean);
}

function isOpenExplorationContext(context: AgentContext): boolean {
  return isOpenExplorationAuthorized(context.goal) && initialKeywords(context).length === 0;
}

function nextUntriedInitialTarget(context: AgentContext): SearchKeywordTarget | null {
  return untriedGoalTargets(context, undefined, initialKeywords(context))[0] ?? null;
}

function hasUntriedRelatedKeywords(context: AgentContext): boolean {
  return Boolean(nextUntriedRelatedTarget(context));
}

function nextUntriedRelatedTarget(context: AgentContext): SearchKeywordTarget | null {
  return untriedGoalTargets(context, context.goal.relatedTargets, context.goal.relatedKeywords)[0] ?? null;
}

function hasUntriedBroadenedKeywords(context: AgentContext): boolean {
  return Boolean(nextUntriedBroadenedTarget(context));
}

function nextUntriedBroadenedTarget(context: AgentContext): SearchKeywordTarget | null {
  return untriedGoalTargets(context, context.goal.broadenedTargets, context.goal.broadenedKeywords)[0] ?? null;
}

function untriedGoalTargets(
  context: AgentContext,
  targets: SearchKeywordTarget[] | undefined,
  fallbackKeywords: string[]
): SearchKeywordTarget[] {
  const baseTargets = targets && targets.length > 0
    ? targets
    : fallbackKeywords.map((keyword) => ({
        keyword,
        poiTypes: inferPoiTypesForGoalKeyword(context, keyword)?.split('|'),
      }));

  return baseTargets.filter((target) => !hasTriedKeyword(context, target.keyword));
}

function hasTriedKeyword(context: AgentContext, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return context.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

function hasTriedIntent(context: AgentContext, intent: string): boolean {
  return context.attempts.some((attempt) => attempt.searchIntent === intent);
}

function hasUnauthorizedBroadenedCandidates(context: AgentContext): boolean {
  return context.candidates.some((candidate) => {
    const attempt = context.attempts[candidate.sourceAttempt - 1];
    return Boolean(attempt)
      && (attempt!.searchIntent === 'broadened' || attempt!.searchIntent === 'fallback')
      && (
        attempt!.allowedForPrimary === false
        || !isSearchIntentAuthorizedForPrimary(
          context.goal,
          attempt!.searchIntent,
          attempt!.keywords
        )
      )
      && candidate.verification.status === 'passed'
      && candidate.verification.hardFailures.length === 0;
  });
}

function nextRadius(context: AgentContext): number {
  const distance = context.goal.hardConstraints.find((constraint) =>
    constraint.kind === 'distance'
  );
  const maxMeters = distance?.maxMeters
    ?? (typeof distance?.value === 'number' ? distance.value : undefined);

  if (maxMeters !== undefined) {
    return Math.max(300, Math.min(5000, maxMeters));
  }

  const latestRadius = context.attempts.at(-1)?.radius ?? 1800;
  return Math.min(5000, Math.max(300, Math.round(latestRadius * 1.25)));
}

function resolvePlanPoiType(
  keyword: string,
  targetPoiTypes: string[] | undefined,
  context: AgentContext
): string | undefined {
  const sanitizedTargetPoiTypes = Array.from(new Set(targetPoiTypes ?? []))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== DEFAULT_POI_TYPE);
  if (sanitizedTargetPoiTypes.length > 0) {
    return sanitizedTargetPoiTypes.join('|');
  }

  return inferPoiTypesForGoalKeyword(context, keyword) ?? context.goal.poiType;
}

function inferPoiTypesForGoalKeyword(context: AgentContext, keyword: string): string | undefined {
  const direct = lookupFoodPoiTypes(keyword);
  if (direct && direct !== DEFAULT_POI_TYPE) {
    return direct;
  }

  const relatedTerms = [
    ...context.goal.requestedItems
      .filter((item) => item.name === keyword || item.aliases.includes(keyword))
      .flatMap((item) => [item.name, ...item.aliases]),
    ...context.goal.acceptableCategories.map((category) => category.name),
  ];
  for (const term of relatedTerms) {
    const inferred = lookupFoodPoiTypes(term);
    if (inferred && inferred !== DEFAULT_POI_TYPE) {
      return inferred;
    }
  }

  return direct;
}

async function callSupervisorPlannerActionModel(input: SupervisorPlannerActionInput): Promise<AgentAction> {
  return callJsonFunctionAgent({
    agentName: 'SupervisorPlannerAgent action',
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: `${ACTION_SYSTEM_PROMPT}\n\n${ACTION_REWRITE_PROMPT}`,
    input: buildModelInput(input),
    functionDefinition: ACTION_FUNCTION,
    functionName: 'decideRestaurantSearchAction',
    schema: AgentActionSchema,
    temperature: 0,
    maxTokens: SUPERVISOR_PLANNER_ACTION_MAX_TOKENS,
    retryMaxTokens: SUPERVISOR_PLANNER_ACTION_RETRY_MAX_TOKENS,
    timeoutMs: SUPERVISOR_PLANNER_ACTION_TIMEOUT,
  }) as Promise<AgentAction>;
}

function buildModelInput(input: SupervisorPlannerActionInput) {
  return {
    userMessage: input.message,
    trustedContext: {
      goal: input.goal,
      messages: input.messages.slice(-8),
      preferenceSummary: input.preferenceSummary,
      rewriteInstruction: input.rewriteInstruction,
      limits: input.limits,
    },
    toolObservations: {
      untrusted: true,
      attempts: input.attempts,
      observations: input.observations.slice(-5).map((observation) => ({
        actionId: observation.actionId,
        plan: observation.plan,
        rawCount: observation.rawCount,
        hardRejected: observation.hardRejected.length,
        acceptedPrimaryIds: observation.acceptedPrimaryIds,
        candidateIds: observation.candidateIds,
        unmetConstraints: observation.unmetConstraints.slice(0, 6),
      })),
      candidates: input.candidates.slice(0, 12).map((candidate) => ({
        id: candidate.restaurant.id,
        name: candidate.restaurant.name,
        cuisineType: candidate.restaurant.cuisineType,
        distance: candidate.restaurant.distance,
        score: candidate.score,
        verification: candidate.verification,
        sourceAttempt: candidate.sourceAttempt,
      })),
    },
    policy: {
      toolObservationsAreUntrusted: true,
      selectedIdsMustComeFromCandidates: true,
      unverifiedCandidatesCannotBePrimary: true,
    },
  };
}

function createActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
