import { applyVerdictGuard } from '@/lib/agent/guards';
import type { EvaluationAgentOutput, SearchPlan, UserGoal } from '@/lib/agent/types';
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

describe('Runtime verdict guard', () => {
  it('corrects failed LLM verdicts when deterministic facts support the exact request', () => {
    const evaluation: EvaluationAgentOutput = {
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

    expect(guarded.selectedIds).toEqual(['r1']);
    expect(guarded.verdicts[0]).toEqual(expect.objectContaining({
      status: 'passed',
      primaryEligible: true,
      matchedItems: ['牛排'],
      matchedCategories: ['西餐'],
      conflicts: [],
    }));
  });

  it('fills missing verdicts from deterministic evaluation', () => {
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

    expect(guarded.selectedIds).toEqual(['r1']);
    expect(guarded.verdicts).toHaveLength(1);
  });

  it('does not fill missing verdicts past hard constraints', () => {
    const guarded = applyVerdictGuard(
      {
        verdicts: [],
        selectedIds: [],
        candidateIds: [],
        explanation: '模型未返回候选。',
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
