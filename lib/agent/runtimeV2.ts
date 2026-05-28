import type { Restaurant } from '@/types';
import {
  applyGoalPatch,
  buildMinimalFallbackGoal,
  clarificationNeedToPendingQuestion,
  runSearchSupervisor,
} from './supervisor';
import { runPlanningAgent } from './subagents/planningAgent';
import { runEvaluationAgent } from './subagents/evaluationAgent';
import { applyHardConstraintGuard, applyVerdictGuard } from './guards';
import { resolvePlansWithPoiTaxonomy } from './poiTaxonomy';
import { SearchPlanSchema } from './schemas/plan';
import { finalizeRecommendations } from './resultAssembler';
import type {
  AgentContext,
  AgentFinalResult,
  AgentInput,
  CandidateVerdict,
  CandidateVerification,
  EmitAgentEvent,
  ItemMatch,
  PendingQuestion,
  RestaurantCandidate,
  SearchPlan,
  UserGoal,
  VerificationFailure,
} from './types';

export async function runSearchAgentV2(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: 'SearchSupervisorAgent 正在解析目标...' });

  const supervisorOutput = await runSearchSupervisor({
    message: input.query,
    previousGoal: input.runtimeState?.goal,
    preferenceSummary: input.preferenceSummary,
  });
  const goal = resolveSupervisorGoal(input, supervisorOutput);
  const context = createInitialContext(input, goal);
  const initialQuestion = supervisorOutput.question
    ?? getInitialClarifyingQuestion(goal);

  if (initialQuestion) {
    return buildPausedResult(context, initialQuestion);
  }

  while (context.attempts.length < context.maxSearchCalls) {
    const planning = await runPlanningAgent({
      goal: context.goal,
      attempts: context.attempts,
      targetCount: context.targetCount,
    });
    const plans = resolvePlansWithPoiTaxonomy(planning, context.goal)
      .map((plan) => normalizeRuntimeSearchPlan(plan, context.goal))
      .filter((plan): plan is SearchPlan => Boolean(plan))
      .filter((plan) => !hasTriedPlan(context, plan));

    if (plans.length === 0) {
      break;
    }

    for (const plan of plans) {
      if (context.attempts.length >= context.maxSearchCalls) {
        break;
      }

      const round = context.attempts.length + 1;
      emit({ type: 'searching', keywords: plan.keywords, round });
      emit({ type: 'tool_start', tool: 'search_restaurants', args: plan });

      const restaurants = await searchPlaces(plan);
      const hardGuard = applyHardConstraintGuard(restaurants, context.goal);
      context.unmetConstraints.push(
        ...hardGuard.rejected.flatMap((item) => item.reasons)
      );
      const evaluation = await runEvaluationAgent({
        goal: context.goal,
        plan,
        restaurants: hardGuard.passed,
        targetCount: context.targetCount,
        preferenceSummary: context.preferenceSummary,
      });
      const guardedEvaluation = applyVerdictGuard(
        evaluation,
        hardGuard.passed,
        context.goal,
        plan,
        context.targetCount
      ).output;
      const acceptedCandidates = guardedEvaluation.verdicts
        .filter((verdict) => verdict.status !== 'failed')
        .map((verdict) => verdictToCandidate(verdict, hardGuard.passed, round))
        .filter((candidate): candidate is RestaurantCandidate => Boolean(candidate));

      mergeCandidates(context, acceptedCandidates);
      context.unmetConstraints.push(...guardedEvaluation.unmetConstraints);
      context.attempts.push({
        keywords: plan.keywords,
        radius: plan.radiusMeters,
        poiType: plan.poiType,
        searchIntent: plan.searchIntent,
        allowedForPrimary: plan.allowedForPrimary,
        reason: plan.reason,
        found: restaurants.length,
        accepted: acceptedCandidates.length,
      });

      emit({
        type: 'search_result',
        found: restaurants.length,
        total: context.candidates.length,
        restaurants: context.candidates.map((candidate) => ({
          id: candidate.restaurant.id,
          name: candidate.restaurant.name,
          cuisineType: candidate.restaurant.cuisineType,
          distance: candidate.restaurant.distance,
        })),
      });
      emit({
        type: 'tool_result',
        tool: 'search_restaurants',
        summary: {
          found: restaurants.length,
          hardRejected: hardGuard.rejected.length,
          accepted: acceptedCandidates.length,
          total: context.candidates.length,
        },
      });
      emit({
        type: 'partial_results',
        restaurants: context.candidates
          .slice(0, context.targetCount)
          .map((candidate) => candidate.restaurant),
      });

      if (hasEnoughPassedCandidates(context)) {
        break;
      }
    }

    if (hasEnoughPassedCandidates(context)) {
      break;
    }
  }

  emit({
    type: 'filtering',
    message: '正在进行 Runtime guard 终检并组装推荐...',
    total: context.candidates.length,
  });

  const finalResult = finalizeRecommendations(context);
  if (finalResult.restaurants.length === 0) {
    const question = await getFailureQuestion(context);
    return {
      ...finalResult,
      paused: true,
      question,
      runtimeState: snapshotRuntimeState(context),
    };
  }

  emit({ type: 'final', ...finalResult });
  emit({ type: 'done', ...finalResult });

  return {
    ...finalResult,
    runtimeState: snapshotRuntimeState(context),
  };
}

