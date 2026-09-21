import type {
  AgentObservation,
  RestaurantCandidate,
  SearchAttempt,
  UserGoal,
} from './types';
import {
  isSearchIntentAuthorizedForPrimary,
  primaryAuthorizationReason,
} from './authorization';

type BroadenAdmissionState = {
  goal?: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  observations?: AgentObservation[];
};

export interface BroadenAdmissionPromotion {
  promotedAttempts: number;
  promotedCandidates: number;
}

const PROMOTION_REASON_NOTE = '用户已授权放宽，可进入主推荐。';

export function promoteAuthorizedBroadenedResults(
  state: BroadenAdmissionState
): BroadenAdmissionPromotion {
  if (!state.goal) {
    return { promotedAttempts: 0, promotedCandidates: 0 };
  }

  const promotedAttemptNumbers = new Set<number>();
  state.attempts = state.attempts.map((attempt, index) => {
    if (!isPromotableAttempt(state.goal!, attempt)) {
      return attempt;
    }

    promotedAttemptNumbers.add(index + 1);
    return {
      ...attempt,
      allowedForPrimary: true,
      reason: appendPromotionReason(
        attempt.reason,
        primaryAuthorizationReason(state.goal!, attempt.searchIntent, attempt.keywords)
      ),
    };
  });

  if (promotedAttemptNumbers.size === 0) {
    return { promotedAttempts: 0, promotedCandidates: 0 };
  }

  let promotedCandidates = 0;
  state.candidates = state.candidates.map((candidate) => {
    if (!promotedAttemptNumbers.has(candidate.sourceAttempt) || !canPromoteCandidate(candidate)) {
      return candidate;
    }

    promotedCandidates += 1;
    return {
      ...candidate,
      verification: {
        ...candidate.verification,
        primaryEligible: true,
      },
    };
  });

  state.observations = state.observations?.map((observation, index) => {
    const attemptNumber = index + 1;
    if (!promotedAttemptNumbers.has(attemptNumber)) {
      return observation;
    }

    const acceptedPrimaryIds = state.candidates
      .filter((candidate) =>
        candidate.sourceAttempt === attemptNumber
        && candidate.verification.status === 'passed'
        && candidate.verification.primaryEligible
        && candidate.verification.hardFailures.length === 0
      )
      .map((candidate) => candidate.restaurant.id);

    return {
      ...observation,
      plan: {
        ...observation.plan,
        allowedForPrimary: true,
      },
      acceptedPrimaryIds,
    };
  });

  return {
    promotedAttempts: promotedAttemptNumbers.size,
    promotedCandidates,
  };
}

export function hasPromotedBroadenedPrimaryCandidates(state: BroadenAdmissionState): boolean {
  return state.candidates.some((candidate) => {
    const attempt = state.attempts[candidate.sourceAttempt - 1];
    return attempt?.allowedForPrimary === true
      && isBroadenedAttempt(attempt)
      && attempt.reason.includes(PROMOTION_REASON_NOTE)
      && canPromoteCandidate(candidate)
      && candidate.verification.primaryEligible;
  });
}

function isPromotableAttempt(goal: UserGoal, attempt: SearchAttempt): boolean {
  return attempt.allowedForPrimary === false
    && isBroadenedAttempt(attempt)
    && isSearchIntentAuthorizedForPrimary(goal, attempt.searchIntent, attempt.keywords);
}

function isBroadenedAttempt(attempt: SearchAttempt): boolean {
  return attempt.searchIntent === 'broadened' || attempt.searchIntent === 'fallback';
}

function canPromoteCandidate(candidate: RestaurantCandidate): boolean {
  return candidate.stale !== true
    && candidate.verification.status === 'passed'
    && candidate.verification.hardFailures.length === 0;
}

function appendPromotionReason(reason: string, authorizationReason?: string): string {
  const note = authorizationReason
    ? `${PROMOTION_REASON_NOTE} 授权原因：${authorizationReason}`
    : PROMOTION_REASON_NOTE;
  return reason.includes(PROMOTION_REASON_NOTE) ? reason : `${reason} ${note}`;
}
