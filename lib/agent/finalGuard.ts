import type {
  AgentContext,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';
import { isCandidateFreshForContext } from './goalVersion';
import {
  isBroadSearchIntent,
  isOpenExplorationAuthorized,
  isSearchIntentAuthorizedForPrimary,
} from './authorization';
import { getRestaurantIdentityKeys, getRestaurantInfoScore, getRestaurantBrand, countDistinctBrands } from '@/lib/restaurantIdentity';

export interface FinalGuardResult {
  primaryCandidates: RestaurantCandidate[];
  backupCandidates: RestaurantCandidate[];
  unmetConstraints: string[];
}

export function applyFinalGuard(
  context: AgentContext,
  proposed?: FinishRecommendation
): FinalGuardResult {
  const orderedCandidates = orderCandidates(context, proposed);
  const recommendationCandidates = isRandomRecommendationContext(context)
    ? seededShuffleCandidates(orderedCandidates, randomRecommendationSeed(context))
    : dedupeCandidatesForRecommendation(orderedCandidates);
  const strictPrimary = recommendationCandidates
    .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
    .slice(0, context.targetCount);
  // 严格准入凑不满时，用"品类兼容但菜单未验证"的候选补齐，避免菜品级目标
  // 因为 POI 没有菜单字段而永远空手而归。补进来的带 warning，见 buildUnmetConstraints。
  const categoryBackfill = strictPrimary.length >= context.targetCount
    ? []
    : recommendationCandidates
      .filter((candidate) => !strictPrimary.includes(candidate))
      .filter((candidate) => isCategoryCompatiblePrimaryAllowed(candidate, context))
      .slice(0, context.targetCount - strictPrimary.length);
  const primaryCandidates = [...strictPrimary, ...categoryBackfill];
  const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.restaurant.id));
  const backupCandidates = recommendationCandidates
    .filter((candidate) => !primaryIds.has(candidate.restaurant.id))
    .filter((candidate) => isBackupRecommendationAllowed(candidate))
    .slice(0, 20);

  return {
    primaryCandidates,
    backupCandidates,
    unmetConstraints: buildUnmetConstraints(context, primaryCandidates, proposed),
  };
}

/**
 * 主推荐准入所需的最小上下文。
 * AgentContext / PolicyContext 均结构性满足，便于策略层复用。
 */
export type CandidateAdmissionContext = Pick<AgentContext, 'goal' | 'attempts' | 'location'>;

export function isPrimaryRecommendationAllowed(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  if (candidate.verification.status !== 'passed') {
    return false;
  }

  if (!candidate.verification.primaryEligible) {
    return false;
  }

  if (!passesSearchAuthorizationGates(candidate, context)) {
    return false;
  }

  const sourceAttempt = context.attempts[candidate.sourceAttempt - 1]!;
  if (hasRequiredItems(context)) {
    return candidate.verification.itemMatches.length > 0
      || (
        candidate.verification.primaryEligible
        && isBroadSearchIntent(sourceAttempt.searchIntent)
        && isSearchIntentAuthorizedForPrimary(
          context.goal,
          sourceAttempt.searchIntent,
          sourceAttempt.keywords
        )
      );
  }

  return true;
}

/**
 * 品类兼容、但菜单层面无法验证的候选，是否可以补进主推荐。
 *
 * 存在的理由：POI 事实字段里根本没有菜单，所以"这家店有柠檬茶"这种菜品级
 * 断言，除非店名恰好写着，否则**永远**验证不出来。严格准入因此在这类目标上
 * 是一条构造上不可达的线——线上表现就是广东能出结果、成都武汉全军覆没。
 *
 * 这里放宽的只有"菜品是否验证到"这一项。排除项、停业、距离硬约束、搜索授权
 * 一条都不放，且只在严格准入凑不满目标数时才启用，补进来的会带 warning。
 */
export function isCategoryCompatiblePrimaryAllowed(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  if (candidate.verification.status !== 'unverified') {
    return false;
  }

  if (candidate.verification.categoryMatches.length === 0) {
    return false;
  }

  return passesSearchAuthorizationGates(candidate, context);
}

/**
 * 决策层判断"这一轮到底有没有主推荐"的口径。
 *
 * 必须与 applyFinalGuard 的装配口径一致：policy 用严格准入去决定要不要追问、
 * finalGuard 却能靠品类补位装配出结果，就会出现"策略说没有、装配说有 3 家"
 * 的分裂——线上表现是明明能给结果却弹了追问。
 */
export function isPrimaryRecommendationEligible(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  return isPrimaryRecommendationAllowed(candidate, context)
    || isCategoryCompatiblePrimaryAllowed(candidate, context);
}

