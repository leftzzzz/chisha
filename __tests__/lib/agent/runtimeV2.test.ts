import { runSearchAgentV2 } from '@/lib/agent/runtimeV2';
import type { AgentInput, SearchPlan, UserGoal } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

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

describe('runSearchAgentV2', () => {
  it('uses EvaluationAgent verdicts and Runtime guards for primary recommendations', async () => {
    const input: AgentInput = {
      query: '想吃牛排',
      location,
      runtimeState: {
        goal: goal(),
        attempts: [],
        candidates: [],
      },
    };

    const result = await runSearchAgentV2(
      input,
      () => undefined,
      async () => [
        restaurant('r1', '城中牛排馆', '西餐厅', 300),
        restaurant('r2', '韩式烤肉', '韩国料理', 200),
      ]
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['城中牛排馆']);
    expect(result.candidates.map((item) => item.name)).not.toContain('韩式烤肉');
  });

  it('clamps strict downstairs distance before calling the search tool', async () => {
    const radii: number[] = [];
    const input: AgentInput = {
      query: '下楼就能吃的日料',
      location,
      runtimeState: {
        goal: goal({
          rawQuery: '下楼就能吃的日料',
          requestedItems: [],
          acceptableCategories: [{ name: '日料', confidence: 0.9 }],
          primaryKeywords: ['日料'],
          hardConstraints: [{ kind: 'distance', label: '楼下500米内', value: 500, maxMeters: 500, strict: true }],
        }),
        attempts: [],
        candidates: [],
      },
    };

    await runSearchAgentV2(
      input,
      () => undefined,
      async (plan: SearchPlan) => {
        radii.push(plan.radiusMeters);
        return [restaurant('r1', '寿司店', '日本料理', 300)];
      }
    );

    expect(radii.every((radius) => radius <= 500)).toBe(true);
  });

  it('stops after exact search returns usable primary recommendations', async () => {
    const searchedPlans: SearchPlan[] = [];
    const input: AgentInput = {
      query: '想吃牛排',
      location,
      runtimeState: {
        goal: goal({
          relatedKeywords: ['西餐'],
          broadenedKeywords: ['餐厅'],
        }),
        attempts: [],
        candidates: [],
      },
    };

    const result = await runSearchAgentV2(
      input,
      () => undefined,
      async (plan: SearchPlan) => {
        searchedPlans.push(plan);
        return [restaurant('r1', '社区西餐厅', '西餐厅', 300)];
      }
    );

    expect(searchedPlans.map((plan) => plan.searchIntent)).toEqual(['exact']);
    expect(result.restaurants.map((item) => item.name)).toEqual(['社区西餐厅']);
  });
});
