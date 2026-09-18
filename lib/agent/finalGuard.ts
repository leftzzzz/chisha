import type {
  AgentObservation,
  AgentContext,
  FinalGuardResult,
  FinalGuardVerdict,
  FinalGuardViolation,
  FinishRecommendation,
  RestaurantCandidate,
} from './types';
import { isCandidateFreshForContext } from './goalVersion';
import { evaluateConstraint } from './constraintEvaluator';
import {
  isBroadSearchIntent,
  isSearchIntentAuthorizedForPrimary,
} from './authorization';
import { getRestaurantIdentityKeys } from '@/lib/restaurantIdentity';
import { TargetEvidenceSchema } from './schemas/verdict';

export function applyFinalGuard(
  context: AgentContext,
  proposed?: FinishRecommendation
): FinalGuardResult {
  const primaryResolution = resolveCandidateIds(
    context,
    proposed?.selectedIds === undefined && proposed?.candidateIds !== undefined
      ? []
      : proposed?.selectedIds,
    'selectedIds'
  );
  const dedupedPrimary = dedupeCandidatesPreservingOrder(
    primaryResolution.candidates,
    'selectedIds'
  );
  const primaryCandidates: RestaurantCandidate[] = [];
  const downgradedCandidates: RestaurantCandidate[] = [];
  const violations = [
    ...primaryResolution.violations,
    ...dedupedPrimary.violations,
  ];

  for (const candidate of dedupedPrimary.candidates) {
    const violation = getPrimaryRecommendationAdmissionViolation(candidate, context);
    if (!violation && primaryCandidates.length < context.targetCount) {
      primaryCandidates.push(candidate);
      continue;
    }

    if (!violation) {
      downgradedCandidates.push(candidate);
      violations.push({
        code: 'PRIMARY_LIMIT_EXCEEDED',
        candidateId: candidate.restaurant.id,
        field: 'selectedIds',
        disposition: 'backup',
        message: `候选「${candidate.restaurant.name}」超出本轮主推荐数量上限，已降为候补。`,
      });
      continue;
    }

    const disposition = isBackupRecommendationAllowed(candidate, context)
      ? 'backup'
      : 'removed';
    violations.push({
      ...violation,
      candidateId: candidate.restaurant.id,
      field: 'selectedIds',
      disposition,
    });
    if (disposition === 'backup') {
      downgradedCandidates.push(candidate);
    }
  }

  const backupResolution = proposed?.candidateIds === undefined
    ? {
        candidates: context.candidates.filter(
          (candidate) => !dedupedPrimary.candidates.includes(candidate)
        ),
        violations: [],
      }
    : resolveCandidateIds(context, proposed.candidateIds, 'candidateIds');
  const dedupedBackups = dedupeCandidatesPreservingOrder(
    [...downgradedCandidates, ...backupResolution.candidates],
    'candidateIds',
    primaryCandidates
  );
  violations.push(...backupResolution.violations, ...dedupedBackups.violations);
  const backupCandidates: RestaurantCandidate[] = [];
  for (const candidate of dedupedBackups.candidates) {
    const violation = backupAdmissionViolation(candidate, context);
    if (!violation && backupCandidates.length < 20) {
      backupCandidates.push(candidate);
      continue;
    }

    if (violation) {
      violations.push({
        ...violation,
        candidateId: candidate.restaurant.id,
        field: 'candidateIds',
        disposition: 'removed',
      });
    }
  }

  const proposedPrimaryCount = proposed?.selectedIds?.length
    ?? primaryResolution.candidates.length;
  const verdict: FinalGuardVerdict = proposedPrimaryCount > 0 && primaryCandidates.length === 0
    ? 'rejected'
    : violations.length > 0
      ? 'filtered'
      : 'accepted';

  return {
    verdict,
    primaryCandidates,
    backupCandidates,
    unmetConstraints: buildUnmetConstraints(
      context,
      primaryCandidates,
      backupCandidates,
      violations,
      proposed
    ),
    violations,
  };
}

/**
 * 主推荐准入所需的最小上下文。
 * AgentContext / PolicyContext 均结构性满足，便于策略层复用。
 */
export type CandidateAdmissionContext = Pick<
  AgentContext,
  'goal' | 'attempts' | 'location'
> & {
  observations?: AgentObservation[];
};

type PrimaryAdmissionViolation = Pick<FinalGuardViolation, 'code' | 'message'>;

