import type { Restaurant } from '@/types';
import { decideNextAgentAction } from './decision';
import { evaluateSearchResult, isGoodEnough, mergeCandidates } from './evaluator';
import { finalizeRecommendations } from './resultAssembler';
import { parseAgentGoal, type AgentGoalParser } from './goalParser';
import { initialPlan, normalizeSearchPlan, searchAttemptKey, searchPlanKey } from './planner';
import type {
  AgentContext,
  AgentDecisionMaker,
  AgentFinalResult,
  AgentInput,
  ClarificationNeed,
  EmitAgentEvent,
  PendingQuestion,
  SearchPlan,
  UserGoal,
} from './types';

export async function runSearchAgent(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  parseGoal: AgentGoalParser = parseAgentGoal,
  decideNext: AgentDecisionMaker = decideNextAgentAction
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: '正在解析目标和可验证约束...' });

  const goal = await parseGoal(input);
  const context = createInitialContext(input, goal);
  const initialQuestion = getInitialClarifyingQuestion(context.goal);
  if (initialQuestion) {
    return buildPausedResult(context, initialQuestion);
  }

  let plan: SearchPlan | null = normalizeSearchPlan(initialPlan(context.goal), context.goal);
  let step = 0;

  while (plan && step < context.maxSteps && context.attempts.length < context.maxSearchCalls) {
    step++;
    const round = context.attempts.length + 1;

    emit({ type: 'searching', keywords: plan.keywords, round });
    emit({ type: 'tool_start', tool: 'search_restaurants', args: plan });

    const restaurants = await searchPlaces(plan);
    const observation = evaluateSearchResult(restaurants, context, plan, round);
    mergeCandidates(context, observation.acceptedCandidates);

    context.attempts.push({
      keywords: plan.keywords,
      radius: plan.radiusMeters,
      poiType: plan.poiType,
      searchIntent: plan.searchIntent,
      allowedForPrimary: plan.allowedForPrimary,
      reason: plan.reason,
      found: observation.found,
      accepted: observation.acceptedCandidates.length,
    });

    emit({
      type: 'search_result',
      found: observation.found,
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
        found: observation.found,
        accepted: observation.acceptedCandidates.length,
        total: context.candidates.length,
        rejected: observation.rejected,
      },
    });
    emit({
      type: 'partial_results',
      restaurants: context.candidates
        .slice(0, context.targetCount)
        .map((candidate) => candidate.restaurant),
    });

    if (isGoodEnough(context)) {
      break;
    }

    const decision = await decideNext(context, observation);

    if (decision.type === 'ask_user') {
      return buildPausedResult(context, decision.question);
    }

    if (decision.type === 'finish') {
      break;
    }

    const plannedNext = normalizeSearchPlan(decision.plan, context.goal);
    if (!plannedNext || hasTriedPlan(context, plannedNext)) {
      break;
    }

    emit({
      type: 'strategy_change',
      reason: plannedNext.reason,
      next: plannedNext,
    });
    plan = plannedNext;
  }

  emit({
    type: 'filtering',
    message: '正在校验候选并组装推荐...',
    total: context.candidates.length,
  });

  const finalResult = finalizeRecommendations(context);
  emit({ type: 'final', ...finalResult });
  emit({ type: 'done', ...finalResult });

  return finalResult;
}

function buildPausedResult(context: AgentContext, question: PendingQuestion): AgentFinalResult {
  const partialResult = finalizeRecommendations(context);

  return {
    ...partialResult,
    paused: true,
    question,
  };
}

function getInitialClarifyingQuestion(goal: UserGoal): PendingQuestion | null {
  const clarificationNeed = goal.clarificationNeeded[0];
  if (!clarificationNeed) {
    return null;
  }

  return clarificationNeedToPendingQuestion(clarificationNeed);
}

function clarificationNeedToPendingQuestion(need: ClarificationNeed): PendingQuestion {
  return {
    reason: need.reason,
    question: need.question,
    options: need.options?.map((option) => option.label),
    allowFreeText: need.allowFreeText,
  };
}

function hasTriedPlan(context: AgentContext, plan: SearchPlan): boolean {
  const tried = new Set(context.attempts.map(searchAttemptKey));
  return tried.has(searchPlanKey(plan));
}

function createInitialContext(input: AgentInput, goal: UserGoal): AgentContext {
  return {
    ...input,
    goal,
    attempts: [],
    candidates: [],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: 5,
    targetCount: 8,
  };
}
