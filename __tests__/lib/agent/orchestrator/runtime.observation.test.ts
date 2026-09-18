import type { AgentInput, AgentRuntimeState, UserGoal } from '@/lib/agent/types';
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

async function loadRuntime(
  onEvaluate: (restaurants: Restaurant[]) => void = () => undefined,
  evaluationBatchSize?: number,
  missingEvidence: (restaurant: Restaurant) => boolean = () => false
) {
  jest.resetModules();
  process.env.AGENT_DETERMINISTIC = '1';
  delete process.env.AGENT_PARALLEL_SEARCH;
  if (evaluationBatchSize === undefined) {
    delete process.env.AGENT_EVALUATION_BATCH_SIZE;
  } else {
    process.env.AGENT_EVALUATION_BATCH_SIZE = String(evaluationBatchSize);
  }

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
      onEvaluate(input.restaurants);
      return {
        verdicts: input.restaurants.map((item) => ({
          restaurantId: item.id,
          status: 'passed' as const,
          primaryEligible: true,
          confidence: 0.9,
          matchedItems: ['寿司'],
          matchedCategories: [],
          conflicts: [],
          evidence: ['寿司店供应寿司'],
          targetEvidence: missingEvidence(item) ? [] : [{
              target: '寿司',
              kind: 'item' as const,
              verdict: 'supported',
              references: [{
                restaurantId: item.id,
                field: 'name' as const,
                value: item.name,
              }],
            }],
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
  const originalEvaluationBatchSize = process.env.AGENT_EVALUATION_BATCH_SIZE;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalDeterministic === undefined) delete process.env.AGENT_DETERMINISTIC;
    else process.env.AGENT_DETERMINISTIC = originalDeterministic;
    if (originalParallelSearch === undefined) delete process.env.AGENT_PARALLEL_SEARCH;
    else process.env.AGENT_PARALLEL_SEARCH = originalParallelSearch;
    if (originalEvaluationBatchSize === undefined) delete process.env.AGENT_EVALUATION_BATCH_SIZE;
    else process.env.AGENT_EVALUATION_BATCH_SIZE = originalEvaluationBatchSize;
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
    expect(restored.observations[0].facts).toEqual([{
      id: 'r1', source: 'amap', name: '寿司店', cuisineType: '寿司',
    }]);
    expect(restored.observations[0]).toEqual(expect.objectContaining({
      goalId: restored.goal.goalId,
      goalVersion: restored.goal.goalVersion,
      goalSignature: restored.goal.goalSignature,
    }));
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

  it('captures facts before evaluation and does not share the mutable provider object', async () => {
    const place = restaurant();
    const runSearchAgentV3 = await loadRuntime(() => { place.name = '改名后的寿司店'; });
    const result = await runSearchAgentV3(agentInput('寿司'), () => undefined, async () => [place]);
    expect(result.runtimeState?.observations?.[0].facts).toEqual([{
      id: 'r1', source: 'amap', name: '寿司店', cuisineType: '寿司',
    }]);
    place.name = '再次改名';
    expect(result.runtimeState?.observations?.[0].facts?.[0].name).toBe('寿司店');
  });

  it('stops progressive evaluation after reaching the target and records the rest as unevaluated', async () => {
    const evaluatedBatches: string[][] = [];
    const runSearchAgentV3 = await loadRuntime(
      (restaurants) => evaluatedBatches.push(restaurants.map((item) => item.id)),
      3
    );
    const emit = jest.fn();
    const result = await runSearchAgentV3(agentInput('寿司'), emit, async () =>
      Array.from({ length: 30 }, (_, index) => ({
        ...restaurant(),
        id: `r${index}`,
        name: `寿司店 ${index}`,
        distance: 100 + index,
      }))
    );

    const observation = result.runtimeState?.observations?.[0];
    expect(evaluatedBatches.map((batch) => batch.length)).toEqual([3, 3, 3]);
    expect(observation?.evaluatedIds).toHaveLength(9);
    expect(observation?.unevaluatedIds).toHaveLength(21);
    expect(observation?.evaluationStopReason).toBe('target_reached');
    expect(observation?.hardRejected).toEqual([]);
    expect(observation?.verdicts).toHaveLength(9);
    expect(observation?.acceptedPrimaryIds).toHaveLength(9);
    expect(result.restaurants).toHaveLength(8);
    expect(observation?.verdicts.some((verdict) =>
      observation.unevaluatedIds?.includes(verdict.restaurantId)
    )).toBe(false);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'observation',
      evaluated: 9,
      unevaluated: 21,
      evaluationStopReason: 'target_reached',
    }));
  });

  it('continues past self-reported passes without evidence to evaluate valid later candidates', async () => {
    const batches: string[][] = [];
    const runSearchAgentV3 = await loadRuntime(
      (restaurants) => batches.push(restaurants.map((item) => item.id)),
      3,
      (restaurant) => Number(restaurant.id.slice(1)) < 9
    );
    const result = await runSearchAgentV3(agentInput('寿司'), () => undefined, async () =>
      Array.from({ length: 30 }, (_, index) => ({
        ...restaurant(), id: `r${index}`, name: `寿司店 ${index}`,
      }))
    );
    const observation = result.runtimeState?.observations?.[0];
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 3, 3]);
    expect(observation?.evaluatedIds).toHaveLength(12);
    expect(observation?.unevaluatedIds).toHaveLength(18);
    expect(observation?.evaluationStopReason).toBe('budget_exhausted');
    expect(observation?.acceptedPrimaryIds).toEqual(['r9', 'r10', 'r11']);
    expect(result.restaurants.map((item) => item.id)).toEqual(['r9', 'r10', 'r11']);
  });

  it('retains successful batches and does not retry or promote a failed batch', async () => {
    let calls = 0;
    const runSearchAgentV3 = await loadRuntime(() => {
      calls += 1;
      if (calls === 2) throw new Error('evaluation unavailable');
    }, 3);
    const result = await runSearchAgentV3(agentInput('寿司'), () => undefined, async () =>
      Array.from({ length: 12 }, (_, index) => ({
        ...restaurant(), id: `r${index}`, name: `寿司店 ${index}`,
      }))
    );
    expect(calls).toBe(2);
    expect(result.restaurants.map((item) => item.id)).toEqual(['r0', 'r1', 'r2']);
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain('部分候选餐厅没能完成验证，已只保留通过验证的结果。');
    expect(result.runtimeState?.observations?.[0]).toMatchObject({
      evaluatedIds: ['r0', 'r1', 'r2'], evaluationStopReason: 'evaluation_failed',
    });
    expect(result.runtimeState?.observations?.[0].unevaluatedIds).toHaveLength(9);
  });

  it('keeps successful batches in the cancellation snapshot without publishing final', async () => {
    let calls = 0;
    const controller = new AbortController();
    const run = await loadRuntime(() => {
      calls += 1;
      if (calls === 2) {
        controller.abort();
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
    }, 3);
    const emit = jest.fn();
    const error = await run(
      { ...agentInput('寿司'), signal: controller.signal }, emit,
      async () => Array.from({ length: 12 }, (_, index) => ({
        ...restaurant(), id: `r${index}`, name: `寿司店 ${index}`,
      }))
    ).catch((caught: { code: string; runtimeState: AgentRuntimeState }) => caught);
    expect(error).toMatchObject({ code: 'CANCELLED', name: 'AbortError' });
    const state = error.runtimeState!;
    expect(state.observations?.[0]).toMatchObject({
      evaluatedIds: ['r0', 'r1', 'r2'], evaluationStopReason: 'cancelled',
    });
    expect(state.trace?.at(-1)?.output).toMatchObject({ outcome: 'cancelled' });
    expect(emit.mock.calls.some(([event]) => event.type === 'final')).toBe(false);
  });
});
