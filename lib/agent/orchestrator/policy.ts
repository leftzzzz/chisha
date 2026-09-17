/**
 * Agent 确定性策略的唯一实现，也是唯一的 planner。
 *
 * "下一步做什么"完全由这里决定：模型不再参与常规轮次的动作决策。
 * 历史上这套顺序逻辑同时存在于 runtime、目标理解与 guard 三处，
 * 阈值已经漂移过（见 docs/agent-loop-shape-review-2026-08.md 3.2）。
 *
 * 边界：这里只做"给定状态该怎么做"的确定性决策，不做语义理解（属于
 * Supervisor / KeywordExpansion），也不做候选准入（属于 FinalGuard）。
 */

import { countDistinctBrands } from '@/lib/restaurantIdentity';
import { getAmapFoodPoiType } from '../amapPoiTypeCatalog';
import {
  isOpenExplorationAuthorized,
  isSearchIntentAuthorizedForPrimary,
  primaryAuthorizationRef,
} from '../authorization';
import { isPrimaryRecommendationEligible } from '../finalGuard';
import type { FinishReason } from '../finishReason';
import {
  applyClarificationOptionToGoal,
  clarificationOptionLabel,
  getStrictDistanceMaxMeters,
  hasClarificationOption,
} from '../goal';
import { validateSearchPlan } from '../guards';
import type { ContextInvalidationPlan } from '../goalVersion';
import {
  hasTriedIntent,
  hasTriedKeyword,
  hasTriedPlan,
  searchPlanKey,
} from '../searchAttempts';
import {
  canonicalizePoiTerm,
  DEFAULT_POI_TYPE,
  lookupFoodPoiTypes,
  normalizeSearchKeywords,
} from '../poiTaxonomy';
import { SearchPlanSchema } from '../schemas/plan';
import { createSearchAction, isPrimaryScopeAuthorized, searchRelationFromIntent } from '../searchAction';
import {
  buildQuestionFingerprint,
  CLARIFICATION_OPTION,
  clarificationOption,
} from '../clarificationOptions';
import type {
  AgentErrorCode,
  AgentInput,
  ClarificationEffect,
  ConversationMode,
  GuardrailViolation,
  PendingQuestion,
  PolicyContext,
  RestaurantCandidate,
  SearchIntent,
  SearchKeywordTarget,
  SearchPlan,
  UserGoal,
} from '../types';

export { hasTriedIntent, hasTriedKeyword, hasTriedPlan, searchPlanKey };
export { getStrictDistanceMaxMeters };
export type { PolicyContext };

export type TargetKind = 'initial' | 'related' | 'broadened';

/**
 * 策略阈值的唯一来源。
 *
 * 这两个数此前分别写在 planner（min(6, targetCount)）与 runtime
 * guard（targetCount）里，在 6–8 个品牌的区间给出相反结论。合并到这里。
 */
export const POLICY_LIMITS = {
  /** 达到这么多个不同品牌即可考虑结束 */
  ENOUGH_DISTINCT_BRANDS: 3,
  /**
   * 低于这个品牌数就继续尝试联想词，即使已经够结束。
   *
   * 取 targetCount（转盘要 8 个格子）而不是更小的值：开启 fan-out 后同一批
   * 里多铺一个关键词不增加串行步数，多样性几乎是免费的。关掉 fan-out 时这个
   * 阈值会换成多搜一轮——那是回滚路径上可以接受的代价。
   */
  KEEP_EXPANDING_BELOW: 8,
} as const;

/**
 * 一批最多铺开几个搜索计划。
 *
 * 关掉并行开关时恒为 1，行为与串行完全一致——这是 fan-out 的回滚开关。
 */
