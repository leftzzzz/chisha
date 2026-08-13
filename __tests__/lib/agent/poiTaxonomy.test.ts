import {
  DEFAULT_POI_TYPE,
  expandPoiSearchKeywords,
  extractKnownFoodTerms,
  getPoiTerms,
  normalizeSearchKeywords,
  resolvePoiTypesForKeyword,
} from '@/lib/agent/poiTaxonomy';

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
    expect(resolvePoiTypesForKeyword('亚洲料理', undefined, false)).toBe('050217');
  });

  it('uses official Amap V1.06 food POI codes for corrected Chinese categories', () => {
    expect(resolvePoiTypesForKeyword('湘菜', undefined, false)).toBe('050108');
    expect(resolvePoiTypesForKeyword('闽菜', undefined, false)).toBe('050110');
    expect(resolvePoiTypesForKeyword('徽菜', undefined, false)).toBe('050109');
    expect(resolvePoiTypesForKeyword('海鲜', undefined, false)).toBe('050119');
    expect(resolvePoiTypesForKeyword('素食', undefined, false)).toBe('050120');
    expect(resolvePoiTypesForKeyword('清真', undefined, false)).toBe('050121');
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
    expect(expansion.broadenedKeywords).toEqual(expect.arrayContaining([
      '亚洲料理',
      '韩国料理',
      '东南亚菜',
    ]));
  });

  it('normalizes sentence-like or grouped keywords for Amap single-intent requests', () => {
    expect(normalizeSearchKeywords(['想吃牛排'])).toEqual(['牛排']);
    expect(normalizeSearchKeywords(['川菜|咖啡'])).toEqual(['川菜', '咖啡']);
    expect(normalizeSearchKeywords(['附近有什么吃的'])).toEqual(['餐厅']);
  });

  it('does not convert open-intent authorization words into generic restaurant searches', () => {
    expect(normalizeSearchKeywords(['随便'])).toEqual(['随便']);
    expect(normalizeSearchKeywords(['都行'])).toEqual(['都行']);
  });

  it('extracts known food terms without turning soft preferences into food targets', () => {
    expect(extractKnownFoodTerms('想吃日料或者韩餐')).toEqual(['日料', '韩餐']);
    expect(extractKnownFoodTerms('清淡一点')).toEqual([]);
  });
});
