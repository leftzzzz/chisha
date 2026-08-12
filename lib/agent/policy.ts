/**
 * Agent 确定性策略的唯一实现。
 *
 * Runtime（runtimeV3）与 Planner（supervisorPlanner）都从这里取策略，
 * 不再各自维护一份——历史上两份实现已经在用户可见文案上发生过漂移。
 *
 * 这里只放"给定状态该怎么做"的确定性决策，不做语义理解（属于 Supervisor）
 * 也不做候选准入（属于 FinalGuard）。
 */

import type { Location } from '@/types';
import { countDistinctBrands } from '@/lib/restaurantIdentity';
import { getAmapFoodPoiType } from './amapPoiTypeCatalog';
import { isOpenExplorationAuthorized, isSearchIntentAuthorizedForPrimary } from './authorization';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import {
  DEFAULT_POI_TYPE,
  lookupFoodPoiTypes,
  normalizeSearchKeywords,
} from './poiTaxonomy';
import { SearchPlanSchema } from './schemas/plan';
import type {
  ClarificationEffect,
  PendingQuestion,
  RestaurantCandidate,
  SearchAttempt,
  SearchKeywordTarget,
  SearchPlan,
  UserGoal,
} from './types';

/** 策略所需的最小上下文；AgentContext / AgentV3Context 均结构性满足。 */
export interface PolicyContext {
  goal: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  location: Location;
  targetCount: number;
  maxSearchCalls: number;
  /** 本轮是否发生过候选验证失败（限流/超时等），用于区分"没搜到"与"验证不可用"。 */
  evaluationDegraded?: boolean;
}

export type TargetKind = 'initial' | 'related' | 'broadened';

const DEFAULT_RADIUS_METERS = 1800;
const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 5000;
const RADIUS_GROWTH = 1.25;
const MAX_POI_TYPE_CODES = 5;

// ---------------------------------------------------------------------------
// 搜索计划
// ---------------------------------------------------------------------------

/**
 * 构造一次搜索计划。
 *
 * 关键词经过归一化并收敛为单个餐饮意图词（见 SearchPlanSchema），
 * poiType 优先取 target 自带类型，其次按关键词推断，最后回落 goal.poiType。
 */
export function buildSearchPlan(
  ctx: PolicyContext,
  target: SearchKeywordTarget | string,
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const rawKeyword = typeof target === 'string' ? target : target.keyword;
  const targetPoiTypes = typeof target === 'string' ? undefined : target.poiTypes;
  const [normalizedKeyword] = normalizeSearchKeywords([rawKeyword]);
  const keyword = normalizedKeyword || '餐厅';

  return SearchPlanSchema.parse({
    keywords: [keyword],
    radiusMeters: nextSearchRadius(ctx),
    poiType: resolvePlanPoiType(ctx.goal, keyword, targetPoiTypes),
    searchIntent,
    allowedForPrimary,
    reason,
    planId: createPlanId(),
  });
}

/** 下一次搜索半径：strict 距离下钳制，否则按 1.25 递增。 */
export function nextSearchRadius(ctx: PolicyContext): number {
  const strictMax = getStrictDistanceMaxMeters(ctx.goal);
  if (strictMax !== undefined) {
    return clampRadius(strictMax);
  }

  const latestRadius = ctx.attempts.at(-1)?.radius ?? DEFAULT_RADIUS_METERS;
  return clampRadius(Math.round(latestRadius * RADIUS_GROWTH));
}

/** 构造计划时的 poiType 选择：target 自带 > 关键词推断 > goal.poiType。 */
export function resolvePlanPoiType(
  goal: UserGoal,
  keyword: string,
  targetPoiTypes?: string[]
): string | undefined {
  const sanitizedTargetPoiTypes = sanitizePoiTypeCodes(targetPoiTypes?.join('|'));
  if (sanitizedTargetPoiTypes.length > 0) {
    return sanitizedTargetPoiTypes.join('|');
  }

  const inferred = inferPoiTypesForGoalKeyword(goal, keyword) ?? goal.poiType;
  return inferred === DEFAULT_POI_TYPE ? undefined : inferred;
}

