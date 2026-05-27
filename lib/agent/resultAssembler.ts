import type {
  AgentContext,
  AgentFinalResult,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';
import type { Restaurant } from '@/types';

export function finalizeRecommendations(
  context: AgentContext,
  proposed?: FinishRecommendation
): AgentFinalResult {
  const orderedCandidates = getOrderedCandidates(context, proposed);
  const primaryCandidates = orderedCandidates.filter((candidate) =>
    isPrimaryEligible(candidate, context)
  );
  const selectedCandidates = primaryCandidates.slice(0, context.targetCount);
  const selectedIds = new Set(selectedCandidates.map((candidate) => candidate.restaurant.id));
  const backupCandidates = orderedCandidates
    .filter((candidate) => !selectedIds.has(candidate.restaurant.id))
    .slice(0, 20);
  const unmetConstraints = buildUnmetConstraints(context, selectedCandidates);

  return {
    restaurants: selectedCandidates.map(withRecommendationDetails),
    candidates: backupCandidates.map(withRecommendationDetails),
    explanation: buildExplanation(context, selectedCandidates, unmetConstraints, proposed),
    unmetConstraints,
  };
}

function getOrderedCandidates(
  context: AgentContext,
  proposed?: FinishRecommendation
): RestaurantCandidate[] {
  const byId = new Map(context.candidates.map((candidate) => [candidate.restaurant.id, candidate]));

  if (!proposed || proposed.selectedIds.length === 0) {
    return [...context.candidates].sort(compareCandidate);
  }

  const proposedCandidates = proposed.selectedIds
    .map((id) => byId.get(id))
    .filter((candidate): candidate is RestaurantCandidate => Boolean(candidate));
  const proposedIds = new Set(proposedCandidates.map((candidate) => candidate.restaurant.id));
  const remaining = context.candidates.filter((candidate) => !proposedIds.has(candidate.restaurant.id));

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

function isPrimaryEligible(candidate: RestaurantCandidate, context: AgentContext): boolean {
  const attempt = context.attempts[candidate.sourceAttempt - 1];
  return candidate.verification.status === 'passed' && attempt?.allowedForPrimary !== false;
}

function buildUnmetConstraints(
  context: AgentContext,
  selectedCandidates: RestaurantCandidate[]
): string[] {
  const unmet = [...context.unmetConstraints, ...context.goal.ambiguity];

  if (selectedCandidates.length < context.targetCount) {
    unmet.push(`只找到 ${selectedCandidates.length} 家通过硬约束和相关性过滤的餐厅。`);
  }

  const exactAccepted = context.candidates.filter((candidate) =>
    context.attempts[candidate.sourceAttempt - 1]?.searchIntent === 'exact'
    && candidate.verification.status === 'passed'
  ).length;
  const hasBroadenedSelected = selectedCandidates.some((candidate) => {
    const attempt = context.attempts[candidate.sourceAttempt - 1];
    return attempt?.searchIntent === 'broadened' || attempt?.searchIntent === 'fallback';
  });

  if (context.goal.primaryKeywords.length > 0 && hasBroadenedSelected && exactAccepted < context.targetCount) {
    unmet.push(
      `明确匹配「${context.goal.primaryKeywords.join('、')}」的餐厅不足 ${context.targetCount} 家，已补充相邻品类候选。`
    );
  }

  const verificationFailures = selectedCandidates.flatMap((candidate) =>
    candidate.verification.hardFailures.map((failure) => failure.message)
  );
  unmet.push(...verificationFailures);

  for (const constraint of context.goal.hardConstraints) {
    if (constraint.kind === 'avoid_spicy') {
      continue;
    }

    if (constraint.kind === 'budget') {
      unmet.push('预算信息依赖餐厅人均字段；当前数据源缺失时不会编造价格。');
    }

    if (constraint.kind === 'open_now') {
      unmet.push('营业状态只过滤数据源明确标记为停业的餐厅，未知状态会保留并提示。');
    }
  }

  return Array.from(new Set(unmet));
}

function buildExplanation(
  context: AgentContext,
  selectedCandidates: RestaurantCandidate[],
  unmetConstraints: string[],
  proposed?: FinishRecommendation
): string {
  if (selectedCandidates.length === 0) {
    return '没有找到通过硬约束和相关性过滤的餐厅。';
  }

  if (proposed?.explanation) {
    return proposed.explanation;
  }

  const attempts = context.attempts.map((attempt) => attempt.searchIntent);
  const expanded = attempts.includes('synonym') || attempts.includes('broadened');
  const fallback = attempts.includes('fallback');

  if (expanded) {
    return `先按「${context.goal.primaryKeywords.join('、')}」搜索，结果不足后扩展到相邻品类；最终按约束、相关性和距离排序。`;
  }

  if (fallback) {
    return '需求较开放，已按通用餐饮候选、硬约束和距离生成默认推荐。';
  }

  if (unmetConstraints.length > 0) {
    return '已按可验证信息筛选并排序，部分偏好当前数据源无法完全验证。';
  }

  return '已按你的需求、距离和餐厅类型匹配度排序。';
}

function withRecommendationDetails(candidate: RestaurantCandidate): Restaurant {
  const verificationWarnings = [
    ...candidate.verification.hardFailures.map((failure) => failure.message),
    ...candidate.verification.warnings,
  ];

  return {
    ...candidate.restaurant,
    recommendationReason: candidate.matched.length > 0
      ? candidate.matched.slice(0, 3).join('，')
      : '按距离和餐饮类型作为候选',
    recommendationWarnings: Array.from(new Set([...candidate.warnings, ...verificationWarnings])).slice(0, 4),
  };
}
