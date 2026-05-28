import { runSearchAgentV3 } from '@/lib/agent/runtimeV3';
import type { AgentEvent, AgentInput, SearchPlan, UserGoal } from '@/lib/agent/types';
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
    rawQuery: '想吃日料',
    requestedItems: [],
    acceptableCategories: [{ name: '日料', confidence: 0.9 }],
    alternativeGroups: [],
    primaryKeywords: ['日料'],
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

function input(searchGoal: UserGoal, query = searchGoal.rawQuery): AgentInput {
  return {
    query,
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

describe('runSearchAgentV3', () => {
  it('uses Supervisor actions and FinalGuard for primary recommendations', async () => {
    const events: AgentEvent[] = [];
    const result = await runSearchAgentV3(
      input(goal()),
      (event) => events.push(event),
      async () => [
        restaurant('r1', '寿司店', '日本料理', 300),
        restaurant('r2', '韩式烤肉', '韩国料理', 200),
      ]
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['寿司店']);
    expect(result.candidates.map((item) => item.name)).not.toContain('韩式烤肉');
    expect(events.some((event) => event.type === 'action')).toBe(true);
    expect(events.some((event) => event.type === 'observation')).toBe(true);
    expect(events.some((event) => event.type === 'final')).toBe(true);
  });

  it('clamps strict downstairs distance before calling the search tool', async () => {
    const radii: number[] = [];

    await runSearchAgentV3(
      input(goal({
        rawQuery: '下楼就能吃的日料',
        hardConstraints: [{ kind: 'distance', label: '楼下500米内', value: 500, maxMeters: 500, strict: true }],
      })),
      () => undefined,
      async (plan: SearchPlan) => {
        radii.push(plan.radiusMeters);
        return [restaurant('r1', '寿司店', '日本料理', 300)];
      }
    );

    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((radius) => radius <= 500)).toBe(true);
  });

  it('keeps unauthorized broadened results out of primary recommendations', async () => {
    const result = await runSearchAgentV3(
      input(goal({
        rawQuery: '炸鸡薯条',
        requestedItems: [
          { name: '炸鸡', required: true, aliases: ['鸡排', '炸物'] },
          { name: '薯条', required: true, aliases: ['汉堡'] },
        ],
        acceptableCategories: [{ name: '快餐', confidence: 0.8 }],
        primaryKeywords: ['炸鸡', '薯条'],
        broadenedKeywords: ['小吃'],
        allowBroaden: false,
      })),
      () => undefined,
      async (plan) => plan.searchIntent === 'broadened'
        ? [restaurant('r1', '沙县小吃', '小吃', 200)]
        : []
    );

    expect(result.paused).toBe(true);
    expect(result.restaurants).toEqual([]);
    expect(result.unmetConstraints?.join('')).toContain('未授权放宽');
  });

  it('allows broadened candidates into primary only after user authorization', async () => {
    const result = await runSearchAgentV3(
      input(goal({
        rawQuery: '炸鸡薯条，允许放宽',
        requestedItems: [
          { name: '炸鸡', required: true, aliases: ['鸡排', '炸物'] },
          { name: '薯条', required: true, aliases: ['汉堡'] },
        ],
        acceptableCategories: [{ name: '快餐', confidence: 0.8 }],
        primaryKeywords: ['炸鸡', '薯条'],
        broadenedKeywords: ['小吃'],
        allowBroaden: true,
      })),
      () => undefined,
      async (plan) => plan.searchIntent === 'broadened'
        ? [restaurant('r1', '沙县小吃', '小吃', 200)]
        : []
    );

    expect(result.paused).not.toBe(true);
    expect(result.restaurants.map((item) => item.name)).toEqual(['沙县小吃']);
  });

  it('pauses when no candidates pass primary recommendation admission', async () => {
    const result = await runSearchAgentV3(
      input(goal({
        rawQuery: '想吃非常具体的菜',
        requestedItems: [{ name: '非常具体的菜', required: true, aliases: [] }],
        acceptableCategories: [],
        primaryKeywords: ['非常具体的菜'],
      })),
      () => undefined,
      async () => []
    );

    expect(result.paused).toBe(true);
    expect(result.question?.question).toContain('非常具体的菜');
    expect(result.restaurants).toEqual([]);
  });

  it('clarifies vague initial requests before searching', async () => {
    const searchPlaces = jest.fn(async () => [restaurant('r1', '测试餐厅', '餐饮')]);
    const result = await runSearchAgentV3(
      {
        query: '随便推荐个附近好吃的',
        location,
        runtimeState: {
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      searchPlaces
    );

    expect(result.paused).toBe(true);
    expect(result.question?.question).toContain('具体想吃什么');
    expect(searchPlaces).not.toHaveBeenCalled();
  });

  it('continues with fallback search when clarification answer allows any recommendation', async () => {
    const first = await runSearchAgentV3(
      {
        query: '随便推荐个附近好吃的',
        location,
        runtimeState: {
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      async () => []
    );

    expect(first.paused).toBe(true);

    const searchedPlans: SearchPlan[] = [];
    const second = await runSearchAgentV3(
      {
        query: '都行',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async (plan) => {
        searchedPlans.push(plan);
        return [
          restaurant('r1', '社区餐厅', '餐饮', 300),
          restaurant('r2', '附近美食广场', '美食', 400),
          restaurant('r3', '家常饭店', '餐厅', 500),
        ];
      }
    );

    expect(second.paused).not.toBe(true);
    expect(searchedPlans.some((plan) => plan.searchIntent === 'fallback')).toBe(true);
    expect(second.restaurants.map((item) => item.name)).toEqual(expect.arrayContaining([
      '社区餐厅',
      '附近美食广场',
      '家常饭店',
    ]));
  });

  it('continues with fallback search when clarification answer is still a soft preference', async () => {
    const first = await runSearchAgentV3(
      {
        query: '随便推荐个附近好吃的',
        location,
        runtimeState: {
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      async () => []
    );

    expect(first.paused).toBe(true);

    const searchedPlans: SearchPlan[] = [];
    const second = await runSearchAgentV3(
      {
        query: '清淡一点',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async (plan) => {
        searchedPlans.push(plan);
        return [
          restaurant('r1', '清粥小菜', '粥', 300),
          restaurant('r2', '社区餐厅', '餐饮', 400),
          restaurant('r3', '轻食沙拉', '轻食', 500),
        ];
      }
    );

    expect(second.paused).not.toBe(true);
    expect(searchedPlans.some((plan) => plan.searchIntent === 'fallback')).toBe(true);
    expect(second.restaurants.length).toBeGreaterThan(0);
  });

  it('normalizes sentence keywords before executing search tools', async () => {
    const plans: SearchPlan[] = [];
    await runSearchAgentV3(
      input(goal({
        rawQuery: '想吃牛排',
        acceptableCategories: [],
        primaryKeywords: ['想吃牛排'],
      })),
      () => undefined,
      async (plan) => {
        plans.push(plan);
        return [restaurant('r1', '牛排馆', '西餐', 300)];
      }
    );

    expect(plans[0].keywords).toEqual(['牛排']);
  });

  it('continues with related keywords when exact cuisine search returns too few results', async () => {
    const plans: SearchPlan[] = [];
    const result = await runSearchAgentV3(
      input(goal({
        relatedKeywords: ['日本料理', '寿司', '刺身', '拉面'],
      })),
      () => undefined,
      async (plan) => {
        plans.push(plan);
        if (plan.searchIntent === 'exact') {
          return [
            restaurant('r1', '日料小馆', '日本料理', 300),
            restaurant('r2', '街角寿司', '寿司', 500),
            restaurant('r3', '拉面屋', '日本料理', 700),
          ];
        }

        return [
          restaurant('r4', '刺身居酒屋', '日本料理', 450),
          restaurant('r5', '深夜拉面', '日式拉面', 650),
          restaurant('r6', '寿司专门店', '寿司', 800),
        ];
      }
    );

    expect(plans.map((plan) => plan.searchIntent)).toEqual(expect.arrayContaining(['exact', 'synonym']));
    expect(plans.find((plan) => plan.searchIntent === 'synonym')?.keywords).toEqual(
      expect.arrayContaining(['日本料理', '寿司'])
    );
    expect(result.restaurants.length).toBeGreaterThan(3);
  });

  it('applies pending question option effects when resuming through the Supervisor', async () => {
    const first = await runSearchAgentV3(
      input(goal({
        rawQuery: '下楼就能吃的日料',
        hardConstraints: [{ kind: 'distance', label: '楼下500米内', value: 500, maxMeters: 500, strict: true }],
      })),
      () => undefined,
      async () => []
    );

    expect(first.paused).toBe(true);
    expect(first.question?.optionEffects?.['扩大范围']).toEqual({
      allowBroaden: true,
      setDistanceMaxMeters: 5000,
    });

    const searchedRadii: number[] = [];
    const second = await runSearchAgentV3(
      {
        query: '扩大范围',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async (plan) => {
        searchedRadii.push(plan.radiusMeters);
        return [restaurant('r1', '寿司店', '日本料理', 1600)];
      }
    );

    expect(second.paused).not.toBe(true);
    expect(searchedRadii.some((radius) => radius > 500)).toBe(true);
    expect(second.restaurants.map((item) => item.name)).toEqual(['寿司店']);
  });
});
