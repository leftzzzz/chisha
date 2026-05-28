import {
  DEFAULT_POI_TYPE,
  getPoiTerms,
  resolvePlansWithPoiTaxonomy,
  resolvePoiTypesForKeyword,
} from '@/lib/agent/poiTaxonomy';
import type { PlanningAgentOutput, UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃牛排',
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
    clarificationNeeded: [],
    allowBroaden: false,
    ...overrides,
  };
}

describe('poiTaxonomy', () => {
  it('resolves keyword-specific Amap POI types without using caller fallback for multi-keyword plans', () => {
    expect(resolvePoiTypesForKeyword('牛排', '050102', true)).toBe('050203');
    expect(resolvePoiTypesForKeyword('私房菜', '050102', true)).toBe(DEFAULT_POI_TYPE);
    expect(resolvePoiTypesForKeyword('私房菜', '050102', false)).toBe('050102');
  });

  it('keeps alternative targets together when resolving PlanningAgent output', () => {
    const planningOutput: PlanningAgentOutput = {
      plans: [{
        targets: [
          { label: '日料', kind: 'cuisine', strictness: 'exact' },
          { label: '韩餐', kind: 'cuisine', strictness: 'exact' },
        ],
        radiusMeters: 1800,
        searchIntent: 'exact',
        allowedForPrimary: true,
        reason: '搜索任一可接受品类。',
      }],
    };

    const [plan] = resolvePlansWithPoiTaxonomy(planningOutput, goal());

    expect(plan.keywords).toEqual(['日料', '韩餐']);
    expect(plan.poiType).toBeUndefined();
  });

  it('exposes canonical terms for semantic agents without duplicating tables', () => {
    expect(getPoiTerms('日料')).toEqual(expect.arrayContaining(['日本料理', '寿司']));
  });
});
