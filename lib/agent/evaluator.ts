import type { Restaurant } from '@/types';
import type {
  AgentContext,
  CandidateVerdict,
  EvaluationModelOutput,
  Observation,
  RestaurantCandidate,
  SearchPlan,
} from './types';
import { deriveGoalSignature, deriveLocationSignature } from './goalVersion';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import { getRestaurantIdentityKeys, getRestaurantInfoScore } from '@/lib/restaurantIdentity';

/** 判断某个候选按其来源 attempt 能否进入主推荐。 */
type CandidateAdmissionPredicate = (candidate: RestaurantCandidate) => boolean;

export function evaluateSearchResult(
  restaurants: Restaurant[],
  context: AgentContext,
  plan: SearchPlan,
  sourceAttempt: number,
  evaluation: EvaluationModelOutput
): Observation {
  const verdictByRestaurantId = new Map(
    evaluation.verdicts.map((verdict) => [verdict.restaurantId, verdict])
  );
  const acceptedCandidates = restaurants
    .map((restaurant) => {
      const verdict = verdictByRestaurantId.get(restaurant.id);
      return verdict && verdict.status !== 'failed'
        ? buildCandidate(restaurant, verdict, context, sourceAttempt)
        : null;
    })
    .filter((candidate): candidate is RestaurantCandidate => Boolean(candidate));

  return {
    plan,
    found: restaurants.length,
    acceptedCandidates,
    rejected: Math.max(0, restaurants.length - acceptedCandidates.length),
    reason: buildObservationReason(restaurants.length, acceptedCandidates.length, plan),
  };
}

export function mergeCandidates(
  context: AgentContext,
  incomingCandidates: RestaurantCandidate[]
): void {
  const candidateMap = new Map<string, RestaurantCandidate>();
  const candidates: RestaurantCandidate[] = [];
  const admissible = (candidate: RestaurantCandidate) =>
    isPrimaryRecommendationAllowed(candidate, context);

  for (const candidate of context.candidates) {
    mergeCandidateInto(candidates, candidateMap, candidate, admissible);
  }

  for (const incoming of incomingCandidates) {
    mergeCandidateInto(candidates, candidateMap, incoming, admissible);
  }

  context.candidates = candidates;
}

function buildCandidate(
  restaurant: Restaurant,
  verdict: CandidateVerdict,
  context: AgentContext,
  sourceAttempt: number
): RestaurantCandidate {
  const warnings = mergeStrings(
    context.goal.ambiguity,
    [...verdict.conflicts, ...verdict.warnings]
  );
  const score = calculateRecommendationUtility(restaurant, context);
  const goalSignature = context.goal.goalSignature ?? deriveGoalSignature(context.goal);
  const goalVersion = context.goal.goalVersion ?? 1;
  const goalId = context.goal.goalId ?? goalSignature;

  return {
    candidateId: `${goalId}:${goalVersion}:${restaurant.id}:${sourceAttempt}`,
    goalId,
    verifiedAgainstGoalVersion: goalVersion,
    verifiedAgainstGoalSignature: goalSignature,
    locationSignature: deriveLocationSignature(context.location),
    restaurant,
    score,
    matched: mergeStrings(verdict.evidence, [
      ...verdict.matchedItems.map((item) => `Agent 验证菜品${item}`),
      ...verdict.matchedCategories.map((category) => `Agent 验证品类${category}`),
    ]),
    warnings,
    verification: {
      restaurantId: verdict.restaurantId,
      status: verdict.status,
      primaryEligible: verdict.primaryEligible,
      hardFailures: verdict.conflicts.map((message) => ({
        kind: 'category',
        message,
      })),
      itemMatches: verdict.matchedItems.map((item) => ({
        requestedItem: item,
        matchedBy: 'llm_semantic',
        confidence: verdict.confidence,
      })),
      categoryMatches: verdict.matchedCategories,
      targetEvidence: verdict.targetEvidence,
      warnings: verdict.warnings,
      confidence: verdict.confidence,
    },
    sourceAttempt,
  };
}

/**
 * 候选打分。
 *
 * 资格与效用必须分开：模型置信度只说明目标判断把握，不说明餐厅更值得推荐。
 * 这里仅记录不跨 Provider 比较的确定性效用；同来源评分比较和品牌多样性由
 * policy 在合格集合内统一完成。
 */
function calculateRecommendationUtility(
  restaurant: Restaurant,
  context: AgentContext
): number {
  return distanceScore(restaurant.distance)
    + preferredPriceScore(restaurant.averagePrice, context.preferenceSummary?.preferredPriceRange);
}