export function isPrimaryRecommendationAllowed(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  return getPrimaryRecommendationAdmissionViolation(candidate, context) === undefined;
}

/**
 * 决策层判断“这一轮到底有没有主推荐”的兼容入口。
 * 目标 Agent 落地前 policy 仍复用它，但口径只能是 FinalGuard 的严格准入。
 */
export function isPrimaryRecommendationEligible(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  return isPrimaryRecommendationAllowed(candidate, context);
}

export function getPrimaryRecommendationAdmissionViolation(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): PrimaryAdmissionViolation | undefined {
  if (!isCandidateFreshForContext(candidate, context)) {
    return {
      code: 'STALE_CANDIDATE',
      message: `候选「${candidate.restaurant.name}」来自旧目标或旧位置，已移出主推荐。`,
    };
  }

  if (candidate.verification.hardFailures.length > 0) {
    return {
      code: 'HARD_CONSTRAINT_FAILED',
      message: `候选「${candidate.restaurant.name}」违反明确硬约束，已移出发布结果。`,
    };
  }

  const deterministicFailure = deterministicHardConstraintMessage(candidate, context, 'failed');
  if (deterministicFailure) {
    return {
      code: 'HARD_CONSTRAINT_FAILED',
      message: deterministicFailure,
    };
  }

  const sourceAttempt = context.attempts[candidate.sourceAttempt - 1];
  if (!sourceAttempt) {
    return {
      code: 'MISSING_SOURCE_ATTEMPT',
      message: `候选「${candidate.restaurant.name}」缺少可追溯搜索来源，已移出发布结果。`,
    };
  }

  if (candidate.verification.status === 'failed') {
    return {
      code: 'VERIFICATION_FAILED',
      message: `候选「${candidate.restaurant.name}」未通过候选验证，已移出发布结果。`,
    };
  }

  if (candidate.verification.status !== 'passed') {
    return {
      code: 'UNVERIFIED_EVIDENCE',
      message: `候选「${candidate.restaurant.name}」证据不足，只能作为不确定候补。`,
    };
  }

  const unverifiedHardConstraint = deterministicHardConstraintMessage(
    candidate,
    context,
    'unverified'
  );
  if (unverifiedHardConstraint) {
    return {
      code: 'UNVERIFIED_EVIDENCE',
      message: `${unverifiedHardConstraint} 只能作为不确定候补。`,
    };
  }

  if (sourceAttempt.allowedForPrimary === false) {
    return {
      code: 'UNAUTHORIZED_PRIMARY_SCOPE',
      message: `候选「${candidate.restaurant.name}」的搜索范围未获主推荐授权，只能作为候补。`,
    };
  }

  if (
    isBroadSearchIntent(sourceAttempt.searchIntent)
    && !isSearchIntentAuthorizedForPrimary(
      context.goal,
      sourceAttempt.searchIntent,
      sourceAttempt.keywords
    )
  ) {
    return {
      code: 'UNAUTHORIZED_PRIMARY_SCOPE',
      message: `候选「${candidate.restaurant.name}」来自未授权放宽，只能作为候补。`,
    };
  }

  if (!candidate.verification.primaryEligible) {
    return {
      code: 'PRIMARY_INELIGIBLE',
      message: `候选「${candidate.restaurant.name}」未获得主推荐资格，只能作为候补。`,
    };
  }

  // 旧会话的匹配标签不算引用；核验来源只能收紧准入，不能生成语义结论。
  const supportedTargets = new Set(
    (candidate.verification.targetEvidence ?? []).flatMap((evidence) => {
      const parsed = TargetEvidenceSchema.safeParse(evidence);
      if (!parsed.success) return [];
      const { target, kind, references, observationRef, verdict } = parsed.data;
      const observation = observationRef
        ? context.observations?.find((item) => item.plan.planId === observationRef)
        : undefined;
      const observationValid = Boolean(
        observation
        && observation.plan.planId === observationRef
        && observation.provider === candidate.restaurant.source
        && typeof observation.fetchedAt === 'number'
        && observationMatchesCurrentGoal(observation, candidate, context.goal)
      );
      const declaredMatch = kind === 'item'
        ? verdict === 'supported'
          && candidate.verification.itemMatches.some((match) => match.requestedItem === target)
        : verdict === 'supported'
          && candidate.verification.categoryMatches.includes(target)
          && !context.goal.requestedItems.some((item) => item.name === target);
      const referencesValid = references.every((reference) =>
        reference.restaurantId === candidate.restaurant.id
        && reference.value.trim().length > 0
        && candidate.restaurant[reference.field] === reference.value
        && observation?.facts?.some((fact) =>
          fact.id === reference.restaurantId
          && fact.source === candidate.restaurant.source
          && fact[reference.field] === reference.value
        )
      );
      return declaredMatch && referencesValid && observationValid ? [target] : [];
    })
  );
  const unsupportedGroup = context.goal.alternativeGroups.some((group) =>
    group.items.length === 0 || (group.mode === 'all_of'
      ? !group.items.every((item) => supportedTargets.has(item))
      : !group.items.some((item) => supportedTargets.has(item)))
  );
  if (unsupportedGroup) {
    return {
      code: 'REQUIRED_ITEM_UNSUPPORTED',
      message: `候选「${candidate.restaurant.name}」缺少必选目标组的完整证据，只能作为候补。`,
    };
  }

  if (
    context.goal.requestedItems.some((item) =>
      item.required
      && !context.goal.alternativeGroups.some((group) => group.items.includes(item.name))
      && !supportedTargets.has(item.name)
    )
    && !(
      isBroadSearchIntent(sourceAttempt.searchIntent)
      && isSearchIntentAuthorizedForPrimary(
        context.goal,
        sourceAttempt.searchIntent,
        sourceAttempt.keywords
      )
    )
  ) {
    return {
      code: 'REQUIRED_ITEM_UNSUPPORTED',
      message: `候选「${candidate.restaurant.name}」缺少必选菜品证据，只能作为候补。`,
    };
  }

  return undefined;
}

