import type { Restaurant } from '@/types';
import type {
  CandidateVerdict,
  EvaluationAgentOutput,
  SearchPlan,
  UserGoal,
} from './types';
import { evaluateConstraint } from './constraintEvaluator';

export interface HardConstraintGuardResult {
  passed: Restaurant[];
  rejected: Array<{
    restaurant: Restaurant;
    reasons: string[];
  }>;
}

export interface RuntimeVerdictGuardResult {
  output: EvaluationAgentOutput;
  rejectedVerdicts: CandidateVerdict[];
}

export function applyHardConstraintGuard(
  restaurants: Restaurant[],
  goal: UserGoal
): HardConstraintGuardResult {
  const passed: Restaurant[] = [];
  const rejected: HardConstraintGuardResult['rejected'] = [];

  for (const restaurant of restaurants) {
    const reasons = goal.hardConstraints.flatMap((constraint) =>
      failedConstraintMessage(restaurant, constraint)
    );

    if (reasons.length > 0) {
      rejected.push({ restaurant, reasons });
    } else {
      passed.push(restaurant);
    }
  }

  return { passed, rejected };
}

export function applyVerdictGuard(
  evaluation: EvaluationAgentOutput,
  restaurants: Restaurant[],
  goal: UserGoal,
  plan: SearchPlan,
  targetCount: number
): RuntimeVerdictGuardResult {
  const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const rejectedVerdicts: CandidateVerdict[] = [];
  const guardedVerdictsFromModel = evaluation.verdicts
    .filter((verdict) => restaurantsById.has(verdict.restaurantId))
    .map((verdict) => {
      const restaurant = restaurantsById.get(verdict.restaurantId)!;
      const hardFailures = goal.hardConstraints.flatMap((constraint) =>
        failedConstraintMessage(restaurant, constraint)
      );
      if (hardFailures.length === 0) {
        return {
          ...verdict,
          primaryEligible: verdict.primaryEligible && plan.allowedForPrimary,
        };
      }

      const failedVerdict: CandidateVerdict = {
        ...verdict,
        status: 'failed',
        primaryEligible: false,
        confidence: Math.min(verdict.confidence, 0.2),
        conflicts: mergeStrings(verdict.conflicts, hardFailures),
        warnings: mergeStrings(verdict.warnings, hardFailures),
      };
      rejectedVerdicts.push(failedVerdict);
      return failedVerdict;
    });
  const guardedVerdicts = guardedVerdictsFromModel;
  const verdictById = new Map(guardedVerdicts.map((verdict) => [verdict.restaurantId, verdict]));
  const selectedIds = orderAllowedIds(
    evaluation.selectedIds,
    restaurantsById,
    verdictById,
    (verdict) => verdict.status === 'passed' && verdict.primaryEligible,
    targetCount
  );
  const selectedIdSet = new Set(selectedIds);
  const candidateIds = orderAllowedIds(
    evaluation.candidateIds,
    restaurantsById,
    verdictById,
    (verdict) => !selectedIdSet.has(verdict.restaurantId) && verdict.status !== 'failed',
    20
  );

  return {
    output: {
      ...evaluation,
      verdicts: guardedVerdicts,
      selectedIds,
      candidateIds,
      unmetConstraints: mergeStrings(
        evaluation.unmetConstraints,
        rejectedVerdicts.flatMap((verdict) => verdict.conflicts)
      ),
    },
    rejectedVerdicts,
  };
}

function orderAllowedIds(
  requestedIds: string[],
  restaurantsById: Map<string, Restaurant>,
  verdictById: Map<string, CandidateVerdict>,
  allow: (verdict: CandidateVerdict) => boolean,
  limit: number
): string[] {
  const dedupedIds = Array.from(new Set(requestedIds));
  const direct = dedupedIds
    .map((id) => verdictById.get(id))
    .filter((verdict): verdict is CandidateVerdict => Boolean(verdict && allow(verdict)));
  const directIds = new Set(direct.map((verdict) => verdict.restaurantId));
  const fill = Array.from(verdictById.values())
    .filter((verdict) => !directIds.has(verdict.restaurantId) && allow(verdict));

  return [...direct, ...fill]
    .sort((left, right) => compareVerdicts(left, right, restaurantsById))
    .slice(0, limit)
    .map((verdict) => verdict.restaurantId);
}

function compareVerdicts(
  left: CandidateVerdict,
  right: CandidateVerdict,
  restaurantsById: Map<string, Restaurant>
): number {
  const statusDelta = verdictRank(right) - verdictRank(left);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  const leftDistance = restaurantsById.get(left.restaurantId)?.distance ?? Infinity;
  const rightDistance = restaurantsById.get(right.restaurantId)?.distance ?? Infinity;
  return leftDistance - rightDistance;
}

function verdictRank(verdict: CandidateVerdict): number {
  if (verdict.status === 'passed') return 3;
  if (verdict.status === 'unverified') return 2;
  return 1;
}

function failedConstraintMessage(
  restaurant: Restaurant,
  constraint: UserGoal['hardConstraints'][number]
): string[] {
  if (!isDeterministicHardConstraint(constraint.kind)) {
    return [];
  }

  const result = evaluateConstraint(restaurant, constraint);
  return result.status === 'failed' ? [result.message] : [];
}

function isDeterministicHardConstraint(kind: UserGoal['hardConstraints'][number]['kind']): boolean {
  return kind === 'distance' || kind === 'budget' || kind === 'open_now';
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
