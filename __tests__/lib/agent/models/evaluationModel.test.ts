import type { SearchPlan, UserGoal } from '@/lib/agent/types';
import { EvaluationModelOutputSchema } from '@/lib/agent/schemas/verdict';
import type { Location, Restaurant } from '@/types';

const location: Location = { lat: 31.2304, lng: 121.4737 };
const originalApiKey = process.env.OPENAI_API_KEY;

function restaurant(id: string, name: string, cuisineType: string, distance = 500): Restaurant {
  return {
    id,
    name,
    cuisineType,
    distance,
    address: '测试地址',
    location,
    source: 'amap',
  };
}

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃牛排',
    requestedItems: [{ name: '牛排', required: true, aliases: [] }],
    acceptableCategories: [{ name: '西餐', confidence: 0.8 }],
    alternativeGroups: [],
    primaryKeywords: ['牛排'],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: false,
    ...overrides,
  };
}

const exactPlan: SearchPlan = {
  keywords: ['牛排'],
  radiusMeters: 1800,
  searchIntent: 'exact',
  allowedForPrimary: true,
  reason: 'exact',
};

function mockEvaluationResponse(argumentsJson: unknown): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          function_call: {
            name: 'evaluateRestaurantCandidates',
            arguments: JSON.stringify(argumentsJson),
          },
        },
      }],
    }),
  })) as jest.Mock;
}

function mockEvaluationResponses(responses: Array<{
  arguments: string;
  finishReason?: string;
}>): void {
  const fetchMock = jest.fn();

  for (const response of responses) {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          finish_reason: response.finishReason ?? 'stop',
          message: {
            function_call: {
              name: 'evaluateRestaurantCandidates',
              arguments: response.arguments,
            },
          },
        }],
      }),
    }));
  }

  global.fetch = fetchMock as jest.Mock;
}

