import type { Restaurant } from '@/types';
import type {
  CandidateVerdict,
  Constraint,
  EvaluationAgentOutput,
  SearchPlan,
  UserGoal,
} from './types';
import { deterministicEvaluation } from './subagents/evaluationAgent';

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
      evaluateHardConstraint(restaurant, constraint)
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
        evaluateHardConstraint(restaurant, constraint)
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
        evaluateHardConstraint(restaurant, constraint)
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

function evaluateHardConstraint(restaurant: Restaurant, constraint: Constraint): string[] {
  if (constraint.kind === 'distance') {
    const maxMeters = constraint.maxMeters
      ?? (typeof constraint.value === 'number' ? constraint.value : undefined);
    if (maxMeters !== undefined && restaurant.distance !== undefined && restaurant.distance > maxMeters) {
      return [`${restaurant.name}距离 ${restaurant.distance}m，超过${constraint.label} ${maxMeters}m。`];
    }
  }

  if (constraint.kind === 'open_now' && restaurant.businessStatus === 'closed') {
    return [`${restaurant.name}数据源标记为已停业或未营业。`];
  }

  if (constraint.kind === 'budget') {
    const range = getBudgetRange(constraint);
    if (range && restaurant.averagePrice !== undefined) {
      if (
        (range.min !== undefined && restaurant.averagePrice < range.min)
        || (range.max !== undefined && restaurant.averagePrice > range.max)
      ) {
        return [`${restaurant.name}人均约 ${restaurant.averagePrice} 元，不满足${constraint.label}。`];
      }
    }
  }

  if (constraint.kind === 'exclude_category') {
    const excludedValues = constraint.values
      ?? (Array.isArray(constraint.value) ? constraint.value : typeof constraint.value === 'string' ? [constraint.value] : []);
    const text = restaurantText(restaurant);
    const matchedValue = excludedValues.find((value) => textContains(text, value));
    return matchedValue ? [`${restaurant.name}命中排除项「${matchedValue}」。`] : [];
  }

  if (constraint.kind === 'avoid_spicy' && /辣|麻辣|香辣/.test(restaurantText(restaurant))) {
    return [`${restaurant.name}命中明确辣味风险字段。`];
  }

  return [];
}

function getBudgetRange(constraint: Constraint): { min?: number; max?: number } | null {
  if (constraint.min !== undefined || constraint.max !== undefined) {
    return {
      min: constraint.min,
      max: constraint.max,
    };
  }

  return typeof constraint.value === 'object' && !Array.isArray(constraint.value)
    ? constraint.value
    : null;
}

function restaurantText(restaurant: Restaurant): string {
  return `${restaurant.name} ${restaurant.cuisineType} ${restaurant.address}`;
}

function textContains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
