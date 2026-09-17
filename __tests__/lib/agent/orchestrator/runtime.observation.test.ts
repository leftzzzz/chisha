import type { AgentInput, UserGoal } from '@/lib/agent/types';
import type { Restaurant } from '@/types';

const location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function goal(): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '没有具体想吃的，你来选',
    requestedItems: [{ name: '寿司', required: true, aliases: [] }],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: true,
  };
}

function restaurant(): Restaurant {
  return {
    id: 'r1',
    name: '寿司店',
    cuisineType: '寿司',
    address: '测试地址',
    location,
    source: 'amap',
    distance: 500,
  };
}

function agentInput(query = '没有具体想吃的，你来选'): AgentInput {
  return {
    query,
    location,
    runtimeState: {
      goal: goal(),
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
    },
  };
}

async function loadRuntime(onEvaluate = () => undefined) {
  jest.resetModules();
  process.env.AGENT_DETERMINISTIC = '1';
  delete process.env.AGENT_PARALLEL_SEARCH;

  jest.doMock('@/lib/agent/models/goalUnderstandingModel', () => {
    const actual = jest.requireActual('@/lib/agent/models/goalUnderstandingModel');
    return {
      ...actual,
      runGoalUnderstandingModel: jest.fn(async () => ({ goal: goal() })),
      runSearchReplan: jest.fn(async () => null),
    };
  });

  jest.doMock('@/lib/agent/models/evaluationModel', () => ({
    runEvaluationModel: jest.fn(async (input: { restaurants: Restaurant[] }) => {
      onEvaluate();
      return {
        verdicts: input.restaurants.map((item) => ({
          restaurantId: item.id,
          status: 'passed' as const,
          primaryEligible: true,
          confidence: 0.9,
          matchedItems: input.restaurants
            .filter((restaurant) => restaurant.name.includes('寿司'))
            .map(() => '寿司'),
          matchedCategories: [],
          conflicts: [],
          evidence: ['寿司店供应寿司'],
          targetEvidence: input.restaurants
            .filter((restaurant) => restaurant.name.includes('寿司'))
            .map((restaurant) => ({
              target: '寿司',
              kind: 'item' as const,
              references: [{
                restaurantId: restaurant.id,
                field: 'name' as const,
                value: restaurant.name,
              }],
            })),
          warnings: [],
        })),
        selectedIds: [],
        candidateIds: [],
        explanation: 'ok',
        unmetConstraints: [],
        source: 'model' as const,
      };
    }),
  }));

  const { runSearchAgentV3 } = await import('@/lib/agent/orchestrator/runtime');
  return runSearchAgentV3;
}

describe('runtime observation assembly', () => {
  const originalDeterministic = process.env.AGENT_DETERMINISTIC;
  const originalParallelSearch = process.env.AGENT_PARALLEL_SEARCH;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalDeterministic === undefined) delete process.env.AGENT_DETERMINISTIC;
    else process.env.AGENT_DETERMINISTIC = originalDeterministic;
    if (originalParallelSearch === undefined) delete process.env.AGENT_PARALLEL_SEARCH;
    else process.env.AGENT_PARALLEL_SEARCH = originalParallelSearch;
  });

  it('records fetchedAt on assembled observations', async () => {
    const runSearchAgentV3 = await loadRuntime();
    const result = await runSearchAgentV3(agentInput(), () => undefined, async () => [restaurant()]);

    const observation = result.runtimeState?.observations?.[0];
    expect(typeof observation?.fetchedAt).toBe('number');
    expect(observation?.fetchedAt).toBeGreaterThan(0);
    expect(observation?.fetchedAt).toBeLessThanOrEqual(Date.now());
  });

  it('keeps the provider return time through evaluation and JSON persistence', async () => {
    const returnedAt = 1_800_000_000_000;
    let now = returnedAt - 100;
    let evaluateCount = 0;
    const runSearchAgentV3 = await loadRuntime(() => {
      evaluateCount += 1;
      now += 500;
    });
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const result = await runSearchAgentV3(agentInput(), () => undefined, async () => {
      now = returnedAt;
      return [restaurant()];
    });

    expect(evaluateCount).toBeGreaterThan(0);
    const restored = JSON.parse(JSON.stringify(result.runtimeState));
    expect(restored.observations.length).toBeGreaterThan(0);
    for (const observation of restored.observations) {
      expect(observation.fetchedAt).toBe(returnedAt);
    }
  });

  it('binds ungrouped target evidence to the current observation', async () => {
    const runSearchAgentV3 = await loadRuntime();
    const emit = jest.fn();
    const result = await runSearchAgentV3(agentInput('寿司'), emit, async () => [restaurant()]);

    const observations = result.runtimeState?.observations ?? [];
    const candidate = result.runtimeState?.candidates?.[0];
    const evidence = candidate?.verification.targetEvidence?.[0];
    expect(result.restaurants.map((restaurant) => restaurant.name)).toEqual(['寿司店']);
    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0].acceptedPrimaryIds).toEqual(['r1']);
    expect(new Set(observations.map((observation) => observation.plan.planId)).size)
      .toBe(observations.length);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'observation', traceId: observations[0].traceId, accepted: 1,
    }));
    const restored = JSON.parse(JSON.stringify(result.runtimeState));
    expect(restored.observations[0].acceptedPrimaryIds).toEqual(['r1']);
    expect(restored.trace.find((entry: { id: string }) => entry.id === observations[0].traceId))
      .toEqual(expect.objectContaining({
        output: expect.objectContaining({ acceptedPrimaryIds: ['r1'] }),
      }));
    expect(evidence?.observationRef).toBe(observations[0]?.plan.planId);
    expect(observations.some((observation) =>
      observation.plan.planId === evidence?.observationRef
      && observation.provider === candidate?.restaurant.source
      && typeof observation.fetchedAt === 'number'
    )).toBe(true);
  });
});