/** 与"菜品验证到没有"无关的那部分准入：新鲜度、硬约束、搜索授权。 */
function passesSearchAuthorizationGates(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  if (!isCandidateFreshForContext(candidate, context)) {
    return false;
  }

  if (candidate.verification.hardFailures.length > 0) {
    return false;
  }

  const sourceAttempt = context.attempts[candidate.sourceAttempt - 1];
  if (!sourceAttempt || sourceAttempt.allowedForPrimary === false) {
    return false;
  }

  if (
    isBroadSearchIntent(sourceAttempt.searchIntent)
    && !isSearchIntentAuthorizedForPrimary(
      context.goal,
      sourceAttempt.searchIntent,
      sourceAttempt.keywords
    )
  ) {
    return false;
  }

  return true;
}

function isBackupRecommendationAllowed(candidate: RestaurantCandidate): boolean {
  return candidate.verification.status !== 'failed';
}

function orderCandidates(
  context: AgentContext,
  proposed?: FinishRecommendation
): RestaurantCandidate[] {
  const byId = new Map(context.candidates.map((candidate) => [candidate.restaurant.id, candidate]));
  const proposedIds = [
    ...(proposed?.selectedIds ?? []),
    ...(proposed?.candidateIds ?? []),
  ];
  const proposedCandidates = proposedIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is RestaurantCandidate => Boolean(candidate));
  const seen = new Set(proposedCandidates.map((candidate) => candidate.restaurant.id));
  const remaining = context.candidates.filter((candidate) => !seen.has(candidate.restaurant.id));

  return [...proposedCandidates, ...remaining].sort(compareCandidate);
}

function isRandomRecommendationContext(context: AgentContext): boolean {
  return isOpenExplorationAuthorized(context.goal)
    && !hasExplicitPrimaryTargets(context)
    && context.attempts.some((attempt) => attempt.searchIntent === 'fallback');
}

function hasExplicitPrimaryTargets(context: AgentContext): boolean {
  return [
    ...context.goal.primaryKeywords,
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.acceptableCategories.map((category) => category.name),
  ].some((target) => target.trim().length > 0);
}

function randomRecommendationSeed(context: AgentContext): string {
  return [
    context.sessionId,
    context.goal.rawQuery,
    context.location.lat.toFixed(4),
    context.location.lng.toFixed(4),
    context.attempts.map((attempt) =>
      `${attempt.searchIntent}:${attempt.keywords.join(',')}:${attempt.radius}`
    ).join(';'),
  ].filter(Boolean).join('|');
}

/**
 * 开放推荐的候选排序：先按探索方向轮转，方向内再随机。
 *
 * 只随机不轮转的话，候选基数大的方向会把转盘吃满——线上实测「随便推荐」
 * 并发搜了火锅/甜品/小吃，结果 8 个格子里 5 个火锅 3 个甜品，小吃一家没进。
 * 用户要的是"帮我挑几个方向"，不是"哪个方向搜到的多就给哪个"。
 */
function seededShuffleCandidates(
  candidates: RestaurantCandidate[],
  seed: string
): RestaurantCandidate[] {
  const shuffled = dedupeCandidatesForRecommendation(candidates)
    .map((candidate, index) => ({
      candidate,
      index,
      key: hashString(`${seed}:${candidate.restaurant.id}:${candidate.restaurant.name}`),
    }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((item) => item.candidate);

  return interleaveBySearchDirection(shuffled);
}

/**
 * 按来源 attempt（即搜索方向）轮转取候选。
 *
 * 方向内顺序保持传入顺序（已随机），方向之间轮流出一个，直到取完。
 */
function interleaveBySearchDirection(
  candidates: RestaurantCandidate[]
): RestaurantCandidate[] {
  const buckets = new Map<number, RestaurantCandidate[]>();

  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.sourceAttempt);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(candidate.sourceAttempt, [candidate]);
    }
  }

  if (buckets.size <= 1) {
    return candidates;
  }

  const queues = Array.from(buckets.values());
  const interleaved: RestaurantCandidate[] = [];

  for (let round = 0; interleaved.length < candidates.length; round += 1) {
    for (const queue of queues) {
      const candidate = queue[round];
      if (candidate) {
        interleaved.push(candidate);
      }
    }
  }

  return interleaved;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function dedupeCandidatesForRecommendation(
  candidates: RestaurantCandidate[]
): RestaurantCandidate[] {
  const candidateMap = new Map<string, RestaurantCandidate>();
  const deduped: RestaurantCandidate[] = [];
  const brandSeen = new Map<string, RestaurantCandidate>();

  for (const candidate of candidates) {
    const keys = getRestaurantIdentityKeys(candidate.restaurant);
    const existing = keys
      .map((key) => candidateMap.get(key))
      .find((item): item is RestaurantCandidate => Boolean(item));

    if (!existing) {
      const brand = getRestaurantBrand(candidate.restaurant);
      if (brand) {
        const existingBrand = brandSeen.get(brand);
        if (existingBrand) {
          if (shouldReplaceRecommendationCandidate(existingBrand, candidate)) {
            const idx = deduped.indexOf(existingBrand);
            if (idx >= 0) deduped[idx] = candidate;
            brandSeen.set(brand, candidate);
          }
          continue;
        }
        brandSeen.set(brand, candidate);
      }
      deduped.push(candidate);
      keys.forEach((key) => candidateMap.set(key, candidate));
      continue;
    }

    if (shouldReplaceRecommendationCandidate(existing, candidate)) {
      const existingIndex = deduped.indexOf(existing);
      if (existingIndex >= 0) {
        deduped[existingIndex] = candidate;
      }

      new Set([
        ...getRestaurantIdentityKeys(existing.restaurant),
        ...keys,
      ]).forEach((key) => candidateMap.set(key, candidate));
    }
  }

  return deduped;
}

