import type { Restaurant } from '@/types';
import { evaluateSearchResult, isGoodEnough, mergeCandidates } from './evaluator';
import { finalizeRecommendations } from './resultAssembler';
import { initialPlan, nextPlan, parseUserGoal } from './planner';
import type {
  AgentContext,
  AgentFinalResult,
  AgentInput,
  EmitAgentEvent,
  SearchPlan,
} from './types';

export async function runSearchAgent(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  emit({ type: 'thinking', message: '正在理解你的需求...' });
  emit({ type: 'status', message: '正在解析目标和可验证约束...' });

  const context = createInitialContext(input);
  let plan: SearchPlan | null = initialPlan(context.goal);
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

    const plannedNext = nextPlan(context, observation);
    if (!plannedNext) {
      break;
    }

    emit({
      type: 'strategy_change',
      reason: observation.reason,
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

function createInitialContext(input: AgentInput): AgentContext {
  return {
    ...input,
    goal: parseUserGoal(input.query, input.preferenceSummary),
    attempts: [],
    candidates: [],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: 5,
    targetCount: 8,
  };
}