function resolveSupervisorGoal(
  input: AgentInput,
  output: Awaited<ReturnType<typeof runSearchSupervisor>>
): UserGoal {
  if (output.goal) {
    return output.goal;
  }

  if (output.patch && input.runtimeState?.goal) {
    return applyGoalPatch(input.runtimeState.goal, output.patch, input.query);
  }

  return buildMinimalFallbackGoal(input.query, input.preferenceSummary);
}

function createInitialContext(input: AgentInput, goal: UserGoal): AgentContext {
  const previousAttempts = input.runtimeState?.attempts ?? [];

  return {
    ...input,
    goal,
    attempts: [...previousAttempts],
    candidates: [...(input.runtimeState?.candidates ?? [])],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: previousAttempts.length + 5,
    targetCount: 8,
  };
}

function getInitialClarifyingQuestion(goal: UserGoal): PendingQuestion | null {
  const clarificationNeed = goal.clarificationNeeded[0];
  return clarificationNeed ? clarificationNeedToPendingQuestion(clarificationNeed) : null;
}

async function getFailureQuestion(context: AgentContext): Promise<PendingQuestion> {
  const supervisorOutput = await runSearchSupervisor({
    message: context.query,
    previousGoal: context.goal,
    preferenceSummary: context.preferenceSummary,
    failureReason: '没有找到通过 Runtime guard 和 EvaluationAgent 验证的主推荐。',
    attempts: context.attempts,
    verdictSummary: context.candidates.map((candidate) => verdictFromCandidate(candidate)),
  });

  if (supervisorOutput.question) {
    return supervisorOutput.question;
  }

  const target = context.goal.requestedItems.map((item) => item.name)
    .concat(context.goal.primaryKeywords)
    .filter(Boolean)
    .slice(0, 2)
    .join('、');

  return {
    reason: '没有找到通过验证的主推荐。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
      : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    options: ['允许放宽', '换个类型'],
    allowFreeText: true,
    optionEffects: {
      '允许放宽': { allowBroaden: true },
    },
  };
}

