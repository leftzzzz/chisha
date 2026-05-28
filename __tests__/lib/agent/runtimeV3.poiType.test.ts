import type { AgentInput, SearchPlan, UserGoal } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function restaurant(
  id: string,
  name: string,
  cuisineType: string,
  poiTypeCode: string,
  distance = 500
): Restaurant {
  return {
    id,
    name,
    cuisineType,
    poiTypeCode,
    distance,
    address: '测试地址',
    location,
    source: 'amap',
  };
}

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '港奶',
    requestedItems: [{ name: '港式奶茶', required: true, aliases: ['港奶', '奶茶'] }],
    acceptableCategories: [{ name: '奶茶', confidence: 0.9 }],
    alternativeGroups: [],
    primaryKeywords: ['港奶'],
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

function input(searchGoal: UserGoal): AgentInput {
  return {
    query: searchGoal.rawQuery,
    location,
    runtimeState: {
      goal: searchGoal,
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
    },
  };
}

describe('runSearchAgentV3 POI type selection', () => {
  afterEach(() => {
    jest.dontMock('@/lib/agent/supervisor');
    jest.dontMock('@/lib/agent/subagents/poiTypeSelectionAgent');
    jest.resetModules();
  });

  it('uses selected Amap POI type and rejects unrelated exact-keyword retrievals', async () => {
    jest.doMock('@/lib/agent/supervisor', () => ({
      ...jest.requireActual('@/lib/agent/supervisor'),
      runSearchSupervisor: jest.fn(async (supervisorInput: { previousGoal?: UserGoal }) => ({
        goal: supervisorInput.previousGoal,
        nextAction: 'plan',
      })),
    }));
    jest.doMock('@/lib/agent/subagents/poiTypeSelectionAgent', () => ({
      runPoiTypeSelectionAgent: jest.fn(async () => ({
        typeCodes: ['050700'],
        confidence: 0.9,
        rationale: '港式奶茶应使用冷饮店。',
      })),
    }));

    const { runSearchAgentV3 } = await import('@/lib/agent/runtimeV3');
    const searchedPlans: SearchPlan[] = [];

    const result = await runSearchAgentV3(
      input(goal()),
      () => undefined,
      async (plan) => {
        searchedPlans.push(plan);
        return [
          restaurant('r1', '椰子鸡', '特色/地方风味餐厅', '050118', 200),
          restaurant('r2', '港式奶茶铺', '冷饮店', '050700', 300),
        ];
      }
    );

    expect(searchedPlans[0]).toEqual(expect.objectContaining({
      keywords: expect.arrayContaining(['港奶', '奶茶']),
      poiType: '050700',
    }));
    expect(result.restaurants.map((item) => item.name)).toEqual(['港式奶茶铺']);
    expect(result.candidates.map((item) => item.name)).not.toContain('椰子鸡');
  });
});
