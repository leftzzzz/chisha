/**
 * 候选排序不再受模型的全局选择影响。
 *
 * 背景：EvaluationAgent 曾被要求输出 selectedIds，而它是**分批**调用的
 * （每批 6 家），也就是让一个只有局部视野的子 Agent 做全局选择，结果再被
 * 机械合并。这些 id 还真的生效——命中就 +30 分。阶段 4 把选择权收回确定性规则。
 */

import { evaluateSearchResult } from '@/lib/agent/evaluator';
import type {
  AgentContext,
  EvaluationAgentOutput,
  SearchPlan,
  UserGoal,
} from '@/lib/agent/types';
import type { Restaurant } from '@/types';

const location = { lat: 30.2794, lng: 120.1305 };

function goal(): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃火锅',
    requestedItems: [],
    acceptableCategories: [{ name: '火锅', confidence: 0.9 }],
    alternativeGroups: [],
    primaryKeywords: ['火锅'],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [],
    allowBroaden: false,
  };
}

function context(): AgentContext {
  return {
    query: '想吃火锅',
    location,
    goal: goal(),
    attempts: [],
    candidates: [],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: 4,
    targetCount: 8,
  } as AgentContext;
}

const plan: SearchPlan = {
  keywords: ['火锅'],
  radiusMeters: 1800,
  searchIntent: 'exact',
  allowedForPrimary: true,
  reason: '先搜索用户明确表达的餐饮目标。',
  planId: 'plan_1',
};

function restaurant(id: string, distance: number): Restaurant {
  return {
    id,
    name: `${id}火锅`,
    cuisineType: '火锅',
    address: '测试地址',
    distance,
    location,
    source: 'amap',
  };
}

function verdict(restaurantId: string, confidence: number) {
  return {
    restaurantId,
    status: 'passed' as const,
    primaryEligible: true,
    confidence,
    matchedItems: [],
    matchedCategories: ['火锅'],
    conflicts: [],
    evidence: [`「${restaurantId}」符合搜索意图。`],
    warnings: [],
  };
}

function evaluation(overrides: Partial<EvaluationAgentOutput> = {}): EvaluationAgentOutput {
  return {
    verdicts: [verdict('high', 0.9), verdict('low', 0.4)],
    selectedIds: [],
    candidateIds: [],
    explanation: '',
    unmetConstraints: [],
    source: 'model',
    ...overrides,
  };
}

describe('候选排序', () => {
  const restaurants = [restaurant('high', 500), restaurant('low', 500)];

  it('按裁决内容排序，与模型是否"选中"无关', () => {
    const withoutSelection = evaluateSearchResult(
      restaurants, context(), plan, 1, evaluation()
    );
    // 就算模型把把握更低的那家钦点为 selectedIds，顺序也不该变。
    const withSelection = evaluateSearchResult(
      restaurants, context(), plan, 1, evaluation({ selectedIds: ['low'] })
    );

    expect(withoutSelection.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['high', 'low']);
    expect(withSelection.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['high', 'low']);
    expect(withSelection.acceptedCandidates.map((c) => c.score))
      .toEqual(withoutSelection.acceptedCandidates.map((c) => c.score));
  });

  it('相同输入必得相同分数，顺序完全可复现', () => {
    const first = evaluateSearchResult(restaurants, context(), plan, 1, evaluation());
    const second = evaluateSearchResult(restaurants, context(), plan, 1, evaluation());

    expect(first.acceptedCandidates.map((c) => [c.restaurant.id, c.score]))
      .toEqual(second.acceptedCandidates.map((c) => [c.restaurant.id, c.score]));
  });

  it('近的排在前面（同等把握时）', () => {
    const near = restaurant('near', 200);
    const far = restaurant('far', 3000);
    const observation = evaluateSearchResult(
      [far, near],
      context(),
      plan,
      1,
      evaluation({ verdicts: [verdict('far', 0.8), verdict('near', 0.8)] })
    );

    expect(observation.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['near', 'far']);
  });
});
