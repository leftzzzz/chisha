import type { Restaurant } from '@/types';
import type {
  CandidateVerdict,
  EvaluationAgentOutput,
  SearchPlan,
  UserGoal,
} from './types';
import { deterministicEvaluation } from './subagents/evaluationAgent';
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

/**
 * @deprecated Runtime V3 no longer accepts model-generated verdicts on the
 * active path. Candidate admission now happens through verifier + FinalGuard.
 */
export function applyVerdictGuard(
  evaluation: EvaluationAgentOutput,
  restaurants: Restaurant[],
  goal: UserGoal,
  plan: SearchPlan,
  targetCount: number
): RuntimeVerdictGuardResult {
  const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const deterministicVerdictById = new Map(
    deterministicEvaluation({
      goal,
      plan,
      restaurants,
      targetCount,
    }).verdicts.map((verdict) => [verdict.restaurantId, verdict])
  );
  const rejectedVerdicts: CandidateVerdict[] = [];
  const hardRejectedIds = new Set<string>();
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
      hardRejectedIds.add(failedVerdict.restaurantId);
      return failedVerdict;
    })
    .map((verdict) => {
      if (hardRejectedIds.has(verdict.restaurantId)) {
        return verdict;
      }

      return reconcileWithDeterministicVerdict(
        verdict,
        deterministicVerdictById.get(verdict.restaurantId),
        plan
      );
    });
  const guardedVerdictIds = new Set(guardedVerdictsFromModel.map((verdict) => verdict.restaurantId));
  const missingDeterministicVerdicts = Array.from(deterministicVerdictById.values())
    .filter((verdict) => !guardedVerdictIds.has(verdict.restaurantId))
    .map((verdict) => {
      const restaurant = restaurantsById.get(verdict.restaurantId)!;
      const hardFailures = goal.hardConstraints.flatMap((constraint) =>
        failedConstraintMessage(restaurant, constraint)
      );
      if (hardFailures.length > 0) {
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
      }

      return {
        ...verdict,
        primaryEligible: verdict.primaryEligible && plan.allowedForPrimary,
      };
    });
  const guardedVerdicts = [
    ...guardedVerdictsFromModel,
    ...missingDeterministicVerdicts,
  ];
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

function reconcileWithDeterministicVerdict(
  verdict: CandidateVerdict,
  deterministicVerdict: CandidateVerdict | undefined,
  plan: SearchPlan
): CandidateVerdict {
  if (!deterministicVerdict) {
    return {
      ...verdict,
      primaryEligible: verdict.primaryEligible && plan.allowedForPrimary,
    };
  }

  if (deterministicVerdict.status === 'failed') {
    return {
      ...verdict,
      status: 'failed',
      primaryEligible: false,
      confidence: Math.min(verdict.confidence, deterministicVerdict.confidence),
      matchedItems: mergeStrings(verdict.matchedItems, deterministicVerdict.matchedItems),
      matchedCategories: mergeStrings(verdict.matchedCategories, deterministicVerdict.matchedCategories),
      conflicts: mergeStrings(verdict.conflicts, deterministicVerdict.conflicts),
      warnings: mergeStrings(verdict.warnings, deterministicVerdict.warnings),
    };
  }

  if (verdict.status === 'failed' && deterministicVerdict.status === 'passed') {
    return {
      ...verdict,
      status: 'passed',
      primaryEligible: deterministicVerdict.primaryEligible && plan.allowedForPrimary,
      confidence: Math.max(verdict.confidence, deterministicVerdict.confidence),
      matchedItems: mergeStrings(verdict.matchedItems, deterministicVerdict.matchedItems),
      matchedCategories: mergeStrings(verdict.matchedCategories, deterministicVerdict.matchedCategories),
      conflicts: [],
      evidence: mergeStrings(verdict.evidence, deterministicVerdict.evidence),
      warnings: mergeStrings(
        verdict.warnings,
        [
          ...deterministicVerdict.warnings,
          '已由 Runtime guard 根据可验证字段纠正语义判定。',
        ]
      ),
    };
  }

  const status = verdict.status === 'passed' || deterministicVerdict.status === 'passed'
    ? 'passed'
    : 'unverified';

  return {
    ...verdict,
    status,
    primaryEligible: status === 'passed'
      && plan.allowedForPrimary
      && (verdict.primaryEligible || deterministicVerdict.primaryEligible),
    confidence: Math.max(verdict.confidence, deterministicVerdict.confidence),
    matchedItems: mergeStrings(verdict.matchedItems, deterministicVerdict.matchedItems),
    matchedCategories: mergeStrings(verdict.matchedCategories, deterministicVerdict.matchedCategories),
    conflicts: mergeStrings(verdict.conflicts, deterministicVerdict.conflicts),
    evidence: mergeStrings(verdict.evidence, deterministicVerdict.evidence),
    warnings: mergeStrings(verdict.warnings, deterministicVerdict.warnings),
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
  const result = evaluateConstraint(restaurant, constraint);
  return result.status === 'failed' ? [result.message] : [];
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