function distanceScore(distance?: number): number {
  if (distance === undefined) {
    return 0;
  }

  if (distance <= 500) return 30;
  if (distance <= 1000) return 24;
  if (distance <= 2000) return 16;
  if (distance <= 3000) return 8;
  return 2;
}

function preferredPriceScore(
  averagePrice: number | undefined,
  preferredRange: { min?: number; max?: number } | undefined
): number {
  if (averagePrice === undefined || !preferredRange) {
    return 0;
  }

  const { min, max } = preferredRange;
  if ((min === undefined || averagePrice >= min) && (max === undefined || averagePrice <= max)) {
    return 20;
  }

  const distanceFromRange = min !== undefined && averagePrice < min
    ? min - averagePrice
    : max !== undefined && averagePrice > max
      ? averagePrice - max
      : 0;
  return Math.max(0, 12 - Math.ceil(distanceFromRange / 10) * 2);
}

function buildObservationReason(found: number, accepted: number, plan: SearchPlan): string {
  if (found === 0) {
    return `搜索「${plan.keywords.join('、')}」没有返回结果。`;
  }

  if (accepted === 0) {
    return `搜索「${plan.keywords.join('、')}」返回 ${found} 家，但都未通过 Agent 语义验证。`;
  }

  if (accepted < found) {
    return `搜索「${plan.keywords.join('、')}」返回 ${found} 家，Agent 接受 ${accepted} 家。`;
  }

  return `搜索「${plan.keywords.join('、')}」接受 ${accepted} 家候选。`;
}

function mergeCandidateInto(
  candidates: RestaurantCandidate[],
  candidateMap: Map<string, RestaurantCandidate>,
  incoming: RestaurantCandidate,
  admissible: CandidateAdmissionPredicate
): void {
  const incomingKeys = getRestaurantIdentityKeys(incoming.restaurant);
  const existing = incomingKeys
    .map((key) => candidateMap.get(key))
    .find((candidate): candidate is RestaurantCandidate => Boolean(candidate));

  if (!existing) {
    candidates.push(incoming);
    incomingKeys.forEach((key) => candidateMap.set(key, incoming));
    return;
  }

  const merged = mergeCandidate(existing, incoming, admissible);
  const existingIndex = candidates.indexOf(existing);

  if (existingIndex >= 0) {
    candidates[existingIndex] = merged;
  }

  const mergedKeys = new Set([
    ...getRestaurantIdentityKeys(existing.restaurant),
    ...incomingKeys,
    ...getRestaurantIdentityKeys(merged.restaurant),
  ]);
  mergedKeys.forEach((key) => candidateMap.set(key, merged));
}

function mergeCandidate(
  existing: RestaurantCandidate,
  incoming: RestaurantCandidate,
  admissible: CandidateAdmissionPredicate
): RestaurantCandidate {
  const preferred = shouldReplaceCandidate(existing, incoming, admissible) ? incoming : existing;
  const other = preferred === incoming ? existing : incoming;

  return {
    ...preferred,
    matched: mergeStrings(preferred.matched, other.matched),
    warnings: mergeStrings(preferred.warnings, other.warnings),
    verification: {
      ...preferred.verification,
      categoryMatches: mergeStrings(
        preferred.verification.categoryMatches,
        other.verification.categoryMatches
      ),
      warnings: mergeStrings(
        preferred.verification.warnings,
        other.verification.warnings
      ),
    },
  };
}

/**
 * 同一家餐厅被多个计划召回时，保留哪一份。
 *
 * 来源 attempt 的准入能力排在 score 之前：同一家店先被未授权的放宽搜索命中、
 * 后被 exact 搜索命中时，必须换成 exact 那份，否则它会因为 sourceAttempt
 * 指着不能进主推荐的 attempt 而永远停在候补。
 */
function shouldReplaceCandidate(
  existing: RestaurantCandidate,
  incoming: RestaurantCandidate,
  admissible: CandidateAdmissionPredicate
): boolean {
  if (Boolean(existing.stale) !== Boolean(incoming.stale)) {
    return Boolean(existing.stale);
  }

  const existingAdmissible = admissible(existing);
  const incomingAdmissible = admissible(incoming);
  if (existingAdmissible !== incomingAdmissible) {
    return incomingAdmissible;
  }

  if (incoming.score !== existing.score) {
    return incoming.score > existing.score;
  }

  return getRestaurantInfoScore(incoming.restaurant) > getRestaurantInfoScore(existing.restaurant);
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