export function maxPlansPerBatch(): number {
  if (process.env.AGENT_PARALLEL_SEARCH === 'false') {
    return 1;
  }

  const configured = Number.parseInt(process.env.AGENT_SEARCH_CONCURRENCY ?? '', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 3;
}

const DEFAULT_RADIUS_METERS = 1800;
const MIN_RADIUS_METERS = 300;
const MAX_RADIUS_METERS = 5000;
const RADIUS_GROWTH = 1.25;
const MAX_POI_TYPE_CODES = 5;
const OPEN_EXPLORATION_FALLBACK_KEYWORDS = ['餐厅', '美食'];

/** 被 guard 拒绝的计划；策略生成的计划违规即 bug，交给 Runtime 记录与上报。 */
export interface RejectedPlan {
  plan: SearchPlan;
  violations: GuardrailViolation[];
}

/** 策略给 Runtime 的决策。Runtime 只负责执行，不再自行推导下一步。 */
export type PolicyDecision =
  | { kind: 'search'; plans: SearchPlan[]; rejectedPlans: RejectedPlan[] }
  | {
      kind: 'finish';
      reason: FinishReason;
      selectedIds: string[];
      candidateIds: string[];
      confidence: number;
    }
  /** 确定性关键词全部试完仍无主推荐，交给模型重新构思方向 */
  | { kind: 'replan'; exhausted: { triedKeywords: string[]; triedIntents: SearchIntent[] } }
  | { kind: 'ask'; question: PendingQuestion }
  /** 本批计划全部未通过 guard——策略 bug，需要上报后重新决策 */
  | { kind: 'invalid_plans'; rejectedPlans: RejectedPlan[] }
  /**
   * 本轮无法给出任何可信结果，必须以错误结束。
   *
   * 策略层不抛错（保持纯函数），由 Runtime 决定用哪个 AgentError 抛出。
   */
  | { kind: 'abort'; reason: Extract<AgentErrorCode, 'EVALUATION_FAILED'> };

/** decideNextAction 需要的额外运行时状态。 */
export interface PolicyRuntimeState {
  /** 本轮是否已经用掉了那次 replan 机会 */
  replanUsed?: boolean;
}

// ---------------------------------------------------------------------------
// 决策
// ---------------------------------------------------------------------------

/**
 * 决定下一步做什么。
 *
 * 分支顺序即优先级：验证不可用就立刻收敛 > 够了就结束 > 预算耗尽 >
 * 有未授权候补就请求授权 > 还有可搜的就搜 > 有主推荐就结束 >
 * 还能重新构思就 replan > 追问。
 */
export function decideNextAction(
  ctx: PolicyContext,
  runtime: PolicyRuntimeState = {}
): PolicyDecision {
  // 验证环节挂了就别再搜了：搜回来的东西没人能验证，继续扩搜只是在
  // 重复调用高德（线上实测同一批 POI 被"火锅/涮锅/牛肉火锅"搜了三遍）。
  if (ctx.evaluationFailed) {
    return hasPrimaryCandidates(ctx)
      ? finishDecision(ctx, 'PARTIAL_EVALUATION_FAILURE', 0.6)
      : { kind: 'abort', reason: 'EVALUATION_FAILED' };
  }

  const distinctBrands = distinctPrimaryBrandCount(ctx);
  const remainingSearchCalls = Math.max(0, ctx.maxSearchCalls - ctx.attempts.length);

  if (distinctBrands >= enoughDistinctBrands(ctx) && !shouldKeepExpanding(ctx, distinctBrands)) {
    return finishDecision(ctx, 'ENOUGH_PRIMARY', 0.82);
  }

  if (remainingSearchCalls <= 0) {
    return hasPrimaryCandidates(ctx)
      ? finishDecision(ctx, 'SEARCH_BUDGET_EXHAUSTED', 0.62)
      : { kind: 'ask', question: buildNoPrimaryQuestion(ctx) };
  }

  // 已经有通过验证、只差一个授权就能进主推荐的候补：该问，不该继续搜。
  if (hasUnauthorizedBroadenedCandidates(ctx)) {
    return { kind: 'ask', question: buildNoPrimaryQuestion(ctx) };
  }

  // 计划在这里就过一遍 guard：策略自己生成的计划违规属于编程错误，不该等到
  // Runtime 才发现，更不该像以前那样"记为已尝试再重新决策"绕过去——那会把
  // 策略侧的 bug 伪装成"这个词搜过了"。
  const { plans, rejectedPlans } = partitionPlansByValidity(
    ctx,
    planSearchBatch(ctx, remainingSearchCalls)
  );
  if (plans.length > 0) {
    return { kind: 'search', plans, rejectedPlans };
  }

  // 一批全被拒：这是策略侧的 bug，必须响。单独给一个决策类型，Runtime 据此
  // 按 error 级别上报并把它们记为已尝试，然后再决策一次。
  if (rejectedPlans.length > 0) {
    return { kind: 'invalid_plans', rejectedPlans };
  }

  if (hasPrimaryCandidates(ctx)) {
    return finishDecision(ctx, 'NO_MORE_STRATEGY', 0.68);
  }

  if (!runtime.replanUsed) {
    return {
      kind: 'replan',
      exhausted: {
        triedKeywords: Array.from(new Set(ctx.attempts.flatMap((attempt) => attempt.keywords))),
        triedIntents: Array.from(new Set(ctx.attempts.map((attempt) => attempt.searchIntent))),
      },
    };
  }

  return { kind: 'ask', question: buildNoPrimaryQuestion(ctx) };
}

/**
 * 铺开这一步要执行的搜索计划。
 *
 * 顺序：用户明确目标 > 开放探索兜底 > 联想词 > 相邻品类 > 通用兜底。
 * 同一批里只放同一类目标，避免"还没搜用户说的东西就先去搜相邻品类"。
 */
export function planSearchBatch(
  ctx: PolicyContext,
  remainingSearchCalls = Math.max(0, ctx.maxSearchCalls - ctx.attempts.length),
  maxPlans = maxPlansPerBatch()
): SearchPlan[] {
  const budget = Math.max(0, Math.min(maxPlans, remainingSearchCalls));
  if (budget === 0) {
    return [];
  }

  const distinctBrands = distinctPrimaryBrandCount(ctx);

  const initial = untriedTargets(ctx, 'initial');
  if (initial.length > 0) {
    return buildPlanBatch(ctx, initial, 'exact', () => true, budget, '先搜索用户明确表达的餐饮目标。');
  }

  if (isOpenExplorationContext(ctx) && !hasTriedIntent(ctx, 'fallback')) {
    // 开放推荐优先铺开 KeywordExpansion 给的探索词（规则 1b 把它们放在
    // broadenedTargets）。只搜一个通用词「餐厅」等于把选择权交给高德排序，
    // 转盘的品类分布全看运气。
    const exploration = untriedTargets(ctx, 'broadened');
    if (exploration.length > 0) {
      const explorationPlans = buildPlanBatch(
        ctx,
        exploration,
        'fallback',
        () => true,
        budget,
        '开放推荐：并发尝试多个探索方向，保证品类多样性。'
      );

      if (explorationPlans.length > 0) {
        return explorationPlans;
      }
    }

    return buildPlanBatch(
      ctx,
      [{ keyword: nextFallbackKeyword(ctx) }],
      'fallback',
      () => true,
      1,
      '开放需求下没有可用的探索词，使用通用餐饮兜底搜索。'
    );
  }

  const related = untriedTargets(ctx, 'related');
  const broadened = untriedTargets(ctx, 'broadened');
  const broadenedAuthorized = (target: SearchKeywordTarget) =>
    isSearchIntentAuthorizedForPrimary(ctx.goal, 'broadened', [target.keyword]);

  // 一个结果都没有：优先换镜头而不是加深同一个镜头。把预算全花在同义词上
  // 会把相邻品类饿死——用户要的是"有没有能吃的"，不是"同义词穷举得全不全"。
  if (distinctBrands === 0 && (related.length > 0 || broadened.length > 0)) {
    const diverse = [
      ...buildPlanBatch(ctx, related.slice(0, 1), 'synonym', () => true, 1, '原始目标没有结果，先试一个联想关键词。'),
      ...buildPlanBatch(ctx, broadened, 'broadened', broadenedAuthorized, budget, '原始目标没有结果，同时尝试相邻品类。'),
    ].slice(0, budget);

    if (diverse.length > 0) {
      return diverse;
    }
  }

  if (related.length > 0 && distinctBrands < POLICY_LIMITS.KEEP_EXPANDING_BELOW) {
    return buildPlanBatch(
      ctx,
      related,
      'synonym',
      () => true,
      budget,
      '主推荐未满目标数，继续尝试联想关键词。'
    );
  }

  if (broadened.length > 0 && distinctBrands === 0) {
    return buildPlanBatch(
      ctx,
      broadened,
      'broadened',
      broadenedAuthorized,
      budget,
      '原始目标没有结果，尝试相邻品类。'
    );
  }

  if (isOpenExplorationAuthorized(ctx.goal) && !hasTriedIntent(ctx, 'fallback')) {
    return buildPlanBatch(
      ctx,
      [{ keyword: nextFallbackKeyword(ctx) }],
      'fallback',
      () => true,
      1,
      '开放需求下使用通用餐饮兜底搜索。'
    );
  }

  return [];
}

function buildPlanBatch(
  ctx: PolicyContext,
  targets: SearchKeywordTarget[],
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: (target: SearchKeywordTarget) => boolean,
  budget: number,
  reason: string
): SearchPlan[] {
  const plans: SearchPlan[] = [];
  const usedKeywords = new Set<string>();

  for (const target of targets) {
    if (plans.length >= budget) {
      break;
    }

    const [keyword] = normalizeSearchKeywords([target.keyword]);
    if (!keyword || usedKeywords.has(keyword) || hitsExclusion(ctx.goal, keyword)) {
      continue;
    }

    const authorized = allowedForPrimary(target);
    const plan = buildSearchPlan(
      ctx,
      target,
      searchIntent,
      authorized,
      authorized ? reason : `${reason}未获授权，结果只作为候补。`
    );

    if (hasTriedPlan(ctx, plan) || plans.some((existing) => searchPlanKey(existing) === searchPlanKey(plan))) {
      continue;
    }

    usedKeywords.add(keyword);
    plans.push(plan);
  }

  return plans;
}

function finishDecision(
  ctx: PolicyContext,
  reason: FinishReason,
  confidence: number
): Extract<PolicyDecision, { kind: 'finish' }> {
  const primary = primaryCandidates(ctx);
  const primarySet = new Set(primary);

  return {
    kind: 'finish',
    reason,
    selectedIds: primary.slice(0, ctx.targetCount).map((candidate) => candidate.restaurant.id),
    candidateIds: ctx.candidates
      .filter((candidate) => !primarySet.has(candidate))
      .slice(0, 20)
      .map((candidate) => candidate.restaurant.id),
    confidence,
  };
}

function enoughDistinctBrands(ctx: PolicyContext): number {
  return Math.min(POLICY_LIMITS.ENOUGH_DISTINCT_BRANDS, ctx.targetCount);
}

/** 已经够结束，但还值不值得再多搜一轮。 */
function shouldKeepExpanding(ctx: PolicyContext, distinctBrands: number): boolean {
  if (ctx.attempts.length >= ctx.maxSearchCalls) {
    return false;
  }

  const wantsMoreVariety = distinctBrands
    < Math.min(POLICY_LIMITS.KEEP_EXPANDING_BELOW, ctx.targetCount);

  return (wantsMoreVariety && hasUntriedTarget(ctx, 'related'))
    || (distinctBrands === 0 && hasUntriedTarget(ctx, 'broadened'));
}

function hitsExclusion(goal: UserGoal, keyword: string): boolean {
  return goal.exclusions.some((exclusion) => exclusion && keyword.includes(exclusion));
}

/**
 * 开放探索的通用兜底词。
 *
 * 一次搜索只能带一个意图词，按顺序取第一个未尝试过的。
 */
function nextFallbackKeyword(ctx: PolicyContext): string {
  return OPEN_EXPLORATION_FALLBACK_KEYWORDS.find((keyword) => !hasTriedKeyword(ctx, keyword))
    ?? OPEN_EXPLORATION_FALLBACK_KEYWORDS[0];
}

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
  legacyAllowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const rawKeyword = typeof target === 'string' ? target : target.keyword;
  const targetPoiTypes = typeof target === 'string' ? undefined : target.poiTypes;
  const keyword = rawKeyword.trim();

  const action = createSearchAction({
    query: keyword,
    supportsGoalIds: ctx.goal.goalId ? [ctx.goal.goalId] : [],
    relation: searchRelationFromIntent(searchIntent),
    rationale: reason,
    // Legacy/unversioned contexts have no stable scope to bind an explicit
    // widening authorization to. Keep their old SearchPlan compatibility path,
    // but never mint a scoped SearchAction authorization for them.
    authorizationRef: ctx.goal.goalId
      ? primaryAuthorizationRef(ctx.goal, searchIntent, [keyword])
      : undefined,
  });
  const derivedPrimaryScopeAuthorized = isPrimaryScopeAuthorized(ctx.goal, action);
  // 只有没有稳定 goalId 的旧上下文才保留旧布尔值兼容。带 goalId 的新动作
  // 必须完全由 Runtime 按 relation + authorizationRef 派生，不能回退到调用者传值。
  const effectiveAllowedForPrimary = derivedPrimaryScopeAuthorized
    || (!ctx.goal.goalId && legacyAllowedForPrimary);

  return SearchPlanSchema.parse({
    keywords: [keyword],
    radiusMeters: nextSearchRadius(ctx),
    poiType: resolvePlanPoiType(ctx.goal, keyword, targetPoiTypes),
    searchIntent,
    allowedForPrimary: effectiveAllowedForPrimary,
    reason,
    planId: createPlanId(),
    searchAction: ctx.goal.goalId ? action : undefined,
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

/**
 * 追问文案里的目标描述。
 *
 * requestedItems / primaryKeywords / acceptableCategories 三个字段本来就会
 * 指向同一个东西（说「柠檬茶」时三处都填柠檬茶），直接拼接会得到
 * 「柠檬茶、柠檬茶」。
 *
 * 去重键用 canonicalizePoiTerm——那是规则库里已有的确定性同义词归一，
 * 不是新造的相似度判断。刻意**不**做「柠檬茶≈柠檬水」这种近义合并：那属于
 * 语义推断，只能由模型角色 做；在这里写等于给"词是否同一"造第二个真理源。
 * 词表认为不同的词就分别显示——它确实分别搜过。
 *
 * 显示的是首次出现的原词而非 canonical，用户说「柠檬茶」就不该被回显成「奶茶」。
 */
export function primaryTargetLabel(goal: UserGoal): string {
  const seen = new Set<string>();
  const labels: string[] = [];

  for (const term of [
    ...goal.requestedItems.map((item) => item.name),
    ...goal.primaryKeywords,
    ...goal.acceptableCategories.map((category) => category.name),
  ]) {
    const trimmed = term.trim();
    if (!trimmed) {
      continue;
    }

    const key = canonicalizePoiTerm(trimmed);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    labels.push(trimmed);
  }

  return labels.slice(0, 3).join('、');
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

// 迁移期与 FinalGuard 共用严格准入口径，避免策略结束后再由下游补位。
export function primaryCandidates(ctx: PolicyContext): RestaurantCandidate[] {
  return ctx.candidates.filter((candidate) => isPrimaryRecommendationEligible(candidate, ctx));
}

export function hasPrimaryCandidates(ctx: PolicyContext): boolean {
  return ctx.candidates.some((candidate) => isPrimaryRecommendationEligible(candidate, ctx));
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
  // 验证不可用不再走追问：那是系统故障，应该报错而不是伪装成"没找到"。
  // 见 decideNextAction 的 evaluationFailed 分支。

  if (getStrictDistanceMaxMeters(ctx.goal) !== undefined) {
    return {
      reason: '当前严格距离范围内没有找到通过主推荐准入的餐厅。',
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      options: [
        clarificationOption(CLARIFICATION_OPTION.EXPAND_DISTANCE),
        clarificationOption(CLARIFICATION_OPTION.CHANGE_TARGET),
      ],
      allowFreeText: true,
      optionEffects: {
        [CLARIFICATION_OPTION.EXPAND_DISTANCE]: {
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

  const target = primaryTargetLabel(ctx.goal);

  return {
    reason: '没有找到通过主推荐准入的餐厅。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
      : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    options: [
      clarificationOption(CLARIFICATION_OPTION.AUTHORIZE_CATEGORY_BROADEN),
      clarificationOption(CLARIFICATION_OPTION.CHANGE_TARGET),
    ],
    allowFreeText: true,
    optionEffects: {
      [CLARIFICATION_OPTION.AUTHORIZE_CATEGORY_BROADEN]: buildBroadenEffect(ctx.goal),
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
      options: canAskFallback
        ? [
            clarificationOption(CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY),
            clarificationOption(CLARIFICATION_OPTION.CHANGE_TARGET),
          ]
        : undefined,
      allowFreeText: true,
      optionEffects: canAskFallback
        ? { [CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY]: buildFallbackPrimaryEffect() }
        : undefined,
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
      allowFreeText: true,
    };
  }

  return null;
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

// ---------------------------------------------------------------------------
// 计划校验
// ---------------------------------------------------------------------------

/**
 * 按 guard 结论把一批计划分成可执行与被拒两堆。
 *
 * 策略层自己调 guard 而不是让 Runtime 调：这样"什么计划可以执行"始终是一个
 * 判断，Runtime 只负责把被拒的那堆报出去。
 */
export function partitionPlansByValidity(
  ctx: PolicyContext,
  plans: SearchPlan[]
): { plans: SearchPlan[]; rejectedPlans: RejectedPlan[] } {
  const valid: SearchPlan[] = [];
  const rejectedPlans: RejectedPlan[] = [];

  for (const plan of plans) {
    const violations = validateSearchPlan(plan, ctx);
    if (violations.length === 0) {
      valid.push(plan);
    } else {
      rejectedPlans.push({ plan, violations });
    }
  }

  return { plans: valid, rejectedPlans };
}

// ---------------------------------------------------------------------------
// 本轮入口
// ---------------------------------------------------------------------------

/**
 * 本轮从哪儿开始。
 *
 * 两条互斥的入口：用户点了追问选项（按 id 查 effect，确定性执行，不调模型），
 * 或者用户输入了自由文本（交给 GoalUnderstandingModel，代码不猜语义）。
 *
 * 返回 `understand` 时 Runtime 才去调模型；其余分支全程无模型参与。
 */
export type TurnEntryDecision =
  /** 交给目标理解模型角色，message 是要送进去的那句话 */
  | { kind: 'understand'; message: string }
  /** 选项带 effect：确定性打补丁 */
  | { kind: 'apply_effect'; goal: UserGoal; conversationMode: ConversationMode }
  /** 「重试」：原样重跑本轮，不动 goal */
  | { kind: 'rerun_current_goal'; goal: UserGoal }
  /** 「换个类型」：等用户说新需求 */
  | { kind: 'ask'; goal: UserGoal; question: PendingQuestion }
  /** 选项已失效或没有可执行内容；Runtime 据此抛 INVALID_OPTION */
  | { kind: 'invalid_option'; optionId: string; reason: 'unavailable' | 'no_label' };

export function decideTurnEntry(input: AgentInput): TurnEntryDecision {
  const optionId = input.optionId?.trim();
  if (!optionId) {
    return { kind: 'understand', message: input.query };
  }

  const previousGoal = input.runtimeState?.goal;
  const pendingQuestion = input.runtimeState?.pendingQuestion;

  if (!previousGoal || !hasClarificationOption(pendingQuestion, optionId)) {
    return { kind: 'invalid_option', optionId, reason: 'unavailable' };
  }

  // 「重试」：原样重跑本轮，不动 goal、不改会话模式。
  // 历史 bug：把"重试"当成一句新需求喂给模型，rawQuery 被改写成「重试」，
  // 整个会话的搜索结果被 start_new_goal 清空。
  if (optionId === CLARIFICATION_OPTION.RETRY_TURN) {
    return { kind: 'rerun_current_goal', goal: previousGoal };
  }

  // 「换个类型」没有 effect：它的语义就是"等用户说新的需求"。
  if (optionId === CLARIFICATION_OPTION.CHANGE_TARGET) {
    return {
      kind: 'ask',
      goal: previousGoal,
      question: {
        reason: '用户选择更换搜索目标。',
        question: '想换成什么？直接说菜品或菜系，例如「牛排」「川菜」。',
        allowFreeText: true,
      },
    };
  }

  const patchedGoal = applyClarificationOptionToGoal(previousGoal, pendingQuestion, optionId);
  if (patchedGoal) {
    return { kind: 'apply_effect', goal: patchedGoal, conversationMode: 'patch_current_goal' };
  }

  // 没有 effect 的选项：模型写的「火锅」「日料」这类，本质是替用户预填的
  // 一句回答。把 label 当自由文本交给模型角色——语义判断仍归模型。
  const label = clarificationOptionLabel(pendingQuestion, optionId);
  return label
    ? { kind: 'understand', message: label }
    : { kind: 'invalid_option', optionId, reason: 'no_label' };
}

// ---------------------------------------------------------------------------
// 上下文重置
// ---------------------------------------------------------------------------

export interface SearchStateResetPlan {
  clearAttempts: boolean;
  clearCandidates: boolean;
  clearActionHistory: boolean;
  clearObservations: boolean;
  reason?: string;
}

/**
 * 会话模式与上下文变化 → 该清空哪些搜索状态。
 *
 * "这句话与上文是什么关系"是语义判断，归 GoalUnderstandingModel；
 * "因此要不要作废已经搜到的东西"是策略判断，归这里。
 */
export function decideContextReset(
  conversationMode: ConversationMode,
  invalidationPlan: ContextInvalidationPlan
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

// ---------------------------------------------------------------------------
// 追问前探路
// ---------------------------------------------------------------------------

/** 追问前探路用的通用词：只为看清附近有哪些品类，不产生推荐。 */
const SCOUTING_KEYWORD = '餐厅';

export type ScoutDecision =
  | { kind: 'skip' }
  | { kind: 'scout'; plan: SearchPlan };

/**
 * 追问之前要不要先探一次路。
 *
 * 追问发生在搜索之前，模型对"这一带有什么"一无所知，只能复述自己 prompt 里的
 * 例子（线上实测三次都是「火锅/日料/川菜/西餐」）。用户已经说了想吃什么就不必
 * 探——那时问的不是品类。
 */
export function decideScouting(ctx: PolicyContext): ScoutDecision {
  if (hasPositiveFoodTarget(ctx.goal)) {
    return { kind: 'skip' };
  }

  return {
    kind: 'scout',
    plan: buildSearchPlan(
      ctx,
      { keyword: SCOUTING_KEYWORD },
      'fallback',
      false,
      '追问前探路：了解附近实际的餐厅品类分布。'
    ),
  };
}

// ---------------------------------------------------------------------------
// 追问 / 收敛
// ---------------------------------------------------------------------------

/** 连续追问上限：到顶就收敛，不再把同一类问题继续抛给用户。 */
export const MAX_CONSECUTIVE_ASK_TURNS = 3;

/** 追问计数的持久化状态。 */
export interface AskState {
  lastQuestionFingerprint?: string;
  consecutiveAskTurns?: number;
}

export type AskDecision =
  | { kind: 'ask'; question: PendingQuestion; nextState: Required<AskState> }
  | { kind: 'converge'; reason: Extract<FinishReason, 'CLARIFICATION_STALLED'>; repeated: boolean; consecutiveAskTurns: number };

/**
 * 抛出这个问题，还是就地收敛。
 *
 * Agent loop 的基本要求是每一轮可度量地前进。同一个问题连问两次说明这一轮
 * 什么都没推进——线上就是这样把用户锁死的：降级追问反复重发，前端到达追问
 * 上限后又只留下一个后端消费不了的按钮。
 */
export function decideAskOrConverge(state: AskState, question: PendingQuestion): AskDecision {
  const fingerprint = buildQuestionFingerprint(question);
  const askTurns = state.consecutiveAskTurns ?? 0;
  const repeated = state.lastQuestionFingerprint === fingerprint;

  if (repeated || askTurns >= MAX_CONSECUTIVE_ASK_TURNS) {
    return {
      kind: 'converge',
      reason: 'CLARIFICATION_STALLED',
      repeated,
      consecutiveAskTurns: askTurns,
    };
  }

  return {
    kind: 'ask',
    question,
    nextState: {
      lastQuestionFingerprint: fingerprint,
      consecutiveAskTurns: askTurns + 1,
    },
  };
}