describe('EvaluationModel', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('returns model verdicts without deterministic semantic correction', async () => {
    mockEvaluationResponse({
      verdicts: [
        {
          restaurantId: 'r1',
          status: 'failed',
          primaryEligible: false,
          confidence: 0.2,
          matchedItems: [],
          matchedCategories: [],
          conflicts: ['Agent 判定未验证到牛排。'],
          evidence: [],
          warnings: [],
        },
        {
          restaurantId: 'r2',
          status: 'passed',
          primaryEligible: true,
          confidence: 0.92,
          matchedItems: ['牛排'],
          matchedCategories: ['西餐'],
          targetEvidence: [{
            target: '牛排', kind: 'item',
            verdict: 'supported',
            references: [{ restaurantId: 'r2', field: 'name', value: '城中牛排馆' }],
          }],
          conflicts: [],
          evidence: ['Agent 认为名称明确命中牛排。'],
          warnings: [],
        },
      ],
      selectedIds: ['r2'],
      candidateIds: [],
      explanation: 'Agent 已完成候选验证。',
      unmetConstraints: ['Agent 判定未验证到牛排。'],
    });

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');
    const output = await runEvaluationModel({
      goal: goal(),
      plan: exactPlan,
      restaurants: [
        restaurant('r1', '社区西餐厅', '西餐厅', 300),
        restaurant('r2', '城中牛排馆', '西餐厅', 400),
      ],
      targetCount: 8,
    });

    expect(output.selectedIds).toEqual(['r2']);
    expect(output.source).toBe('model');
    expect(output.verdicts.find((verdict) => verdict.restaurantId === 'r2')?.targetEvidence)
      .toEqual([{
        target: '牛排', kind: 'item',
          verdict: 'supported',
        references: [{ restaurantId: 'r2', field: 'name', value: '城中牛排馆' }],
      }]);
    expect(output.verdicts.find((verdict) => verdict.restaurantId === 'r1')).toEqual(
      expect.objectContaining({
        status: 'failed',
        primaryEligible: false,
        conflicts: ['Agent 判定未验证到牛排。'],
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('parses per-condition verdict metadata with an invalid status fallback', () => {
    const parsed = EvaluationModelOutputSchema.parse({
      verdicts: [{
        restaurantId: 'r1',
        status: 'not-a-status',
        primaryEligible: true,
        confidence: 0.9,
        matchedItems: ['牛排'],
        matchedCategories: [],
        targetEvidence: [{
          target: '牛排',
          kind: 'item',
        verdict: 'supported',
          references: [{ restaurantId: 'r1', field: 'name', value: '城中牛排馆' }],
        }],
        conflicts: [],
        evidence: [],
        warnings: [],
      }],
      selectedIds: [],
      candidateIds: [],
      explanation: 'ok',
      unmetConstraints: [],
    });

    expect(parsed.verdicts[0].status).toBe('unverified');
    expect(parsed.verdicts[0].targetEvidence).toEqual([{
      target: '牛排', kind: 'item', verdict: 'supported',
      references: [{ restaurantId: 'r1', field: 'name', value: '城中牛排馆' }],
    }]);
  });

  it('requires OPENAI_API_KEY instead of falling back to hardcoded validation', async () => {
    delete process.env.OPENAI_API_KEY;

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');

    await expect(runEvaluationModel({
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    })).rejects.toThrow('EvaluationModel requires OPENAI_API_KEY');
  });

  it('defaults omitted verdict fields from model output instead of failing the whole response', async () => {
    mockEvaluationResponse({
      verdicts: [{
        restaurantId: 'r1',
        status: 'passed',
        primaryEligible: true,
        matchedItems: ['牛排'],
        matchedCategories: ['西餐'],
        evidence: ['Agent 判定符合。'],
      }],
      selectedIds: ['r1'],
    });

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');
    const output = await runEvaluationModel({
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    });

    expect(output.verdicts[0]).toEqual(expect.objectContaining({
      restaurantId: 'r1',
      confidence: 0.5,
      conflicts: [],
      warnings: [],
    }));
    expect(output.selectedIds).toEqual(['r1']);
    expect(output.candidateIds).toEqual([]);
    expect(output.unmetConstraints).toEqual([]);
  });

  it('retries when model function arguments are truncated before schema parsing', async () => {
    mockEvaluationResponses([
      {
        finishReason: 'length',
        arguments: '{"verdicts":[{"restaurantId":"r1","status":"passed","primaryEligible":true',
      },
      {
        arguments: JSON.stringify({
          verdicts: [{
            restaurantId: 'r1',
            status: 'passed',
            primaryEligible: true,
            confidence: 0.87,
            matchedItems: ['牛排'],
            matchedCategories: ['西餐'],
            conflicts: [],
            evidence: ['Agent 判定符合。'],
            warnings: [],
          }],
          selectedIds: ['r1'],
          candidateIds: [],
          explanation: 'retry ok',
          unmetConstraints: [],
        }),
      },
    ]);

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');
    const output = await runEvaluationModel({
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    });

    expect(output.verdicts[0].confidence).toBe(0.87);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const secondBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(firstBody.max_completion_tokens).toBe(4096);
    expect(secondBody.max_completion_tokens).toBe(8192);
  });

  it('calls the model for every evaluation request', async () => {
    // 进程内缓存已删除：Workers 上每个 isolate 独立且短命，命中率接近 0，
    // 但 key 计算开销每次都付。跨请求复用应由 D1/KV 承担并附命中率埋点。
    mockEvaluationResponse({
      verdicts: [{
        restaurantId: 'r1',
        status: 'passed',
        primaryEligible: true,
        confidence: 0.9,
        matchedItems: ['牛排'],
        matchedCategories: ['西餐'],
        conflicts: [],
        evidence: ['Agent 判定符合。'],
        warnings: [],
      }],
      selectedIds: ['r1'],
      candidateIds: [],
      explanation: 'ok',
      unmetConstraints: [],
    });

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');
    const request = {
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    };

    const first = await runEvaluationModel(request);
    const second = await runEvaluationModel(request);

    expect(first.source).toBe('model');
    expect(second.source).toBe('model');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('records model call metrics into the provided sink', async () => {
    mockEvaluationResponse({
      verdicts: [],
      selectedIds: [],
      candidateIds: [],
      explanation: 'ok',
      unmetConstraints: [],
    });

    const { runEvaluationModel } = await import('@/lib/agent/models/evaluationModel');
    const metricsSink: { modelCallMetrics?: unknown[] } = {};

    await runEvaluationModel({
      metricsSink,
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    });

    expect(metricsSink.modelCallMetrics).toHaveLength(1);
    expect(metricsSink.modelCallMetrics?.[0]).toEqual(
      expect.objectContaining({ modelRole: 'EvaluationModel', ok: true, attempts: 1 })
    );
  });
});