function observationMatchesCurrentGoal(
  observation: AgentObservation,
  candidate: RestaurantCandidate,
  goal: CandidateAdmissionContext['goal']
): boolean {
  // Runtime 会为当前目标补齐版本；未版本化只保留给不经过 Runtime 的旧调用兼容。
  if (!goal.goalSignature) {
    return true;
  }

  return Boolean(
    goal.goalId
    && goal.goalVersion !== undefined
    && observation.goalId === goal.goalId
    && observation.goalVersion === goal.goalVersion
    && observation.goalSignature === goal.goalSignature
    && candidate.goalId === observation.goalId
    && candidate.verifiedAgainstGoalVersion === observation.goalVersion
    && candidate.verifiedAgainstGoalSignature === observation.goalSignature
  );
}

function isBackupRecommendationAllowed(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): boolean {
  return backupAdmissionViolation(candidate, context) === undefined;
}

function backupAdmissionViolation(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext
): PrimaryAdmissionViolation | undefined {
  if (!isCandidateFreshForContext(candidate, context)) {
    return {
      code: 'STALE_CANDIDATE',
      message: `候选「${candidate.restaurant.name}」来自旧目标或旧位置，已移出发布结果。`,
    };
  }

  if (candidate.verification.hardFailures.length > 0) {
    return {
      code: 'HARD_CONSTRAINT_FAILED',
      message: `候选「${candidate.restaurant.name}」违反明确硬约束，已移出发布结果。`,
    };
  }

  const deterministicFailure = deterministicHardConstraintMessage(candidate, context, 'failed');
  if (deterministicFailure) {
    return {
      code: 'HARD_CONSTRAINT_FAILED',
      message: deterministicFailure,
    };
  }

  if (!context.attempts[candidate.sourceAttempt - 1]) {
    return {
      code: 'MISSING_SOURCE_ATTEMPT',
      message: `候选「${candidate.restaurant.name}」缺少可追溯搜索来源，已移出发布结果。`,
    };
  }

  if (candidate.verification.status === 'failed') {
    return {
      code: 'VERIFICATION_FAILED',
      message: `候选「${candidate.restaurant.name}」未通过候选验证，已移出发布结果。`,
    };
  }

  return undefined;
}

function resolveCandidateIds(
  context: AgentContext,
  ids: string[] | undefined,
  field: FinalGuardViolation['field']
): { candidates: RestaurantCandidate[]; violations: FinalGuardViolation[] } {
  if (ids === undefined) {
    return { candidates: [...context.candidates], violations: [] };
  }

  const byId = new Map(context.candidates.map((candidate) => [candidate.restaurant.id, candidate]));
  const candidates: RestaurantCandidate[] = [];
  const violations: FinalGuardViolation[] = [];

  for (const id of ids) {
    const candidate = byId.get(id);
    if (candidate) {
      candidates.push(candidate);
      continue;
    }

    violations.push({
      code: 'UNOBSERVED_CANDIDATE_ID',
      candidateId: id,
      field,
      disposition: 'removed',
      message: `候选 id「${id}」未出现在本轮 observation 中，已拒绝发布。`,
    });
  }

  return { candidates, violations };
}

