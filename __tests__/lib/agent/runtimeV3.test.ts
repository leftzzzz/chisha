jest.mock('@/lib/agent/supervisorPlanner', () => {
  const actual = jest.requireActual('@/lib/agent/supervisorPlanner');
  return {
    ...actual,
    runSupervisorPlanner: jest.fn(async (input: {
      message: string;
      previousGoal?: import('@/lib/agent/types').UserGoal;
      pendingQuestion?: import('@/lib/agent/types').PendingQuestion;
      goal?: import('@/lib/agent/types').UserGoal;
      limits?: unknown;
    }, context?: import('@/lib/agent/types').AgentContext) => {
      if (input.goal && input.limits) {
        return actual.runSupervisorPlanner(input, context);
      }

      if (input.previousGoal && input.pendingQuestion) {
        if (input.message === '扩大范围') {
          return {
            patch: {
              addConstraints: [{
                kind: 'distance',
                label: '5000米内',
                value: 5000,
                maxMeters: 5000,
                strict: false,
              }],
              removeConstraints: ['楼下500米内', '步行1公里内'],
              allowBroaden: true,
              reason: '根据用户追问选项更新目标。',
            },
            nextAction: 'plan',
          };
        }

        if (input.message === '火锅') {
          return {
            patch: {
              replacePrimaryKeywords: ['火锅'],
              replaceRequestedItems: [{ name: '火锅', required: true, aliases: [] }],
              reason: '用户补充了新的主目标。',
            },
            nextAction: 'plan',
          };
        }

        return {
          patch: {
            allowBroaden: true,
            addSoftPreferences: input.message.includes('清淡')
              ? [{ name: '清淡', weight: 2, verifiable: false }]
              : [{ name: '默认多样性', weight: 1, verifiable: true }],
            reason: '用户授权开放推荐。',
          },
          nextAction: 'plan',
        };
      }

      if (input.previousGoal) {
        return { goal: input.previousGoal, nextAction: 'plan' };
      }

      return {
        goal: {
          intent: 'find_restaurants',
          rawQuery: input.message,
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
          clarificationNeeded: [{
            reason: '用户需求缺少可验证的菜品或品类目标。',
            question: '你想找哪类餐厅，或具体想吃什么？',
            allowFreeText: true,
          }],
          allowBroaden: false,
        },
        nextAction: 'ask_user',
      };
    }),
  };
});

jest.mock('@/lib/agent/subagents/evaluationAgent', () => ({
  runEvaluationAgent: jest.fn(async (input: {
    plan: import('@/lib/agent/types').SearchPlan;
    restaurants: Restaurant[];
    targetCount: number;
  }) => {
    const verdicts = input.restaurants.map((item) => {
      const matchesSearchKeyword = input.plan.keywords.some((keyword) =>
        item.name.includes(keyword) || item.cuisineType.includes(keyword)
      );
      const openFallback = input.plan.searchIntent === 'fallback';
      const accepted = matchesSearchKeyword || openFallback;

      return {
        restaurantId: item.id,
        status: accepted ? 'passed' : 'failed',
        primaryEligible: accepted && input.plan.allowedForPrimary,
        confidence: accepted ? 0.9 : 0.2,
        matchedItems: matchesSearchKeyword ? input.plan.keywords : [],
        matchedCategories: matchesSearchKeyword ? [item.cuisineType] : [],
        conflicts: accepted ? [] : ['Agent 语义验证未通过。'],
        evidence: accepted ? [`Agent 验证「${item.name}」符合搜索意图。`] : [],
        warnings: [],
      };
    });
    const selectedIds = verdicts
      .filter((verdict) => verdict.status === 'passed' && verdict.primaryEligible)
      .slice(0, input.targetCount)
      .map((verdict) => verdict.restaurantId);
    const selectedIdSet = new Set(selectedIds);
    const candidateIds = verdicts
      .filter((verdict) => !selectedIdSet.has(verdict.restaurantId) && verdict.status !== 'failed')
      .map((verdict) => verdict.restaurantId);

    return {
      verdicts,
      selectedIds,
      candidateIds,
      explanation: 'Agent mock evaluation.',
      unmetConstraints: verdicts.flatMap((verdict) => verdict.conflicts),
    };
  }),
}));

