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
  missingEvidence: (restaurant: Restaurant) => boolean = () => false,
  goalOutput: () => UserGoal = goal
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
      runGoalUnderstandingModel: jest.fn(async () => ({ goal: goalOutput() })),
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
    expect(restored.observations[0].facts).toEqual([expect.objectContaining({
      id: 'r1', source: 'amap', name: '寿司店', cuisineType: '寿司',
    })]);
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
    expect(result.runtimeState?.observations?.[0].facts).toEqual([expect.objectContaining({
      id: 'r1', source: 'amap', name: '寿司店', cuisineType: '寿司',
    })]);
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

  it('counts committed primaries when stopping a later progressive evaluation', async () => {
    let currentGoal = goal();
    const evaluatedBatches: string[][] = [];
    const runSearchAgentV3 = await loadRuntime(
      (restaurants) => evaluatedBatches.push(restaurants.map((item) => item.id)),
      3,
      () => false,
      () => currentGoal
    );
    let firstSearchCalls = 0;
    const first = await runSearchAgentV3(agentInput('寿司'), () => undefined, async () => {
      firstSearchCalls += 1;
      return firstSearchCalls === 1
        ? Array.from({ length: 5 }, (_, index) => ({
            ...restaurant(),
            id: `existing-${index}`,
            name: `已有寿司店 ${index}`,
          }))
        : [];
    });
    expect(first.restaurants).toHaveLength(5);

    currentGoal = {
      ...first.runtimeState!.goal,
      relatedKeywords: ['拉面'],
      relatedTargets: [{ keyword: '拉面' }],
      broadenedKeywords: [],
      broadenedTargets: [],
    };
    evaluatedBatches.length = 0;
    const second = await runSearchAgentV3(
      {
        ...agentInput('继续找'),
        runtimeState: {
          ...first.runtimeState!,
          goal: currentGoal,
        },
      },
      () => undefined,
      async () => Array.from({ length: 12 }, (_, index) => ({
        ...restaurant(),
        id: `later-${index}`,
        name: `后续寿司店 ${index}`,
      }))
    );

    expect(evaluatedBatches.map((batch) => batch.length)).toEqual([3]);
    expect(second.restaurants).toHaveLength(8);
    expect(second.runtimeState?.observations?.at(-1)).toMatchObject({
      evaluatedIds: ['later-0', 'later-1', 'later-2'],
      evaluationStopReason: 'target_reached',
    });
    expect(second.runtimeState?.observations?.at(-1)?.unevaluatedIds).toHaveLength(9);
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

  it('resumes a cancelled observation without another provider search', async () => {
    let evaluationCalls = 0;
    let firstSearchDone = false;
    const runSearchAgentV3 = await loadRuntime(() => {
      evaluationCalls += 1;
      if (evaluationCalls === 2) {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
    }, 3);

    const cancelled = await runSearchAgentV3(
      agentInput('寿司'),
      () => undefined,
      async () => {
        if (firstSearchDone) throw new Error('provider search must not run again');
        firstSearchDone = true;
        return Array.from({ length: 12 }, (_, index) => ({
          ...restaurant(),
          id: `r${index}`,
          name: `寿司店 ${index}`,
        }));
      }
    ).catch((error: Error & { runtimeState?: AgentRuntimeState }) => error);

    expect(cancelled).toMatchObject({ code: 'CANCELLED', name: 'AbortError' });
    expect(cancelled.runtimeState?.observations?.[0]).toMatchObject({
      evaluationStopReason: 'cancelled',
    });

    const resumed = await runSearchAgentV3(
      {
        ...agentInput('寿司'),
        runtimeState: cancelled.runtimeState!,
      },
      () => undefined,
      async () => {
        throw new Error('provider search must not run again');
      }
    );

    expect(firstSearchDone).toBe(true);
    expect(resumed.restaurants).toHaveLength(8);
    expect(resumed.runtimeState?.attempts).toHaveLength(1);
    expect(resumed.runtimeState?.observations).toHaveLength(1);
    expect(resumed.runtimeState?.actions
      ?.filter((action) => action.action.type === 'search')).toHaveLength(1);
    expect(resumed.runtimeState?.observations?.[0]).toMatchObject({
      evaluatedIds: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8'],
      evaluationStopReason: 'target_reached',
    });
    expect(resumed.runtimeState?.observations?.[0]?.unevaluatedIds)
      .toEqual(['r9', 'r10', 'r11']);
    expect(resumed.runtimeState?.trace?.some((item) =>
      item.type === 'runtime_decision'
      && item.output?.kind === 'resume_cancelled_observation'
    )).toBe(true);
  });

  it('preserves partial progress when a resumed observation is cancelled again', async () => {
    let evaluationCalls = 0;
    let searchCalls = 0;
    const runSearchAgentV3 = await loadRuntime(() => {
      evaluationCalls += 1;
      if (evaluationCalls === 2 || evaluationCalls === 4) {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
    }, 3);
    const searchPlaces = async () => {
      searchCalls += 1;
      return Array.from({ length: 12 }, (_, index) => ({
        ...restaurant(),
        id: `r${index}`,
        name: `寿司店 ${index}`,
      }));
    };

    const first = await runSearchAgentV3(
      agentInput('寿司'),
      () => undefined,
      searchPlaces
    ).catch((error: Error & { runtimeState?: AgentRuntimeState }) => error);
    expect(first).toMatchObject({ code: 'CANCELLED', name: 'AbortError' });
    expect(first.runtimeState?.observations?.[0]?.evaluatedIds)
      .toEqual(['r0', 'r1', 'r2']);

    const second = await runSearchAgentV3({
      ...agentInput('寿司'),
      runtimeState: first.runtimeState!,
    }, () => undefined, searchPlaces).catch((error: Error & {
      runtimeState?: AgentRuntimeState;
    }) => error);
    expect(second).toMatchObject({ code: 'CANCELLED', name: 'AbortError' });
    expect(second.runtimeState?.observations?.[0]).toMatchObject({
      evaluatedIds: ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'],
      evaluationStopReason: 'cancelled',
    });

    const third = await runSearchAgentV3({
      ...agentInput('寿司'),
      runtimeState: second.runtimeState!,
    }, () => undefined, searchPlaces);
    expect(searchCalls).toBe(1);
    expect(third.restaurants).toHaveLength(8);
    expect(third.runtimeState?.observations?.[0]?.evaluatedIds)
      .toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8']);
    expect(third.runtimeState?.observations?.[0]?.evaluationStopReason)
      .toBe('target_reached');
  });

  it('does not partially resume when persisted facts are incomplete', async () => {
    let evaluationCalls = 0;
    const runSearchAgentV3 = await loadRuntime(() => {
      evaluationCalls += 1;
      if (evaluationCalls === 2) {
        const error = new Error('cancelled');
        error.name = 'AbortError';
        throw error;
      }
    }, 3);
    const cancelled = await runSearchAgentV3(
      agentInput('寿司'),
      () => undefined,
      async () => Array.from({ length: 12 }, (_, index) => ({
        ...restaurant(), id: `r${index}`, name: `寿司店 ${index}`,
      }))
    ).catch((error: Error & { runtimeState?: AgentRuntimeState }) => error);

    const state = cancelled.runtimeState!;
    state.observations[0].facts = state.observations[0].facts!.slice(0, 4);
    const resumed = await runSearchAgentV3({
      ...agentInput('寿司'),
      runtimeState: state,
    }, () => undefined, async () => {
      throw new Error('fresh provider search required');
    }).catch((error: Error & { runtimeState?: AgentRuntimeState }) => error);

    expect(resumed.message).toBe('fresh provider search required');
    expect(resumed.runtimeState?.trace?.some((item) =>
      item.type === 'runtime_decision'
      && item.output?.kind === 'resume_cancelled_observation'
    )).toBe(false);
  });
});
