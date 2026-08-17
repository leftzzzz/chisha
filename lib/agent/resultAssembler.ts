import type {
  AgentContext,
  AgentFinalResult,
  FinalGuardResult,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';
import type { Restaurant } from '@/types';
import {
  isBroadSearchIntent,
  isSearchIntentAuthorizedForPrimary,
  primaryAuthorizationReason,
} from './authorization';

export function assembleRecommendations(
  context: AgentContext,
  guarded: FinalGuardResult,
  proposed?: FinishRecommendation
): AgentFinalResult {
  return {
    restaurants: guarded.primaryCandidates.map((candidate) =>
      withRecommendationDetails(candidate, context)
    ),
    candidates: guarded.backupCandidates.map((candidate) =>
      withRecommendationDetails(candidate, context)
    ),
    explanation: resultExplanation(guarded, proposed),
    unmetConstraints: guarded.unmetConstraints,
  };
}

function resultExplanation(
  guarded: FinalGuardResult,
  proposed?: FinishRecommendation
): string {
  const explanation = proposed?.explanation.trim();
  if (explanation) {
    return explanation;
  }

  return guarded.primaryCandidates.length > 0
    ? '以下是通过最终校验的推荐结果。'
    : '没有找到通过最终校验的主推荐。';
}

function withRecommendationDetails(candidate: RestaurantCandidate, context: AgentContext): Restaurant {
  const attempt = context.attempts[candidate.sourceAttempt - 1];
  const authorizationReason = attempt
    ? primaryAuthorizationReason(context.goal, attempt.searchIntent, attempt.keywords)
    : undefined;
  const unauthorizedBroadAttempt = attempt
    ? isBroadSearchIntent(attempt.searchIntent)
      && !isSearchIntentAuthorizedForPrimary(context.goal, attempt.searchIntent, attempt.keywords)
    : false;
  const verificationWarnings = [
    ...(candidate.verification.status === 'unverified' ? ['候补：数据源不足，未验证为主推荐。'] : []),
    ...(attempt?.allowedForPrimary === false || unauthorizedBroadAttempt
      ? ['候补：未获得对应授权 scope 的放宽或兜底结果，不进入主推荐。']
      : []),
    ...(authorizationReason && isBroadSearchIntent(attempt!.searchIntent)
      ? [`授权来源：${authorizationReason}`]
      : []),
    ...candidate.verification.hardFailures.map((failure) => failure.message),
    ...candidate.verification.warnings,
    ...(candidate.stale ? [candidate.staleReason ?? '候选已过期，需重新验证。'] : []),
  ];

  return {
    ...candidate.restaurant,
    recommendationReason: candidate.matched.length > 0
      ? candidate.matched.slice(0, 3).join('，')
      : candidate.verification.status === 'passed'
        ? '已通过候选验证'
        : '相关候选，目标证据仍不完整',
    recommendationWarnings: Array.from(new Set([...candidate.warnings, ...verificationWarnings])).slice(0, 4),
  };
}
