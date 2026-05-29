import type { SearchPlan, UserGoal } from '@/lib/agent/types';
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

describe('EvaluationAgent', () => {
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

    const { runEvaluationAgent } = await import('@/lib/agent/subagents/evaluationAgent');
    const output = await runEvaluationAgent({
      goal: goal(),
      plan: exactPlan,
      restaurants: [
        restaurant('r1', '社区西餐厅', '西餐厅', 300),
        restaurant('r2', '城中牛排馆', '西餐厅', 400),
      ],
      targetCount: 8,
    });

    expect(output.selectedIds).toEqual(['r2']);
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

  it('requires OPENAI_API_KEY instead of falling back to hardcoded validation', async () => {
    delete process.env.OPENAI_API_KEY;

    const { runEvaluationAgent } = await import('@/lib/agent/subagents/evaluationAgent');

    await expect(runEvaluationAgent({
      goal: goal(),
      plan: exactPlan,
      restaurants: [restaurant('r1', '城中牛排馆', '西餐厅', 300)],
      targetCount: 8,
    })).rejects.toThrow('EvaluationAgent requires OPENAI_API_KEY');
  });
});
