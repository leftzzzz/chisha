/**
 * 一轮内所有 agent 的调用指标必须落在同一个容器里。
 *
 * 首搜与 KeywordExpansion 并发之后，联想词和候选验证是同时写指标的。
 * 曾经它们各写各的容器、最后互相覆盖，导致 turn 汇总丢掉一部分调用。
 */

import type { ModelCallMetrics } from '@/lib/agent/metrics';
import type { AgentInput, UserGoal } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = { lat: 31.2304, lng: 121.4737, address: '上海市黄浦区' };

function recordInto(sink: { modelCallMetrics?: ModelCallMetrics[] }, agentName: string): void {
  const metrics: ModelCallMetrics = {
    agentName,
    model: 'test-model',
    startedAt: 0,
    durationMs: 10,
    attempts: 1,
    mode: 'tools',
    truncated: false,
    ok: true,
  };

  if (!sink.modelCallMetrics) {
    sink.modelCallMetrics = [];
  }
  sink.modelCallMetrics.push(metrics);
}

jest.mock('@/lib/agent/subagents/goalUnderstandingAgent', () => {
  const actual = jest.requireActual('@/lib/agent/subagents/goalUnderstandingAgent');
  return {
    ...actual,
    // Supervisor 走确定性短路：不记指标，于是 turn 容器起初是空的——
    // 这正是曾经触发覆盖的条件。
    runGoalUnderstandingAgent: jest.fn(async (input: { message: string }) => ({
      goal: {
        intent: 'find_restaurants',
        rawQuery: input.message,
        requestedItems: [],
        acceptableCategories: [{ name: '火锅', confidence: 0.9 }],
        alternativeGroups: [],
        primaryKeywords: ['火锅'],
        relatedKeywords: [],
        broadenedKeywords: [],
        hardConstraints: [],
        softPreferences: [],
        exclusions: [],
        ambiguity: [],
        clarificationNeeded: [],
        allowBroaden: false,
      } as UserGoal,
      nextAction: 'plan',
    })),
  };
});

jest.mock('@/lib/agent/subagents/keywordExpansionAgent', () => {
  const actual = jest.requireActual('@/lib/agent/subagents/keywordExpansionAgent');
  return {
    ...actual,
    runKeywordExpansionAgent: jest.fn(async (input: {
      metricsSink?: { modelCallMetrics?: ModelCallMetrics[] };
    }) => {
      if (input.metricsSink) {
        recordInto(input.metricsSink, 'KeywordExpansionAgent');
      }

      return {
        relatedKeywords: [],
        broadenedKeywords: [],
        relatedTargets: [],
        broadenedTargets: [],
        rationale: 'test',
      };
    }),
  };
});

jest.mock('@/lib/agent/subagents/evaluationAgent', () => ({
  runEvaluationAgent: jest.fn(async (input: {
    metricsSink?: { modelCallMetrics?: ModelCallMetrics[] };
    restaurants: Restaurant[];
  }) => {
    if (input.metricsSink) {
      recordInto(input.metricsSink, 'EvaluationAgent');
    }

    return {
      verdicts: input.restaurants.map((item) => ({
        restaurantId: item.id,
        status: 'passed' as const,
        primaryEligible: true,
        confidence: 0.9,
        matchedItems: ['火锅'],
        matchedCategories: ['火锅'],
        conflicts: [],
        evidence: ['ok'],
        warnings: [],
      })),
      selectedIds: input.restaurants.map((item) => item.id),
      candidateIds: [],
      explanation: 'ok',
      unmetConstraints: [],
      source: 'model' as const,
    };
  }),
}));

import { runSearchAgentV3 } from '@/lib/agent/orchestrator/runtime';

const input: AgentInput = {
  query: '想吃火锅',
  location,
  runtimeState: { goal: undefined, attempts: [], candidates: [], actions: [], observations: [] },
};

describe('turn 指标汇总', () => {
  it('counts concurrent keyword expansion and evaluation calls in the same turn', async () => {
    const result = await runSearchAgentV3(input, () => undefined, async () => [{
      id: 'r1',
      name: '海底捞火锅',
      cuisineType: '火锅',
      address: '测试地址',
      distance: 300,
      location,
      source: 'amap' as const,
    }]);

    const modelCallTrace = (result.runtimeState?.trace ?? [])
      .filter((item) => item.type === 'model_call')
      .at(-1)?.output as { modelCalls: number; byAgent: Record<string, { calls: number }> };

    expect(modelCallTrace.byAgent.KeywordExpansionAgent?.calls).toBe(1);
    expect(modelCallTrace.byAgent.EvaluationAgent?.calls).toBeGreaterThanOrEqual(1);
    expect(modelCallTrace.modelCalls).toBeGreaterThanOrEqual(2);
  });
});