function shouldReplaceRecommendationCandidate(
  existing: RestaurantCandidate,
  candidate: RestaurantCandidate
): boolean {
  const rank = compareCandidate(candidate, existing);
  if (rank !== 0) {
    return rank < 0;
  }

  return getRestaurantInfoScore(candidate.restaurant) > getRestaurantInfoScore(existing.restaurant);
}

function compareCandidate(a: RestaurantCandidate, b: RestaurantCandidate): number {
  const statusRank = verificationRank(b) - verificationRank(a);
  if (statusRank !== 0) {
    return statusRank;
  }

  if (b.score !== a.score) {
    return b.score - a.score;
  }

  return (a.restaurant.distance ?? Infinity) - (b.restaurant.distance ?? Infinity);
}

function verificationRank(candidate: RestaurantCandidate): number {
  if (candidate.verification.status === 'passed') return 3;
  if (candidate.verification.status === 'unverified') return 2;
  return 1;
}

function buildUnmetConstraints(
  context: AgentContext,
  primaryCandidates: RestaurantCandidate[],
  proposed?: FinishRecommendation
): string[] {
  const unmet = [
    ...context.unmetConstraints,
    ...context.goal.ambiguity,
    ...(proposed?.unmetConstraints ?? []),
  ];

  if (primaryCandidates.length < context.targetCount) {
    const brandCount = countDistinctBrands(primaryCandidates.map((c) => c.restaurant));
    unmet.push(`只找到 ${brandCount} 个不同品牌的餐厅（共 ${primaryCandidates.length} 家）。`);
  }

  const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.restaurant.id));
  const backfilledCount = primaryCandidates.filter((candidate) =>
    candidate.verification.status === 'unverified'
  ).length;
  if (backfilledCount > 0) {
    unmet.push(`其中 ${backfilledCount} 家按品类匹配推荐，未能确认菜单，请以门店实际供应为准。`);
  }

  const hasUnverifiedBackups = context.candidates.some((candidate) =>
    candidate.verification.status === 'unverified'
    && !primaryIds.has(candidate.restaurant.id)
  );
  if (hasUnverifiedBackups) {
    unmet.push('部分候补缺少可验证字段，未进入主推荐。');
  }

  const hasUnauthorizedBroadened = context.attempts.some((attempt) =>
    isBroadSearchIntent(attempt.searchIntent)
    && (
      attempt.allowedForPrimary === false
      || !isSearchIntentAuthorizedForPrimary(context.goal, attempt.searchIntent, attempt.keywords)
    )
  );
  if (hasUnauthorizedBroadened) {
    unmet.push('未获得对应授权 scope 的放宽或兜底结果只作为候补，不进入主推荐。');
  }

  const hasStaleCandidates = context.candidates.some((candidate) => candidate.stale);
  if (hasStaleCandidates) {
    unmet.push('部分候选来自旧目标或旧位置，需重新验证后才能进入主推荐。');
  }

  for (const constraint of context.goal.hardConstraints) {
    if (constraint.kind === 'budget') {
      unmet.push('预算信息依赖餐厅人均字段；当前数据源缺失时不会编造价格。');
    }

    if (constraint.kind === 'open_now') {
      unmet.push('营业状态只过滤数据源明确标记为停业的餐厅，未知状态会保留并提示。');
    }
  }

  return Array.from(new Set(unmet.filter(Boolean)));
}

function hasRequiredItems(context: CandidateAdmissionContext): boolean {
  return context.goal.requestedItems.some((item) => item.required);
}