import { runSearchAgentV3 } from '@/lib/agent/runtimeV3';
import { runSupervisorPlanner } from '@/lib/agent/supervisorPlanner';
import { runEvaluationAgent } from '@/lib/agent/subagents/evaluationAgent';
import { deriveLocationSignature, withUpdatedGoalVersion } from '@/lib/agent/goalVersion';
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('records a replayable trace timeline for model, guard, tool, evaluation, and final steps', async () => {
    const result = await runSearchAgentV3(
      input(goal()),
      () => undefined,
      async () => [restaurant('r1', '寿司店', '日本料理', 300)]
    );

    const trace = result.runtimeState?.trace ?? [];
    expect(trace.map((item) => item.type)).toEqual(expect.arrayContaining([
      'user_message',
      'model_goal',
      'model_action',
      'guard_decision',
      'tool_start',
      'tool_result',
      'evaluation',
      'observation',
      'state_update',
      'final',
    ]));
    expect(trace.find((item) => item.type === 'model_action')?.rawAction?.type).toBe('search');
    expect(trace.find((item) => item.type === 'guard_decision')?.guardDecision?.type).toBe('allow');
    expect(trace.find((item) => item.type === 'tool_result')?.output).toEqual(
      expect.objectContaining({
        found: 1,
        provider: 'amap',
        restaurantIds: ['r1'],
      })
    );
    expect(result.runtimeState?.goal?.goalVersion).toBe(1);
    expect(result.runtimeState?.candidates[0]).toEqual(expect.objectContaining({
      goalId: result.runtimeState?.goal?.goalId,
      verifiedAgainstGoalVersion: 1,
      verifiedAgainstGoalSignature: result.runtimeState?.goal?.goalSignature,
    }));
  });

  it('marks existing candidates stale when a follow-up changes hard constraints', async () => {
    const first = await runSearchAgentV3(
      input(goal()),
      () => undefined,
      async () => [restaurant('r1', '寿司店', '日本料理', 300)]
    );
    expect(first.paused).not.toBe(true);

    const supervisorMock = runSupervisorPlanner as jest.Mock;
    supervisorMock.mockResolvedValueOnce({
      patch: {
        addConstraints: [{
          kind: 'budget',
          label: '50元以下',
          max: 50,
        }],
        reason: '用户追加预算硬约束。',
      },
      nextAction: 'plan',
    });

    const second = await runSearchAgentV3(
      {
        query: '预算 50 以下',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async () => []
    );

    expect(second.runtimeState?.goal?.goalVersion).toBe((first.runtimeState?.goal?.goalVersion ?? 1) + 1);
    expect(second.runtimeState?.candidates.some((item) => item.stale)).toBe(true);
    expect(second.runtimeState?.candidates.find((item) => item.restaurant.id === 'r1')?.staleReason)
      .toContain('当前目标不一致');
  });

  it('limits EvaluationAgent candidates to the target count plus buffer by default', async () => {
    await runSearchAgentV3(
      input(goal({
        rawQuery: 'pizza',
        acceptableCategories: [{ name: 'pizza', confidence: 0.9 }],
        primaryKeywords: ['pizza'],
      })),
      () => undefined,
      async () => Array.from({ length: 30 }, (_, index) =>
        restaurant(`r${index}`, `pizza place ${index}`, 'pizza', 100 + index)
      )
    );

    expect(runEvaluationAgent).toHaveBeenCalledTimes(2);
    const evaluationInputs = (runEvaluationAgent as jest.Mock).mock.calls.map((call) => call[0]);
    const evaluatedRestaurants = evaluationInputs.flatMap((item) => item.restaurants);
    expect(evaluationInputs.every((item) => item.restaurants.length <= 6)).toBe(true);
    expect(evaluatedRestaurants).toHaveLength(12);
    expect(evaluatedRestaurants.map((item: Restaurant) => item.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `r${index}`)
    );
  });

  it('pre-filters deterministic hard constraint failures before EvaluationAgent runs', async () => {
    await runSearchAgentV3(
      input(goal({
        rawQuery: 'pizza nearby',
        acceptableCategories: [{ name: 'pizza', confidence: 0.9 }],
        primaryKeywords: ['pizza'],
        hardConstraints: [{
          kind: 'distance',
          label: '500m',
          value: 500,
          maxMeters: 500,
          strict: true,
        }],
      })),
      () => undefined,
      async () => [
        ...Array.from({ length: 6 }, (_, index) =>
          restaurant(`far${index}`, `pizza far ${index}`, 'pizza', 900 + index)
        ),
        ...Array.from({ length: 20 }, (_, index) =>
          restaurant(`near${index}`, `pizza near ${index}`, 'pizza', 100 + index)
        ),
      ]
    );

    expect(runEvaluationAgent).toHaveBeenCalledTimes(2);
    const evaluationInputs = (runEvaluationAgent as jest.Mock).mock.calls.map((call) => call[0]);
    const evaluatedRestaurants = evaluationInputs.flatMap((item) => item.restaurants);
    expect(evaluationInputs.every((item) => item.restaurants.length <= 6)).toBe(true);
    expect(evaluatedRestaurants).toHaveLength(12);
    expect(evaluatedRestaurants.map((item: Restaurant) => item.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `near${index}`)
    );
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
        acceptableCategories: [],
        primaryKeywords: ['炸鸡'],
        broadenedKeywords: ['小吃'],
        allowBroaden: false,
      })),
      () => undefined,
      async (plan) => plan.searchIntent === 'broadened'
        ? [restaurant('r1', '小吃铺', '小吃', 200)]
        : []
    );

    expect(result.paused).toBe(true);
    expect(result.restaurants).toEqual([]);
    expect(result.unmetConstraints?.join('')).toContain('不同品牌');
  });

  it('promotes existing broadened candidates after the user authorizes broadening', async () => {
    const first = await runSearchAgentV3(
      input(goal({
        rawQuery: '炸鸡薯条',
        requestedItems: [
          { name: '炸鸡', required: true, aliases: ['鸡排', '炸物'] },
          { name: '薯条', required: true, aliases: ['汉堡'] },
        ],
        acceptableCategories: [],
        primaryKeywords: ['炸鸡'],
        broadenedKeywords: ['小吃'],
        allowBroaden: false,
      })),
      () => undefined,
      async (plan) => plan.searchIntent === 'broadened'
        ? [restaurant('r1', '小吃铺', '小吃', 200)]
        : []
    );

    expect(first.paused).toBe(true);
    expect(first.runtimeState?.attempts.length).toBeGreaterThan(0);

    const searchPlaces = jest.fn(async () => []);
    const second = await runSearchAgentV3(
      {
        query: '都行',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      searchPlaces
    );

    expect(searchPlaces).not.toHaveBeenCalled();
    expect(second.paused).not.toBe(true);
    expect(second.restaurants.map((item) => item.name)).toEqual(['小吃铺']);
    expect(second.runtimeState?.attempts.some((attempt) =>
      attempt.searchIntent === 'broadened' && attempt.allowedForPrimary === true
    )).toBe(true);
  });

  it('finalizes already promoted broadened candidates without asking the Supervisor for another search', async () => {
    const searchPlaces = jest.fn(async () => []);
    const promotedGoal = withUpdatedGoalVersion(goal({
      rawQuery: '炸鸡薯条，允许放宽',
      requestedItems: [
        { name: '炸鸡', required: true, aliases: ['鸡排', '炸物'] },
        { name: '薯条', required: true, aliases: ['汉堡'] },
      ],
      acceptableCategories: [{ name: '快餐', confidence: 0.8 }],
      primaryKeywords: ['炸鸡', '薯条'],
      allowBroaden: true,
    }));
    const result = await runSearchAgentV3(
      {
        query: '允许放宽',
        location,
        runtimeState: {
          goal: promotedGoal,
          attempts: [{
            keywords: ['小吃'],
            radius: 1800,
            searchIntent: 'broadened',
            allowedForPrimary: true,
            reason: '原始目标不足，搜索相邻品类作为候补。 用户已授权放宽，可进入主推荐。',
            found: 1,
            accepted: 1,
          }],
          candidates: [{
            candidateId: `${promotedGoal.goalId}:${promotedGoal.goalVersion}:r1:1`,
            goalId: promotedGoal.goalId,
            verifiedAgainstGoalVersion: promotedGoal.goalVersion,
            verifiedAgainstGoalSignature: promotedGoal.goalSignature,
            locationSignature: deriveLocationSignature(location),
            restaurant: restaurant('r1', '沙县小吃', '小吃', 200),
            score: 95,
            matched: ['Agent 验证品类小吃'],
            warnings: [],
            sourceAttempt: 1,
            verification: {
              restaurantId: 'r1',
              status: 'passed',
              primaryEligible: true,
              hardFailures: [],
              itemMatches: [],
              categoryMatches: ['小吃'],
              warnings: [],
              confidence: 0.9,
            },
          }],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      searchPlaces
    );

    expect(searchPlaces).not.toHaveBeenCalled();
    expect(result.paused).not.toBe(true);
    expect(result.restaurants.map((item) => item.name)).toEqual(['沙县小吃']);
  });

  it('allows broadened candidates into primary only after user authorization', async () => {
    const result = await runSearchAgentV3(
      input(goal({
        rawQuery: '炸鸡薯条，允许放宽',
        requestedItems: [
          { name: '炸鸡', required: true, aliases: ['鸡排', '炸物'] },
          { name: '薯条', required: true, aliases: ['汉堡'] },
        ],
        acceptableCategories: [],
        primaryKeywords: ['炸鸡'],
        broadenedKeywords: ['小吃'],
        allowBroaden: true,
      })),
      () => undefined,
      async (plan) => plan.searchIntent === 'broadened'
        ? [restaurant('r1', '小吃铺', '小吃', 200)]
        : []
    );

    expect(result.paused).not.toBe(true);
    expect(result.restaurants.map((item) => item.name)).toEqual(['小吃铺']);
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

  it('does not ask for broadening again after authorized broadened targets are exhausted', async () => {
    const searchGoal = withUpdatedGoalVersion(goal({
      rawQuery: '想吃日料，允许放宽',
      relatedKeywords: ['日本料理', '寿司', '刺身'],
      relatedTargets: [
        { keyword: '日本料理', poiTypes: ['050202'], confidence: 0.8 },
        { keyword: '寿司', poiTypes: ['050202'], confidence: 0.8 },
        { keyword: '刺身', poiTypes: ['050202'], confidence: 0.8 },
      ],
      broadenedKeywords: ['亚洲料理', '韩国料理', '东南亚菜'],
      broadenedTargets: [
        { keyword: '亚洲料理', poiTypes: ['050217'], confidence: 0.7 },
        { keyword: '韩国料理', poiTypes: ['050203'], confidence: 0.7 },
        { keyword: '东南亚菜', poiTypes: ['050206', '050217'], confidence: 0.7 },
      ],
      allowBroaden: true,
      authorizations: [{
        id: 'auth_category_broaden_test',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '用户授权放宽到相邻品类。',
        constraints: {
          allowedSearchIntents: ['broadened'],
        },
      }],
    }));
    const searchPlaces = jest.fn(async () => []);

    const result = await runSearchAgentV3(
      {
        query: '允许放宽',
        location,
        runtimeState: {
          goal: searchGoal,
          attempts: [
            { keywords: ['日料'], radius: 1800, searchIntent: 'exact', allowedForPrimary: true, reason: 'exact', found: 0, accepted: 0 },
            { keywords: ['亚洲料理'], radius: 2250, poiType: '050217', searchIntent: 'broadened', allowedForPrimary: true, reason: 'broadened', found: 0, accepted: 0 },
            { keywords: ['韩国料理'], radius: 2813, poiType: '050203', searchIntent: 'broadened', allowedForPrimary: true, reason: 'broadened', found: 0, accepted: 0 },
            { keywords: ['东南亚菜'], radius: 3516, poiType: '050206|050217', searchIntent: 'broadened', allowedForPrimary: true, reason: 'broadened', found: 0, accepted: 0 },
            { keywords: ['日本料理'], radius: 4395, poiType: '050202', searchIntent: 'synonym', allowedForPrimary: true, reason: 'synonym', found: 0, accepted: 0 },
            { keywords: ['寿司'], radius: 5000, poiType: '050202', searchIntent: 'synonym', allowedForPrimary: true, reason: 'synonym', found: 0, accepted: 0 },
            { keywords: ['刺身'], radius: 5000, poiType: '050202', searchIntent: 'synonym', allowedForPrimary: true, reason: 'synonym', found: 0, accepted: 0 },
          ],
          candidates: [],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      searchPlaces
    );

    expect(searchPlaces).not.toHaveBeenCalled();
    expect(result.paused).toBe(true);
    expect(result.question?.question).not.toContain('允许放宽');
    expect(result.question?.options).toEqual(['随便推荐', '换个类型']);
    expect(result.question?.optionEffects?.['随便推荐']).toEqual(expect.objectContaining({
      allowBroaden: true,
    }));
    expect(result.restaurants).toEqual([]);
  });

  it('clarifies soft-preference-only initial requests before searching', async () => {
    const searchPlaces = jest.fn(async () => [restaurant('r1', '测试餐厅', '餐饮')]);
    const result = await runSearchAgentV3(
      {
        query: '想吃清淡点',
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

  it('uses fallback search when the Supervisor returns an open recommendation goal', async () => {
    const supervisorMock = runSupervisorPlanner as jest.Mock;
    supervisorMock.mockClear();
    supervisorMock.mockResolvedValueOnce({
      goal: goal({
        rawQuery: '没有具体想吃的，你来选',
        requestedItems: [],
        acceptableCategories: [],
        primaryKeywords: [],
        softPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
        allowBroaden: true,
        authorizations: [{
          id: 'auth_fallback_primary_test',
          kind: 'fallback_primary',
          createdAt: 1,
          reason: 'Supervisor 理解为开放推荐。',
          constraints: {
            allowedSearchIntents: ['fallback'],
          },
        }],
      }),
      conversationMode: 'start_new_goal',
      nextAction: 'plan',
    });
    const searchedPlans: SearchPlan[] = [];
    const result = await runSearchAgentV3(
      {
        query: '没有具体想吃的，你来选',
        location,
        runtimeState: {
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        },
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

    expect(result.paused).not.toBe(true);
    const goalPlannerCalls = supervisorMock.mock.calls.filter(([plannerInput]) =>
      !(plannerInput.goal && plannerInput.limits)
    );
    expect(goalPlannerCalls).toHaveLength(1);
    expect(searchedPlans.some((plan) => plan.searchIntent === 'fallback')).toBe(true);
    expect(searchedPlans[0].keywords).toEqual(['餐厅']);
    expect(result.restaurants.length).toBeGreaterThan(0);

    const guardDecisions = result.runtimeState?.trace
      ?.filter((item) => item.type === 'guard_decision')
      .map((item) => item.guardDecision);
    expect(guardDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'request_rewrite',
        violations: expect.arrayContaining([
          expect.objectContaining({ code: 'MULTI_INTENT_KEYWORDS' }),
        ]),
      }),
    ]));
    expect(result.runtimeState?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'runtime_decision',
        output: expect.objectContaining({ reason: 'guard_rewrite_exhausted' }),
      }),
    ]));
  });

  it('does not infer an open recommendation goal if the Supervisor truncates', async () => {
    const supervisorMock = runSupervisorPlanner as jest.Mock;
    supervisorMock.mockRejectedValueOnce(
      new Error('SupervisorPlannerAgent returned truncated function arguments')
    );
    const searchedPlans: SearchPlan[] = [];

    await expect(runSearchAgentV3(
      {
        query: '没有具体想吃的，你来选',
        location,
        runtimeState: {
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        },
      },
      () => undefined,
      async (plan) => {
        searchedPlans.push(plan);
        return [restaurant('r1', '社区餐厅', '餐饮', 300)];
      }
    )).rejects.toThrow('SupervisorPlannerAgent returned truncated function arguments');

    expect(searchedPlans).toEqual([]);
  });

  it('records the observed provider when search falls back to OSM results', async () => {
    const result = await runSearchAgentV3(
      input(goal()),
      () => undefined,
      async () => [{
        ...restaurant('osm_1', 'OSM寿司店', '日本料理', 300),
        source: 'osm',
      }]
    );

    expect(result.runtimeState?.observations?.[0]?.provider).toBe('osm');
  });

  it('continues with fallback search when clarification answer allows any recommendation', async () => {
    const first = await runSearchAgentV3(
      {
        query: '想吃健康点',
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
        query: '想吃便宜点',
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

  it('re-summarizes the goal and resets stale search state after a concrete clarification answer', async () => {
    const first = await runSearchAgentV3(
      input(goal({
        rawQuery: '想吃日料',
        requestedItems: [{ name: '日料', required: true, aliases: [] }],
        acceptableCategories: [],
        primaryKeywords: ['日料'],
      })),
      () => undefined,
      async () => []
    );

    expect(first.paused).toBe(true);
    expect(first.question?.question).toContain('日料');

    const searchedPlans: SearchPlan[] = [];
    const second = await runSearchAgentV3(
      {
        query: '火锅',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async (plan) => {
        searchedPlans.push(plan);
        return plan.keywords.includes('火锅')
          ? [restaurant('r1', '重庆火锅', '火锅', 500)]
          : [];
      }
    );

    expect(second.paused).not.toBe(true);
    expect(searchedPlans[0]).toEqual(expect.objectContaining({
      keywords: ['火锅'],
      searchIntent: 'exact',
    }));
    expect(second.restaurants.map((item) => item.name)).toEqual(['重庆火锅']);
    expect(second.runtimeState?.goal.primaryKeywords).toEqual(['火锅']);
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
          restaurant('r5', '深夜拉面', '日本料理', 650),
          restaurant('r6', '寿司专门店', '寿司', 800),
        ];
      }
    );

    expect(plans.map((plan) => plan.searchIntent)).toEqual(expect.arrayContaining(['exact', 'synonym']));
    expect(plans.filter((plan) => plan.searchIntent === 'synonym').map((plan) => plan.keywords[0]))
      .toEqual(expect.arrayContaining(['日本料理', '寿司']));
    expect(result.restaurants.length).toBeGreaterThan(3);
  });

  it('fans out broadened keyword targets with their own POI types', async () => {
    const plans: SearchPlan[] = [];
    const events: AgentEvent[] = [];
    const result = await runSearchAgentV3(
      input(goal({
        rawQuery: '允许放宽到日料、韩餐、东南亚菜',
        primaryKeywords: ['火星菜'],
        requestedItems: [{ name: '火星菜', required: true, aliases: [] }],
        acceptableCategories: [],
        broadenedKeywords: ['日料', '韩餐', '东南亚菜'],
        broadenedTargets: [
          { keyword: '日料', poiTypes: ['050202'], confidence: 0.9 },
          { keyword: '韩餐', poiTypes: ['050203'], confidence: 0.9 },
          { keyword: '东南亚菜', poiTypes: ['050206', '050217'], confidence: 0.8 },
        ],
        allowBroaden: true,
      })),
      (event) => events.push(event),
      async (plan) => {
        plans.push(plan);
        if (plan.keywords[0] === '东南亚菜') {
          return [restaurant('r1', '泰越小馆', '东南亚菜', 500)];
        }
        return [];
      }
    );

    expect(result.paused).not.toBe(true);
    expect(plans.map((plan) => [plan.keywords, plan.poiType])).toEqual([
      [['火星菜'], undefined],
      [['日料'], '050202'],
      [['韩餐'], '050203'],
      [['东南亚菜'], '050206|050217'],
    ]);
    expect(plans.some((plan) =>
      plan.keywords.length > 1 && plan.poiType === '050103|050104|050108'
    )).toBe(false);
    expect(events.some((event) =>
      event.type === 'tool_start'
      && (event.args as SearchPlan).keywords.join('|') === '日料|韩餐|东南亚菜'
    )).toBe(false);
  });

  it('keeps EvaluationAgent failures out of primary recommendations and records a structured trace', async () => {
    const evaluationMock = runEvaluationAgent as jest.Mock;
    const defaultImplementation = evaluationMock.getMockImplementation();
    evaluationMock.mockRejectedValue(new Error('429 too many requests'));

    try {
      const result = await runSearchAgentV3(
        input(goal()),
        () => undefined,
        async () => [restaurant('r1', '寿司店', '日本料理', 300)]
      );

      expect(result.paused).toBe(true);
      expect(result.restaurants).toEqual([]);
      expect(result.runtimeState?.candidates[0]).toEqual(expect.objectContaining({
        restaurant: expect.objectContaining({ id: 'r1' }),
        warnings: expect.arrayContaining([expect.stringContaining('未验证候补')]),
        verification: expect.objectContaining({
          status: 'unverified',
          primaryEligible: false,
        }),
      }));
      expect(result.runtimeState?.trace).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'evaluation',
          output: expect.objectContaining({ source: 'error' }),
          error: expect.objectContaining({
            code: 'EVALUATION_RATE_LIMITED',
            retryable: true,
          }),
        }),
      ]));
    } finally {
      if (defaultImplementation) {
        evaluationMock.mockImplementation(defaultImplementation);
      }
    }
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
    expect(first.question?.optionEffects?.['扩大范围']).toEqual(expect.objectContaining({
      allowBroaden: true,
      setDistanceMaxMeters: 5000,
      addAuthorizations: [
        expect.objectContaining({
          kind: 'distance_expansion',
          constraints: { maxMeters: 5000 },
        }),
      ],
    }));

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
