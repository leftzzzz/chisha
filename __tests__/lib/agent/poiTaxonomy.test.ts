import {
  DEFAULT_POI_TYPE,
  expandPoiSearchKeywords,
  extractKnownFoodTerms,
  getPoiTerms,
  normalizeSearchKeywords,
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
    expect(resolvePoiTypesForKeyword('牛排', '050102', true)).toBe('050201|050211');
    expect(resolvePoiTypesForKeyword('私房菜', '050102', true)).toBe(DEFAULT_POI_TYPE);
    expect(resolvePoiTypesForKeyword('私房菜', '050102', false)).toBe('050102');
  });

  it('uses official Amap V1.06 food POI codes for foreign cuisines', () => {
    expect(resolvePoiTypesForKeyword('日料', undefined, false)).toBe('050202');
    expect(resolvePoiTypesForKeyword('韩餐', undefined, false)).toBe('050203');
    expect(resolvePoiTypesForKeyword('东南亚菜', undefined, false)).toBe('050206|050217');
  });

  it('uses official Amap V1.06 food POI codes for corrected Chinese categories', () => {
    expect(resolvePoiTypesForKeyword('湘菜', undefined, false)).toBe('050108');
    expect(resolvePoiTypesForKeyword('闽菜', undefined, false)).toBe('050110');
    expect(resolvePoiTypesForKeyword('徽菜', undefined, false)).toBe('050109');
    expect(resolvePoiTypesForKeyword('海鲜', undefined, false)).toBe('050119');
    expect(resolvePoiTypesForKeyword('素食', undefined, false)).toBe('050120');
    expect(resolvePoiTypesForKeyword('清真', undefined, false)).toBe('050121');
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

  it('expands cuisine keywords into related single-intent Amap keywords', () => {
    const expansion = expandPoiSearchKeywords(['日料']);

    expect(expansion.relatedKeywords).toEqual(expect.arrayContaining([
      '日本料理',
      '寿司',
      '刺身',
      '拉面',
    ]));
    expect(expansion.relatedKeywords).not.toContain('日料');
    expect(expansion.broadenedKeywords).toEqual(expect.arrayContaining(['亚洲料理']));
  });

  it('normalizes sentence-like or grouped keywords for Amap single-intent requests', () => {
    expect(normalizeSearchKeywords(['想吃牛排'])).toEqual(['牛排']);
    expect(normalizeSearchKeywords(['川菜|咖啡'])).toEqual(['川菜', '咖啡']);
    expect(normalizeSearchKeywords(['附近有什么吃的'])).toEqual(['餐厅']);
  });

  it('extracts known food terms without turning soft preferences into food targets', () => {
    expect(extractKnownFoodTerms('想吃日料或者韩餐')).toEqual(['日料', '韩餐']);
    expect(extractKnownFoodTerms('清淡一点')).toEqual([]);
  });
});
