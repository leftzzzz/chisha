import type {
  AgentContext,
  AgentFinalResult,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';
import type { Restaurant } from '@/types';
import { applyFinalGuard } from './finalGuard';

export function finalizeRecommendations(
  context: AgentContext,
  proposed?: FinishRecommendation
): AgentFinalResult {
  const guarded = applyFinalGuard(context, proposed);

  return {
    restaurants: guarded.primaryCandidates.map((candidate) =>
      withRecommendationDetails(candidate, context)
    ),
    candidates: guarded.backupCandidates.map((candidate) =>
      withRecommendationDetails(candidate, context)
    ),
    explanation: buildExplanation(context, guarded.primaryCandidates, guarded.unmetConstraints, proposed),
    unmetConstraints: guarded.unmetConstraints,
  };
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
    return '需求较开放，已按通用餐饮候选和硬约束筛选后随机打散生成推荐。';
  }

  if (unmetConstraints.length > 0) {
    return '已按可验证信息筛选并排序，部分偏好当前数据源无法完全验证。';
  }

  return '已按你的需求、距离和餐厅类型匹配度排序。';
}

function withRecommendationDetails(candidate: RestaurantCandidate, context: AgentContext): Restaurant {
  const attempt = context.attempts[candidate.sourceAttempt - 1];
  const verificationWarnings = [
    ...candidate.verification.hardFailures.map((failure) => failure.message),
    ...candidate.verification.warnings,
    ...(candidate.verification.status === 'unverified' ? ['候补：数据源不足，未验证为主推荐。'] : []),
    ...(attempt?.allowedForPrimary === false ? ['候补：未授权放宽或兜底结果，不进入主推荐。'] : []),
  ];

  return {
    ...candidate.restaurant,
    recommendationReason: candidate.matched.length > 0
      ? candidate.matched.slice(0, 3).join('，')
      : '按距离和餐饮类型作为候选',
    recommendationWarnings: Array.from(new Set([...candidate.warnings, ...verificationWarnings])).slice(0, 4),
  };
}