function normalizeRuntimeSearchPlan(plan: SearchPlan, goal: UserGoal): SearchPlan | null {
  const keywords = Array.from(new Set(plan.keywords.map((keyword) => keyword.trim()).filter(Boolean)))
    .filter((keyword) => !goal.exclusions.some((exclusion) => keyword.includes(exclusion)))
    .slice(0, 5);

  if (keywords.length === 0) {
    return null;
  }

  const strictDistance = goal.hardConstraints.find((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );
  const strictMax = strictDistance?.maxMeters
    ?? (typeof strictDistance?.value === 'number' ? strictDistance.value : undefined);
  const requestedRadius = Number.isFinite(plan.radiusMeters) ? plan.radiusMeters : 1800;
  const radiusMeters = strictMax !== undefined
    ? Math.min(requestedRadius, strictMax)
    : requestedRadius;
  const broadIntent = plan.searchIntent === 'broadened' || plan.searchIntent === 'fallback';
  const parsed = SearchPlanSchema.safeParse({
    ...plan,
    keywords,
    radiusMeters: Math.max(300, Math.min(5000, Math.round(radiusMeters))),
    allowedForPrimary: plan.allowedForPrimary && (!broadIntent || goal.allowBroaden),
  });

  return parsed.success ? parsed.data : null;
}

function hasTriedPlan(context: AgentContext, plan: SearchPlan): boolean {
  const key = searchPlanKey(plan);
  return context.attempts.some((attempt) =>
    `${attempt.searchIntent}:${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}` === key
  );
}

function searchPlanKey(plan: SearchPlan): string {
  return `${plan.searchIntent}:${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
}

function hasEnoughPassedCandidates(context: AgentContext): boolean {
  return context.candidates.filter((candidate) => isPrimaryEligible(candidate, context)).length >= context.targetCount;
}

function isPrimaryEligible(candidate: RestaurantCandidate, context: AgentContext): boolean {
  const attempt = context.attempts[candidate.sourceAttempt - 1];
  return candidate.verification.status === 'passed' && attempt?.allowedForPrimary !== false;
}

function verdictToCandidate(
  verdict: CandidateVerdict,
  restaurants: Restaurant[],
  sourceAttempt: number
): RestaurantCandidate | null {
  const restaurant = restaurants.find((item) => item.id === verdict.restaurantId);
  if (!restaurant) {
    return null;
  }

  return {
    restaurant,
    score: Math.round(verdict.confidence * 100) + distanceScore(restaurant.distance),
    matched: verdict.evidence.length > 0
      ? verdict.evidence
      : [...verdict.matchedItems, ...verdict.matchedCategories].map((item) => `验证${item}`),
    warnings: [...verdict.warnings, ...verdict.conflicts],
    verification: verificationFromVerdict(verdict),
    sourceAttempt,
  };
}

function verificationFromVerdict(verdict: CandidateVerdict): CandidateVerification {
  return {
    restaurantId: verdict.restaurantId,
    status: verdict.status,
    hardFailures: verdict.conflicts.map((message): VerificationFailure => ({
      kind: 'category',
      message,
    })),
    itemMatches: verdict.matchedItems.map((item): ItemMatch => ({
      requestedItem: item,
      matchedBy: 'llm_semantic',
      confidence: verdict.confidence,
    })),
    categoryMatches: verdict.matchedCategories,
    warnings: verdict.warnings,
    confidence: verdict.confidence,
  };
}

function verdictFromCandidate(candidate: RestaurantCandidate): CandidateVerdict {
  return {
    restaurantId: candidate.restaurant.id,
    status: candidate.verification.status,
    primaryEligible: candidate.verification.status === 'passed',
    confidence: candidate.verification.confidence,
    matchedItems: candidate.verification.itemMatches.map((match) => match.requestedItem),
    matchedCategories: candidate.verification.categoryMatches,
    conflicts: candidate.verification.hardFailures.map((failure) => failure.message),
    evidence: candidate.matched,
    warnings: candidate.warnings,
  };
}

function mergeCandidates(
  context: AgentContext,
  incomingCandidates: RestaurantCandidate[]
): void {
  const byId = new Map<string, RestaurantCandidate>();

  for (const candidate of context.candidates) {
    byId.set(candidate.restaurant.id, candidate);
  }

  for (const incoming of incomingCandidates) {
    const existing = byId.get(incoming.restaurant.id);
    if (!existing || incoming.score > existing.score) {
      byId.set(incoming.restaurant.id, incoming);
      continue;
    }

    existing.matched = mergeStrings(existing.matched, incoming.matched);
    existing.warnings = mergeStrings(existing.warnings, incoming.warnings);
  }

  context.candidates = Array.from(byId.values()).sort(compareCandidates);
}

function compareCandidates(left: RestaurantCandidate, right: RestaurantCandidate): number {
  const statusDelta = verificationRank(right) - verificationRank(left);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  if (right.score !== left.score) {
    return right.score - left.score;
  }

  return (left.restaurant.distance ?? Infinity) - (right.restaurant.distance ?? Infinity);
}

function verificationRank(candidate: RestaurantCandidate): number {
  if (candidate.verification.status === 'passed') return 3;
  if (candidate.verification.status === 'unverified') return 2;
  return 1;
}

function distanceScore(distance?: number): number {
  if (distance === undefined) {
    return 4;
  }

  if (distance <= 500) return 16;
  if (distance <= 1000) return 13;
  if (distance <= 2000) return 9;
  if (distance <= 3000) return 5;
  return 1;
}

function buildPausedResult(context: AgentContext, question: PendingQuestion): AgentFinalResult {
  const partialResult = finalizeRecommendations(context);

  return {
    ...partialResult,
    paused: true,
    question,
    runtimeState: snapshotRuntimeState(context),
  };
}

function snapshotRuntimeState(context: AgentContext) {
  return {
    goal: context.goal,
    attempts: [...context.attempts],
    candidates: [...context.candidates],
  };
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
