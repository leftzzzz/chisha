import type { Restaurant } from '@/types';
import type {
  CandidateVerdict,
  EvaluationAgentOutput,
  GuardrailViolation,
  PolicyContext,
  SearchPlan,
  UserGoal,
} from './types';
import { evaluateConstraint } from './constraintEvaluator';
import { getStrictDistanceMaxMeters } from './goal';
import { hasTriedPlan } from './searchAttempts';
import { SearchPlanSchema } from './schemas/plan';

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

/**
 * 校验一个搜索计划。
 *
 * 计划现在由 policy 生成，所以这里的任何一条违规都是编程错误，不是模型走偏。
 * Guard 因此只做"校验并拒绝"，不再改写字段、也不再请求重写——那两件事以前
 * 掩盖了策略侧的 bug（见 docs/agent-loop-shape-review-2026-08.md 3.1-B/D）。
 */
export function validateSearchPlan(plan: SearchPlan, ctx: PolicyContext): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const parsed = SearchPlanSchema.safeParse(plan);

  if (!parsed.success) {
    violations.push({
      code: 'INVALID_PLAN_SCHEMA',
      message: `搜索计划结构无效：${parsed.error.message}`,
      severity: 'error',
      details: { plan },
    });
    return violations;
  }

  const excluded = plan.keywords.filter((keyword) =>
    ctx.goal.exclusions.some((exclusion) => exclusion && keyword.includes(exclusion))
  );
  if (excluded.length > 0) {
    violations.push({
      code: 'INVALID_PLAN_SCHEMA',
      message: `搜索关键词命中明确排除项：${excluded.join('、')}`,
      severity: 'error',
      details: { plan },
    });
  }

  const strictMax = getStrictDistanceMaxMeters(ctx.goal);
  if (strictMax !== undefined && plan.radiusMeters > strictMax) {
    violations.push({
      code: 'STRICT_DISTANCE_EXCEEDED',
      message: `搜索半径 ${plan.radiusMeters}m 超出严格距离 ${strictMax}m。`,
      severity: 'error',
      details: { plan },
    });
  }

  if (hasTriedPlan(ctx, plan)) {
    violations.push({
      code: 'DUPLICATE_PLAN',
      message: '重复搜索计划已被阻止。',
      severity: 'warn',
      details: { plan },
    });
  }

  return violations;
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
