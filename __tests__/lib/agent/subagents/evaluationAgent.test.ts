import { deterministicEvaluation } from '@/lib/agent/subagents/evaluationAgent';
import type { SearchPlan, UserGoal } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = { lat: 31.2304, lng: 121.4737 };

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

describe('EvaluationAgent', () => {
  it('keeps dish-level requests out of unrelated primary recommendations', () => {
    const output = deterministicEvaluation({
      goal: goal(),
      plan: exactPlan,
      restaurants: [
        restaurant('r1', '城中牛排馆', '西餐厅', 300),
        restaurant('r2', '韩式烤肉', '韩国料理', 200),
      ],
      targetCount: 8,
    });

    expect(output.selectedIds).toEqual(['r1']);
    expect(output.verdicts.find((verdict) => verdict.restaurantId === 'r2')).toEqual(
      expect.objectContaining({
        status: 'failed',
        primaryEligible: false,
      })
    );
  });

  it('puts broadened but unverified candidates into the backup pool only', () => {
    const output = deterministicEvaluation({
      goal: goal({ allowBroaden: true }),
      plan: {
        ...exactPlan,
        keywords: ['西餐'],
        searchIntent: 'broadened',
        allowedForPrimary: false,
      },
      restaurants: [
        restaurant('r1', '社区西餐厅', '西餐厅', 300),
      ],
      targetCount: 8,
    });

    expect(output.selectedIds).toEqual([]);
    expect(output.candidateIds).toEqual(['r1']);
    expect(output.verdicts[0]).toEqual(expect.objectContaining({
      status: 'unverified',
      primaryEligible: false,
    }));
  });

  it('accepts exact dish search results when the provider category is compatible', () => {
    const output = deterministicEvaluation({
      goal: goal(),
      plan: exactPlan,
      restaurants: [
        restaurant('r1', '社区西餐厅', '西餐厅', 300),
      ],
      targetCount: 8,
    });

    expect(output.selectedIds).toEqual(['r1']);
    expect(output.verdicts[0]).toEqual(expect.objectContaining({
      status: 'passed',
      primaryEligible: true,
      matchedItems: ['牛排'],
      matchedCategories: ['西餐'],
    }));
  });
});
