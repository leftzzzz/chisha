import { applyVerdictGuard, validateSearchPlan } from '@/lib/agent/guards';
import type {
  EvaluationModelOutput,
  PolicyContext,
  SearchPlan,
  UserGoal,
} from '@/lib/agent/types';
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

describe('SearchAction authorization guard', () => {
  it('rejects a tampered primary flag when Runtime derivation fails closed', () => {
    const scopedGoal = goal({ goalId: 'goal_1' });
    const plan: SearchPlan = {
      keywords: ['日本料理'],
      radiusMeters: 1800,
      searchIntent: 'broadened',
      allowedForPrimary: true,
      reason: '扩大到日本料理。',
      searchAction: {
        id: 'action_1',
        query: '日本料理',
        supportsGoalIds: ['goal_1'],
        relation: 'broader',
        rationale: '扩大到日本料理。',
      },
    };
    const context: PolicyContext = {
      goal: scopedGoal,
      attempts: [],
      candidates: [],
      location,
      targetCount: 8,
      maxSearchCalls: 4,
    };

    expect(validateSearchPlan(plan, context)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNAUTHORIZED_BROADENING' }),
    ]));
  });
});

describe('Runtime verdict guard', () => {
  it('does not correct failed Agent verdicts with deterministic semantic matching', () => {
    const evaluation: EvaluationModelOutput = {
      verdicts: [{
        restaurantId: 'r1',
        status: 'failed',
        primaryEligible: false,
        confidence: 0.2,
        matchedItems: [],
        matchedCategories: [],
        conflicts: ['未验证到明确菜品「牛排」。'],
        evidence: [],
        warnings: [],
      }],
      selectedIds: [],
      candidateIds: [],
      explanation: '没有找到通过语义验证的主推荐。',
      unmetConstraints: ['未验证到明确菜品「牛排」。'],
    };

    const guarded = applyVerdictGuard(
      evaluation,
      [restaurant('r1', '社区西餐厅', '西餐厅', 300)],
      goal(),
      exactPlan,
      8
    ).output;

    expect(guarded.selectedIds).toEqual([]);
    expect(guarded.verdicts[0]).toEqual(expect.objectContaining({
      status: 'failed',
      primaryEligible: false,
      matchedItems: [],
      matchedCategories: [],
      conflicts: ['未验证到明确菜品「牛排」。'],
    }));
  });

  it('does not fill missing verdicts from deterministic evaluation', () => {
    const guarded = applyVerdictGuard(
      {
        verdicts: [],
        selectedIds: [],
        candidateIds: [],
        explanation: '模型未返回候选。',
        unmetConstraints: [],
      },
      [restaurant('r1', '社区西餐厅', '西餐厅', 300)],
      goal(),
      exactPlan,
      8
    ).output;

    expect(guarded.selectedIds).toEqual([]);
    expect(guarded.verdicts).toHaveLength(0);
  });

  it('keeps Agent verdicts from passing hard constraints', () => {
    const guarded = applyVerdictGuard(
      {
        verdicts: [{
          restaurantId: 'r1',
          status: 'passed',
          primaryEligible: true,
          confidence: 0.9,
          matchedItems: ['牛排'],
          matchedCategories: ['西餐'],
          conflicts: [],
          evidence: ['Agent 判断符合牛排需求。'],
          warnings: [],
        }],
        selectedIds: ['r1'],
        candidateIds: [],
        explanation: 'Agent 判断通过。',
        unmetConstraints: [],
      },
      [restaurant('r1', '社区西餐厅', '西餐厅', 1200)],
      goal({
        hardConstraints: [{
          kind: 'distance',
          label: '500米内',
          value: 500,
          maxMeters: 500,
          strict: true,
        }],
      }),
      exactPlan,
      8
    ).output;

    expect(guarded.selectedIds).toEqual([]);
    expect(guarded.verdicts[0]).toEqual(expect.objectContaining({
      status: 'failed',
      primaryEligible: false,
    }));
  });
});
