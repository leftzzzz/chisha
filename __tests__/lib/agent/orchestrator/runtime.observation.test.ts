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
    requestedItems: [],
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
    name: '测试餐厅',
    cuisineType: '餐饮',
    address: '测试地址',
    location,
    source: 'amap',
    distance: 500,
  };
}

function agentInput(): AgentInput {
  return {
    query: '没有具体想吃的，你来选',
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
          matchedItems: [],
          matchedCategories: [],
          conflicts: [],
          evidence: [],
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
    const runSearchAgentV3 = await loadRuntime(() => {
      now += 500;
    });
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const result = await runSearchAgentV3(agentInput(), () => undefined, async () => {
      now = returnedAt;
      return [restaurant()];
    });

    expect(now).toBeGreaterThan(returnedAt);
    const restored = JSON.parse(JSON.stringify(result.runtimeState));
    expect(restored.observations.length).toBeGreaterThan(0);
    for (const observation of restored.observations) {
      expect(observation.fetchedAt).toBe(returnedAt);
    }
  });
});