/** 校验模型给出的 search action 时的 poiType 选择：关键词推断优先。 */
export function resolveSearchActionPoiType(
  goal: UserGoal,
  keyword: string,
  planPoiType?: string
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

export function inferPoiTypesForGoalKeyword(
  goal: UserGoal | undefined,
  keyword: string
): string | undefined {
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

export function sanitizePoiTypeCodes(poiType: string | undefined): string[] {
  return Array.from(new Set((poiType ?? '').split('|')))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== DEFAULT_POI_TYPE)
    .slice(0, MAX_POI_TYPE_CODES);
}

export function getStrictDistanceMaxMeters(goal: UserGoal): number | undefined {
  const strictDistance = goal.hardConstraints.find(
    (constraint) => constraint.kind === 'distance' && constraint.strict
  );

  return strictDistance?.maxMeters
    ?? (typeof strictDistance?.value === 'number' ? strictDistance.value : undefined);
}

export function searchPlanKey(plan: SearchPlan): string {
  return `${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
}

export function hasTriedPlan(ctx: PolicyContext, plan: SearchPlan): boolean {
  const key = searchPlanKey(plan);
  return ctx.attempts.some(
    (attempt) =>
      `${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}` === key
  );
}

export function createPlanId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `plan_${globalThis.crypto.randomUUID()}`;
  }

  return `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// 关键词队列
// ---------------------------------------------------------------------------

export function goalPrimaryTargets(goal: UserGoal): string[] {
  return [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].filter((item) => item.trim().length > 0);
}

export function hasPositiveFoodTarget(goal: UserGoal): boolean {
  return goalPrimaryTargets(goal).length > 0;
}

export function primaryTargetLabel(goal: UserGoal): string {
  return [
    ...goal.requestedItems.map((item) => item.name),
    ...goal.primaryKeywords,
    ...goal.acceptableCategories.map((category) => category.name),
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join('、');
}

/** 返回某一类目标中尚未尝试过的关键词。 */
export function untriedTargets(ctx: PolicyContext, kind: TargetKind): SearchKeywordTarget[] {
  return baseTargets(ctx.goal, kind).filter((target) => !hasTriedKeyword(ctx, target.keyword));
}

export function nextUntriedTarget(
  ctx: PolicyContext,
  kind: TargetKind
): SearchKeywordTarget | null {
  return untriedTargets(ctx, kind)[0] ?? null;
}

export function hasUntriedTarget(ctx: PolicyContext, kind: TargetKind): boolean {
  return untriedTargets(ctx, kind).length > 0;
}

export function hasTriedKeyword(ctx: PolicyContext, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return ctx.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

export function hasTriedIntent(ctx: PolicyContext, intent: SearchPlan['searchIntent']): boolean {
  return ctx.attempts.some((attempt) => attempt.searchIntent === intent);
}

function baseTargets(goal: UserGoal, kind: TargetKind): SearchKeywordTarget[] {
  if (kind === 'initial') {
    return goalPrimaryTargets(goal).map((keyword) => toTarget(goal, keyword));
  }

  const targets = kind === 'related' ? goal.relatedTargets : goal.broadenedTargets;
  if (targets && targets.length > 0) {
    return targets;
  }

  const keywords = kind === 'related' ? goal.relatedKeywords : goal.broadenedKeywords;
  return keywords.map((keyword) => toTarget(goal, keyword));
}

function toTarget(goal: UserGoal, keyword: string): SearchKeywordTarget {
  return {
    keyword,
    poiTypes: inferPoiTypesForGoalKeyword(goal, keyword)?.split('|'),
  };
}

// ---------------------------------------------------------------------------
// 候选与授权
// ---------------------------------------------------------------------------

export function primaryCandidates(ctx: PolicyContext): RestaurantCandidate[] {
  return ctx.candidates.filter((candidate) => isPrimaryRecommendationAllowed(candidate, ctx));
}

export function hasPrimaryCandidates(ctx: PolicyContext): boolean {
  return ctx.candidates.some((candidate) => isPrimaryRecommendationAllowed(candidate, ctx));
}

export function distinctPrimaryBrandCount(ctx: PolicyContext): number {
  return countDistinctBrands(primaryCandidates(ctx).map((candidate) => candidate.restaurant));
}

export function isOpenExplorationContext(ctx: PolicyContext): boolean {
  return isOpenExplorationAuthorized(ctx.goal) && !hasPositiveFoodTarget(ctx.goal);
}

export function hasCategoryBroadenAuthorization(ctx: PolicyContext): boolean {
  return isSearchIntentAuthorizedForPrimary(ctx.goal, 'broadened', broadenedGoalKeywords(ctx.goal));
}

export function broadenedGoalKeywords(goal: UserGoal): string[] {
  return [
    ...goal.broadenedKeywords,
    ...(goal.broadenedTargets ?? []).map((target) => target.keyword),
  ].filter(Boolean);
}

/**
 * 存在"已通过验证但因缺少授权只能当候补"的放宽/兜底候选。
 * 此时应向用户请求授权，而不是继续搜索。
 */
export function hasUnauthorizedBroadenedCandidates(ctx: PolicyContext): boolean {
  return ctx.candidates.some((candidate) => {
    const attempt = ctx.attempts[candidate.sourceAttempt - 1];
    return (
      Boolean(attempt)
      && (attempt!.searchIntent === 'broadened' || attempt!.searchIntent === 'fallback')
      && (
        attempt!.allowedForPrimary === false
        || !isSearchIntentAuthorizedForPrimary(ctx.goal, attempt!.searchIntent, attempt!.keywords)
      )
      && candidate.verification.status === 'passed'
      && candidate.verification.hardFailures.length === 0
    );
  });
}

// ---------------------------------------------------------------------------
// 追问
// ---------------------------------------------------------------------------

/**
 * 没有主推荐时的追问。
 *
 * 分支优先级：strict 距离 > 已授权放宽但仍无结果 > 通用调整/放宽。
 */
export function buildNoPrimaryQuestion(ctx: PolicyContext): PendingQuestion {
  // 验证服务失败时不能说"没找到合适餐厅"——那是把系统故障说成搜索结果。
  if (ctx.evaluationDegraded && !hasPrimaryCandidates(ctx)) {
    return {
      reason: '候选验证服务暂时不可用，本轮结果无法进入主推荐。',
      question: '验证服务暂时不可用，没能确认这些餐厅是否符合你的要求。要重试一次吗？',
      options: ['重试', '换个类型'],
      allowFreeText: true,
    };
  }

  if (getStrictDistanceMaxMeters(ctx.goal) !== undefined) {
    return {
      reason: '当前严格距离范围内没有找到通过主推荐准入的餐厅。',
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      options: ['扩大范围', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        扩大范围: {
          allowBroaden: true,
          setDistanceMaxMeters: MAX_RADIUS_METERS,
          addAuthorizations: [
            {
              id: `auth_distance_expansion_${Date.now().toString(36)}`,
              kind: 'distance_expansion',
              createdAt: Date.now(),
              reason: '用户授权扩大距离范围。',
              constraints: { maxMeters: MAX_RADIUS_METERS },
            },
          ],
        },
      },
    };
  }

  const exhaustedQuestion = buildPostAuthorizationNoPrimaryQuestion(ctx);
  if (exhaustedQuestion) {
    return exhaustedQuestion;
  }

  const target = [
    ...ctx.goal.requestedItems.map((item) => item.name),
    ...ctx.goal.primaryKeywords,
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join('、');

  return {
    reason: '没有找到通过主推荐准入的餐厅。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
      : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    options: ['搜更广的品类', '换个类型'],
    allowFreeText: true,
    optionEffects: {
      搜更广的品类: buildBroadenEffect(ctx.goal),
    },
  };
}

/**
 * 已经授权放宽（或开放推荐）但仍然没有主推荐时的追问。
 * 返回 null 表示还有可尝试的策略，不该在此追问。
 */
export function buildPostAuthorizationNoPrimaryQuestion(
  ctx: PolicyContext
): PendingQuestion | null {
  if (hasPrimaryCandidates(ctx)) {
    return null;
  }

  if (hasPositiveFoodTarget(ctx.goal)) {
    if (!hasCategoryBroadenAuthorization(ctx) || hasUntriedTarget(ctx, 'broadened')) {
      return null;
    }

    const target = primaryTargetLabel(ctx.goal);
    const canAskFallback =
      !isOpenExplorationAuthorized(ctx.goal) && !hasTriedIntent(ctx, 'fallback');
    const attemptedBroadenedSearch = hasTriedIntent(ctx, 'broadened');

    return {
      reason: attemptedBroadenedSearch
        ? '已授权并尝试放宽到相邻品类，但没有找到通过主推荐准入的餐厅。'
        : '已授权放宽，但没有更多可尝试的相邻品类。',
      question: postBroadenQuestionText(target || undefined, attemptedBroadenedSearch),
      options: canAskFallback ? ['随便推荐', '换个类型'] : ['换个类型'],
      allowFreeText: true,
      optionEffects: canAskFallback ? { 随便推荐: buildFallbackPrimaryEffect() } : undefined,
    };
  }

  if (
    isOpenExplorationAuthorized(ctx.goal)
    && hasTriedIntent(ctx, 'fallback')
    && !hasUntriedTarget(ctx, 'broadened')
  ) {
    return {
      reason: '已按开放推荐搜索，但没有找到通过主推荐准入的餐厅。',
      question: '已经按开放推荐搜索过，仍没有找到合适餐厅。换个类型或补充一个想吃的方向吧。',
      options: ['换个类型'],
      allowFreeText: true,
    };
  }

  return null;
}

export function questionAsksForBroadenAuthorization(question: PendingQuestion): boolean {
  return (
    question.options?.some((option) => option.includes('放宽')) === true
    || question.question.includes('允许放宽')
    || Object.values(question.optionEffects ?? {}).some((effect) => effect.allowBroaden === true)
  );
}

/** 用户选择"放宽"时写入 goal 的授权效果。 */
export function buildBroadenEffect(goal: UserGoal): ClarificationEffect {
  const hasPrimaryTarget = hasPositiveFoodTarget(goal);
  const kind = hasPrimaryTarget ? 'category_broaden' : 'fallback_primary';
  const searchIntent = hasPrimaryTarget ? 'broadened' : 'fallback';

  return {
    allowBroaden: true,
    addAuthorizations: [
      {
        id: `auth_${kind}_${Date.now().toString(36)}`,
        kind,
        createdAt: Date.now(),
        reason: hasPrimaryTarget
          ? '用户授权放宽到相邻品类。'
          : '用户授权开放推荐，可将兜底餐饮候选作为主推荐。',
        constraints: { allowedSearchIntents: [searchIntent] },
      },
    ],
  };
}

/** 用户选择"随便推荐"时写入 goal 的授权效果。 */
export function buildFallbackPrimaryEffect(): ClarificationEffect {
  return {
    allowBroaden: true,
    addSoftPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
    addAuthorizations: [
      {
        id: `auth_fallback_primary_${Date.now().toString(36)}`,
        kind: 'fallback_primary',
        createdAt: Date.now(),
        reason: '用户授权改为开放推荐，可将兜底餐饮候选作为主推荐。',
        constraints: { allowedSearchIntents: ['fallback'] },
      },
    ],
  };
}

function postBroadenQuestionText(
  target: string | undefined,
  attemptedBroadenedSearch: boolean
): string {
  if (attemptedBroadenedSearch) {
    return target
      ? `已经放宽搜索过「${target}」相关品类，仍没有找到合适餐厅。要换个类型，还是改成随便推荐？`
      : '已经放宽搜索过相邻品类，仍没有找到合适餐厅。要换个类型，还是改成随便推荐？';
  }

  return target
    ? `没有更多「${target}」相关品类可继续搜索。要换个类型，还是改成随便推荐？`
    : '没有更多相邻品类可继续搜索。要换个类型，还是改成随便推荐？';
}

function clampRadius(radius: number): number {
  return Math.max(MIN_RADIUS_METERS, Math.min(MAX_RADIUS_METERS, Math.round(radius)));
}