function dedupeCandidatesPreservingOrder(
  candidates: RestaurantCandidate[],
  field: FinalGuardViolation['field'],
  alreadyAccepted: RestaurantCandidate[] = []
): { candidates: RestaurantCandidate[]; violations: FinalGuardViolation[] } {
  const deduped: RestaurantCandidate[] = [];
  const seenKeys = new Set(
    alreadyAccepted.flatMap((candidate) => getRestaurantIdentityKeys(candidate.restaurant))
  );
  const violations: FinalGuardViolation[] = [];

  for (const candidate of candidates) {
    const keys = getRestaurantIdentityKeys(candidate.restaurant);
    if (!keys.some((key) => seenKeys.has(key))) {
      deduped.push(candidate);
      keys.forEach((key) => seenKeys.add(key));
      continue;
    }

    violations.push({
      code: 'DUPLICATE_CANDIDATE',
      candidateId: candidate.restaurant.id,
      field,
      disposition: 'removed',
      message: `候选「${candidate.restaurant.name}」与已保留地点重复，已保序去重。`,
    });
  }

  return { candidates: deduped, violations };
}

function buildUnmetConstraints(
  context: AgentContext,
  primaryCandidates: RestaurantCandidate[],
  backupCandidates: RestaurantCandidate[],
  violations: FinalGuardViolation[],
  proposed?: FinishRecommendation
): string[] {
  const unmet = [
    ...context.unmetConstraints,
    ...context.goal.ambiguity,
    ...(proposed?.unmetConstraints ?? []),
    ...violations
      .filter((violation) => violation.field === 'selectedIds')
      .map((violation) => violation.message),
  ];

  if (primaryCandidates.length < context.targetCount) {
    unmet.push(`只找到 ${primaryCandidates.length} 家通过最终准入的餐厅。`);
  }

  const hasUnverifiedBackups = backupCandidates.some((candidate) =>
    candidate.verification.status === 'unverified'
  );
  if (hasUnverifiedBackups) {
    unmet.push('部分候补缺少可验证字段，未进入主推荐。');
  }

  const hasUnauthorizedBroadened = context.attempts.some((attempt) =>
    isBroadSearchIntent(attempt.searchIntent)
    && (
      attempt.allowedForPrimary === false
      || !isSearchIntentAuthorizedForPrimary(context.goal, attempt.searchIntent, attempt.keywords)
    )
  );
  if (hasUnauthorizedBroadened) {
    unmet.push('未获得对应授权 scope 的放宽或兜底结果只作为候补，不进入主推荐。');
  }

  const hasStaleCandidates = context.candidates.some((candidate) => candidate.stale);
  if (hasStaleCandidates) {
    unmet.push('部分候选来自旧目标或旧位置，需重新验证后才能进入主推荐。');
  }

  for (const constraint of context.goal.hardConstraints) {
    if (constraint.kind === 'budget') {
      unmet.push('预算信息依赖餐厅人均字段；当前数据源缺失时不会编造价格。');
    }

    if (constraint.kind === 'open_now') {
      unmet.push('营业状态只过滤数据源明确标记为停业的餐厅，未知状态会保留并提示。');
    }
  }

  return Array.from(new Set(unmet.filter(Boolean)));
}

function deterministicHardConstraintMessage(
  candidate: RestaurantCandidate,
  context: CandidateAdmissionContext,
  status: 'failed' | 'unverified'
): string | undefined {
  for (const constraint of context.goal.hardConstraints) {
    if (!isDeterministicHardConstraint(constraint.kind)) {
      continue;
    }

    const evaluation = evaluateConstraint(candidate.restaurant, constraint);
    if (evaluation.status === status) {
      return evaluation.message;
    }
  }

  return undefined;
}

function isDeterministicHardConstraint(
  kind: UserGoalConstraintKind
): boolean {
  return kind === 'distance' || kind === 'budget' || kind === 'open_now';
}

type UserGoalConstraintKind = AgentContext['goal']['hardConstraints'][number]['kind'];
