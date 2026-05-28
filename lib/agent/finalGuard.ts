import type {
  AgentContext,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';

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
  const primaryCandidates = orderedCandidates
    .filter((candidate) => isPrimaryRecommendationAllowed(candidate, context))
    .slice(0, context.targetCount);
  const primaryIds = new Set(primaryCandidates.map((candidate) => candidate.restaurant.id));
  const backupCandidates = orderedCandidates
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
  if (candidate.verification.status !== 'passed') {
    return false;
  }

  if (candidate.verification.hardFailures.length > 0) {
    return false;
  }

  const sourceAttempt = context.attempts[candidate.sourceAttempt - 1];
  if (!sourceAttempt || sourceAttempt.allowedForPrimary === false) {
    return false;
  }

  if (hasRequiredItems(context)) {
    return candidate.verification.itemMatches.length > 0
      || context.goal.allowBroaden === true;
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
    attempt.allowedForPrimary === false
    && (attempt.searchIntent === 'broadened' || attempt.searchIntent === 'fallback')
  );
  if (hasUnauthorizedBroadened) {
    unmet.push('未授权放宽或兜底结果只作为候补，不进入主推荐。');
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
