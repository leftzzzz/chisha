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

  const parsedGoal = await parseGoal(input);
  const goal = mergeRuntimeGoal(input.runtimeState?.goal, parsedGoal);
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
  const noPrimaryQuestion = getNoPrimaryRecommendationQuestion(context, finalResult);
  if (noPrimaryQuestion) {
    return {
      ...finalResult,
      paused: true,
      question: noPrimaryQuestion,
      runtimeState: snapshotRuntimeState(context),
    };
  }

  emit({ type: 'final', ...finalResult });
  emit({ type: 'done', ...finalResult });

  return withRuntimeState(finalResult, context);
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
    optionEffects: Object.fromEntries(
      (need.options ?? [])
        .filter((option) => option.effect)
        .map((option) => [option.label, option.effect!])
    ),
  };
}

function getNoPrimaryRecommendationQuestion(
  context: AgentContext,
  result: AgentFinalResult
): PendingQuestion | null {
  if (result.restaurants.length > 0) {
    return null;
  }

  const target = describeGoalTarget(context.goal);
  const hasStrictDistance = context.goal.hardConstraints.some((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );
  const hasCandidates = result.candidates.length > 0;

  if (hasStrictDistance) {
    return {
      reason: '当前距离范围内没有找到通过验证的主推荐。',
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      options: ['扩大范围', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
      },
    };
  }

  if (hasCandidates) {
    return {
      reason: `已找到 ${result.candidates.length} 个候补，但没有通过主推荐验证。`,
      question: target
        ? `没有找到完全符合「${target}」的餐厅，要先看看候补吗？`
        : '没有找到完全符合条件的餐厅，要先看看候补吗？',
      options: ['查看候补', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '查看候补': { allowBroaden: true },
      },
    };
  }

  return {
    reason: '本轮搜索没有找到通过验证的餐厅。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要扩大范围或换个类型再搜吗？`
      : '没有找到符合条件的餐厅，要扩大范围或换个类型再搜吗？',
    options: ['扩大范围', '换个类型'],
    allowFreeText: true,
    optionEffects: {
      '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
    },
  };
}

function describeGoalTarget(goal: UserGoal): string {
  const requestedItems = goal.requestedItems.map((item) => item.name);
  if (requestedItems.length > 0) {
    return requestedItems.slice(0, 3).join('、');
  }

  return goal.primaryKeywords.slice(0, 3).join('、');
}

function hasTriedPlan(context: AgentContext, plan: SearchPlan): boolean {
  const tried = new Set(context.attempts.map(searchAttemptKey));
  return tried.has(searchPlanKey(plan));
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

function withRuntimeState(result: AgentFinalResult, context: AgentContext): AgentFinalResult {
  return {
    ...result,
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

function mergeRuntimeGoal(previousGoal: UserGoal | undefined, nextGoal: UserGoal): UserGoal {
  if (!previousGoal) {
    return nextGoal;
  }

  const previousHasSearchTarget = previousGoal.primaryKeywords.length > 0
    || previousGoal.requestedItems.length > 0
    || previousGoal.acceptableCategories.length > 0;

  return {
    ...nextGoal,
    requestedItems: mergeByName(previousGoal.requestedItems, nextGoal.requestedItems),
    acceptableCategories: mergeByName(previousGoal.acceptableCategories, nextGoal.acceptableCategories),
    alternativeGroups: mergeAlternativeGroups(previousGoal.alternativeGroups, nextGoal.alternativeGroups),
    primaryKeywords: mergeStrings(previousGoal.primaryKeywords, nextGoal.primaryKeywords),
    relatedKeywords: mergeStrings(previousGoal.relatedKeywords, nextGoal.relatedKeywords),
    broadenedKeywords: mergeStrings(previousGoal.broadenedKeywords, nextGoal.broadenedKeywords),
    hardConstraints: mergeConstraints(previousGoal.hardConstraints, nextGoal.hardConstraints),
    softPreferences: mergeByName(previousGoal.softPreferences, nextGoal.softPreferences),
    exclusions: mergeStrings(previousGoal.exclusions, nextGoal.exclusions),
    ambiguity: mergeStrings(previousGoal.ambiguity, nextGoal.ambiguity),
    clarificationNeeded: previousHasSearchTarget
      ? []
      : nextGoal.clarificationNeeded,
    allowBroaden: previousGoal.allowBroaden || nextGoal.allowBroaden,
  };
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}

function mergeByName<T extends { name: string }>(left: T[], right: T[]): T[] {
  const byName = new Map<string, T>();

  for (const item of [...left, ...right]) {
    byName.set(item.name, item);
  }

  return Array.from(byName.values());
}

function mergeAlternativeGroups(
  left: UserGoal['alternativeGroups'],
  right: UserGoal['alternativeGroups']
): UserGoal['alternativeGroups'] {
  const seen = new Set<string>();
  const groups: UserGoal['alternativeGroups'] = [];

  for (const group of [...left, ...right]) {
    const key = `${group.mode}:${group.items.join('|')}:${group.minPerGroup ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      groups.push(group);
    }
  }

  return groups;
}

function mergeConstraints(
  left: UserGoal['hardConstraints'],
  right: UserGoal['hardConstraints']
): UserGoal['hardConstraints'] {
  const rightHasDistance = right.some((constraint) => constraint.kind === 'distance');
  const seen = new Set<string>();
  const constraints: UserGoal['hardConstraints'] = [];

  for (const constraint of [...left, ...right]) {
    if (rightHasDistance && constraint.kind === 'distance' && left.includes(constraint)) {
      continue;
    }

    const key = `${constraint.kind}:${constraint.label}:${JSON.stringify(constraint.value ?? constraint.values ?? '')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    constraints.push(constraint);
  }

  return constraints;
}
