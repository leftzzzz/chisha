/**
 * 追问选项必须来自真实 POI 数据。
 *
 * 线上实测：模型在第一轮追问时手里没有任何附近信息，三次都复述自己
 * prompt 里的例子（火锅/日料/川菜/西餐）。这组用例锁住"选项由数据决定"。
 */

import {
  buildNearbyCategoryQuestion,
  summarizeNearbyCategories,
} from '@/lib/agent/nearbyCategories';
import { buildFallbackPrimaryEffect } from '@/lib/agent/orchestrator/policy';
import type { Restaurant } from '@/types';

const location = { lat: 30.2794, lng: 120.1305 };

function restaurant(
  id: string,
  cuisineType: string,
  poiTypeCode?: string
): Restaurant {
  return {
    id,
    name: `${id}店`,
    cuisineType,
    address: '测试地址',
    distance: 300,
    location,
    source: 'amap',
    poiTypeCode,
  };
}

describe('附近品类聚合', () => {
  it('counts categories from the Amap poi typecode', () => {
    const categories = summarizeNearbyCategories([
      restaurant('a', '火锅店', '050117'),
      restaurant('b', '火锅店', '050117'),
      restaurant('c', '日本料理', '050202'),
      restaurant('d', '海鲜酒楼', '050119'),
    ]);

    expect(categories).toEqual([
      { keyword: '火锅', count: 2 },
      { keyword: '日本料理', count: 1 },
      { keyword: '海鲜', count: 1 },
    ]);
  });

  it('falls back to the cuisine text when the typecode is unknown', () => {
    const categories = summarizeNearbyCategories([
      restaurant('a', '烧烤'),
      restaurant('b', '烧烤'),
    ]);

    expect(categories).toEqual([{ keyword: '烧烤', count: 2 }]);
  });

  it('drops generic categories that cannot narrow the search', () => {
    // 「餐厅」「美食」这类通用词当选项没有意义——点了等于没选。
    const categories = summarizeNearbyCategories([
      restaurant('a', '餐厅'),
      restaurant('b', '美食'),
    ]);

    expect(categories).toEqual([]);
  });
});

describe('按品类分布构造追问', () => {
  it('builds deterministic options with counts and effects', () => {
    const question = buildNearbyCategoryQuestion(
      [
        { keyword: '火锅', count: 12 },
        { keyword: '日本料理', count: 5 },
      ],
      buildFallbackPrimaryEffect()
    );

    expect(question?.options?.map((option) => option.label)).toEqual([
      '火锅 12家',
      '日本料理 5家',
      '随便推荐',
    ]);
    // 每个品类选项都能确定性执行，不必再回模型判断一次。
    expect(question?.optionEffects?.nearby_1?.replacePrimaryKeywords).toEqual(['火锅']);
    expect(question?.optionEffects?.nearby_2?.replaceCategories).toEqual(['日本料理']);
    expect(question?.optionEffects?.authorize_fallback_primary?.allowBroaden).toBe(true);
    expect(question?.allowFreeText).toBe(true);
  });

  it('keeps the original question when nearby data is too thin', () => {
    expect(buildNearbyCategoryQuestion([{ keyword: '火锅', count: 1 }], buildFallbackPrimaryEffect()))
      .toBeNull();
    expect(buildNearbyCategoryQuestion([], buildFallbackPrimaryEffect())).toBeNull();
  });
});
