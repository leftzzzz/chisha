import type { Location } from '@/types';
import type { AgentContext, RestaurantCandidate, UserGoal } from './types';

export interface ContextInvalidationPlan {
  staleCandidates: boolean;
  reasons: string[];
  goalChanged: boolean;
  locationChanged: boolean;
  primaryTargetChanged: boolean;
  hardConstraintsChanged: boolean;
  exclusionsChanged: boolean;
}

export function withUpdatedGoalVersion(goal: UserGoal, previousGoal?: UserGoal): UserGoal {
  const goalSignature = deriveGoalSignature(goal);
  const previousVersion = previousGoal?.goalVersion ?? 1;
  const previousGoalId = previousGoal?.goalId;
  const previousSignature = previousGoal
    ? previousGoal.goalSignature ?? deriveGoalSignature(previousGoal)
    : undefined;
  const isSameGoalSignature = previousSignature === goalSignature;

  return {
    ...goal,
    goalId: previousGoalId ?? goal.goalId ?? createGoalId(),
    goalVersion: isSameGoalSignature ? previousVersion : previousGoal ? previousVersion + 1 : 1,
    goalSignature,
  };
}

export function deriveContextInvalidationPlan(
  previousGoal: UserGoal | undefined,
  nextGoal: UserGoal,
  previousLocation: Location | undefined,
  nextLocation: Location
): ContextInvalidationPlan {
  const reasons: string[] = [];
  const goalChanged = previousGoal
    ? deriveGoalSignature(previousGoal) !== deriveGoalSignature(nextGoal)
    : false;
  const locationChanged = previousLocation
    ? deriveLocationSignature(previousLocation) !== deriveLocationSignature(nextLocation)
    : false;
  const primaryTargetChanged = previousGoal
    ? primaryTargetFieldSignature(previousGoal) !== primaryTargetFieldSignature(nextGoal)
    : false;
  const hardConstraintsChanged = previousGoal
    ? stableStringify(previousGoal.hardConstraints) !== stableStringify(nextGoal.hardConstraints)
    : false;
  const exclusionsChanged = previousGoal
    ? stableStringify(sortedStrings(previousGoal.exclusions)) !== stableStringify(sortedStrings(nextGoal.exclusions))
    : false;

  if (primaryTargetChanged) reasons.push('primary_target_changed');
  if (hardConstraintsChanged) reasons.push('hard_constraints_changed');
  if (exclusionsChanged) reasons.push('exclusions_changed');
  if (locationChanged) reasons.push('location_changed');
  if (goalChanged && reasons.length === 0) reasons.push('goal_signature_changed');

  return {
    staleCandidates: reasons.length > 0,
    reasons,
    goalChanged,
    locationChanged,
    primaryTargetChanged,
    hardConstraintsChanged,
    exclusionsChanged,
  };
}

export function deriveGoalSignature(goal: UserGoal): string {
  return `goal_${hashString(stableStringify({
    primaryKeywords: sortedStrings(goal.primaryKeywords),
    requestedItems: goal.requestedItems
      .map((item) => ({
        name: item.name.trim(),
        required: item.required,
        aliases: sortedStrings(item.aliases),
      }))
      .sort(compareByStableStringify),
    acceptableCategories: goal.acceptableCategories
      .map((category) => ({
        name: category.name.trim(),
        confidence: Number(category.confidence.toFixed(3)),
      }))
      .sort(compareByStableStringify),
    hardConstraints: goal.hardConstraints
      .map((constraint) => ({
        kind: constraint.kind,
        label: constraint.label,
        value: constraint.value,
        strict: constraint.strict,
        maxMeters: constraint.maxMeters,
        values: sortedStrings(constraint.values ?? []),
        min: constraint.min,
        max: constraint.max,
      }))
      .sort(compareByStableStringify),
    exclusions: sortedStrings(goal.exclusions),
  })).toString(36)}`;
}

export function deriveLocationSignature(location: Location): string {
  return stableStringify({
    lat: Number(location.lat.toFixed(5)),
    lng: Number(location.lng.toFixed(5)),
    address: location.address?.trim() || undefined,
  });
}

export function markStaleCandidatesForContext(
  candidates: RestaurantCandidate[],
  goal: UserGoal,
  location: Location
): RestaurantCandidate[] {
  return candidates.map((candidate) => markStaleCandidateForContext(candidate, goal, location));
}

export function isCandidateFreshForContext(
  candidate: RestaurantCandidate,
  context: Pick<AgentContext, 'goal' | 'location'>
): boolean {
  return !markStaleCandidateForContext(candidate, context.goal, context.location).stale;
}

function markStaleCandidateForContext(
  candidate: RestaurantCandidate,
  goal: UserGoal,
  location: Location
): RestaurantCandidate {
  if (candidate.stale) {
    return candidate;
  }

  const staleReason = getCandidateStaleReason(candidate, goal, location);
  if (!staleReason) {
    return candidate;
  }

  return {
    ...candidate,
    stale: true,
    staleReason,
    verification: {
      ...candidate.verification,
      primaryEligible: false,
      warnings: Array.from(new Set([
        ...candidate.verification.warnings,
        staleReason,
      ])),
    },
    warnings: Array.from(new Set([...candidate.warnings, staleReason])),
  };
}

function getCandidateStaleReason(
  candidate: RestaurantCandidate,
  goal: UserGoal,
  location: Location
): string | null {
  if (!goal.goalSignature) {
    return null;
  }

  if (
    candidate.verifiedAgainstGoalVersion === undefined
    || !candidate.verifiedAgainstGoalSignature
    || !candidate.locationSignature
  ) {
    return '候选缺少当前目标版本验证信息，需重新验证后才能进入主推荐。';
  }

  if (candidate.goalId && goal.goalId && candidate.goalId !== goal.goalId) {
    return '候选来自不同目标，需重新搜索或验证。';
  }

  if (candidate.verifiedAgainstGoalVersion !== goal.goalVersion) {
    return '候选验证版本与当前目标不一致，需重新验证。';
  }

  if (candidate.verifiedAgainstGoalSignature !== goal.goalSignature) {
    return '候选验证签名与当前目标不一致，需重新验证。';
  }

  const locationSignature = deriveLocationSignature(location);
  if (candidate.locationSignature !== locationSignature) {
    return '候选位置签名与当前位置不一致，需重新搜索。';
  }

  return null;
}

function sortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function compareByStableStringify(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}

/**
 * 目标词的**分字段**签名，用于判断候选是否需要作废。
 *
 * 与 `goal.ts` 的 `primaryTargetSetSignature`（合并集合）刻意不同：
 * 这里同一个词从 requestedItems 挪到 primaryKeywords 算"变了"，
 * 因为候选的验证证据是按字段语义产生的，挪动字段后旧证据不再可信。
 * 那边只关心"用户想吃的东西整体变没变"，用于会话模式判断。
 */
function primaryTargetFieldSignature(goal: UserGoal): string {
  return stableStringify({
    primaryKeywords: sortedStrings(goal.primaryKeywords),
    requestedItems: sortedStrings(goal.requestedItems.map((item) => item.name)),
    acceptableCategories: sortedStrings(goal.acceptableCategories.map((category) => category.name)),
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createGoalId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `goal_${globalThis.crypto.randomUUID()}`;
  }

  return `goal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
