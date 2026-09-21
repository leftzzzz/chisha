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
    jest.dontMock('@/lib/agent/models/goalUnderstandingModel');
    jest.resetModules();
  });

  it('evaluates candidate evidence without narrowing retrieval by Amap POI type', async () => {
    jest.doMock('@/lib/agent/models/goalUnderstandingModel', () => {
      const actual = jest.requireActual('@/lib/agent/models/goalUnderstandingModel');
      return {
        ...actual,
        runGoalUnderstandingModel: jest.fn(async (
          supervisorInput: { previousGoal?: UserGoal; goal?: UserGoal; limits?: unknown },
          context?: import('@/lib/agent/types').AgentContext
        ) => {
          if (supervisorInput.goal && supervisorInput.limits) {
            return actual.runGoalUnderstandingModel(supervisorInput, context);
          }

          return {
            goal: supervisorInput.previousGoal,
            nextAction: 'plan',
          };
        }),
      };
    });
    jest.doMock('@/lib/agent/models/evaluationModel', () => ({
      runEvaluationModel: jest.fn(async (evaluationInput: {
        plan: SearchPlan;
        restaurants: Restaurant[];
        targetCount: number;
      }) => {
        const acceptableNames = new Set(['港式奶茶铺']);
        const verdicts = evaluationInput.restaurants.map((item) => {
          const accepted = acceptableNames.has(item.name);

          return {
            restaurantId: item.id,
            status: accepted ? 'passed' : 'failed',
            primaryEligible: accepted && evaluationInput.plan.allowedForPrimary,
            confidence: accepted ? 0.9 : 0.2,
            matchedItems: accepted ? ['港式奶茶'] : [],
            targetEvidence: accepted ? [{
              target: '港式奶茶', kind: 'item',
              verdict: 'supported',
              references: [{ restaurantId: item.id, field: 'name', value: item.name }],
            }] : [],
            matchedCategories: accepted ? ['奶茶'] : [],
            conflicts: accepted ? [] : ['Agent 语义验证未通过。'],
            evidence: accepted ? ['Agent 验证为港式奶茶相关候选。'] : [],
            warnings: [],
          };
        });
        const selectedIds = verdicts
          .filter((verdict) => verdict.status === 'passed' && verdict.primaryEligible)
          .slice(0, evaluationInput.targetCount)
          .map((verdict) => verdict.restaurantId);

        return {
          verdicts,
          selectedIds,
          candidateIds: [],
          explanation: 'Agent mock evaluation.',
          unmetConstraints: verdicts.flatMap((verdict) => verdict.conflicts),
        };
      }),
    }));

    const { runSearchAgentV3 } = await import('@/lib/agent/orchestrator/runtime');
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
      keywords: ['港奶'],
      poiType: undefined,
    }));
    expect(result.restaurants.map((item) => item.name)).toEqual(['港式奶茶铺']);
    expect(result.candidates.map((item) => item.name)).not.toContain('椰子鸡');
  });
});
