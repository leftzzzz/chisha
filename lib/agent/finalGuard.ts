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
import { getRestaurantIdentityKeys, getRestaurantInfoScore } from '@/lib/restaurantIdentity';

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
  const primaryCandidates = recommendationCandidates
    .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
    .slice(0, context.targetCount);
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

export function isPrimaryRecommendationAllowed(
  candidate: RestaurantCandidate,
  context: AgentContext
): boolean {
  if (!isCandidateFreshForContext(candidate, context)) {
    return false;
  }

  if (candidate.verification.status !== 'passed') {
    return false;
  }

  if (!candidate.verification.primaryEligible) {
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

function seededShuffleCandidates(
  candidates: RestaurantCandidate[],
  seed: string
): RestaurantCandidate[] {
  return dedupeCandidatesForRecommendation(candidates)
    .map((candidate, index) => ({
      candidate,
      index,
      key: hashString(`${seed}:${candidate.restaurant.id}:${candidate.restaurant.name}`),
    }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((item) => item.candidate);
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

  for (const candidate of candidates) {
    const keys = getRestaurantIdentityKeys(candidate.restaurant);
    const existing = keys
      .map((key) => candidateMap.get(key))
      .find((item): item is RestaurantCandidate => Boolean(item));

    if (!existing) {
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
    unmet.push(`只找到 ${primaryCandidates.length} 家通过主推荐准入的餐厅。`);
  }

  const hasUnverifiedBackups = context.candidates.some((candidate) =>
    candidate.verification.status === 'unverified'
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

function hasRequiredItems(context: AgentContext): boolean {
  return context.goal.requestedItems.some((item) => item.required);
}
