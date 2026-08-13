/**
 * 用真实 POI 数据生成追问选项。
 *
 * 为什么需要它：第一轮追问时 Supervisor 手里没有任何附近信息（attempts 为空），
 * 它只能从自己 prompt 的例子里挑词——线上实测三次追问全是「火锅/日料/川菜/
 * 西餐」。给模型加规则治不了这个，因为它缺的是数据不是纪律。
 *
 * 这里不做语义理解，只做事实呈现：高德每个 POI 都带 poiTypeCode，
 * 按品类聚合出"附近实际有什么"，选项就编不出附近没有的东西。
 */

import type { Restaurant } from '@/types';
import { getAmapFoodPoiType } from './amapPoiTypeCatalog';
import { CLARIFICATION_OPTION, clarificationOption } from './clarificationOptions';
import { extractKnownFoodTerms, isGenericSearchKeyword } from './poiTaxonomy';
import type { ClarificationEffect, PendingQuestion } from './types';

export interface NearbyCategory {
  /** 可直接用于高德 keywords 的品类词 */
  keyword: string;
  /** 附近该品类的 POI 数量 */
  count: number;
}

const MIN_CATEGORIES_FOR_OPTIONS = 2;
const MAX_CATEGORY_OPTIONS = 4;

/**
 * 按品类聚合附近 POI。
 *
 * 品类词的来源优先级：POI typecode 的细分名 > typecode 的中类名 > cuisineType。
 * 三者都归一化到 POI_TAXONOMY 的规范词，保证选中后能直接拿去搜。
 */
export function summarizeNearbyCategories(
  restaurants: Restaurant[],
  limit = MAX_CATEGORY_OPTIONS
): NearbyCategory[] {
  const counts = new Map<string, number>();

  for (const restaurant of restaurants) {
    const keyword = resolveCategoryKeyword(restaurant);
    if (!keyword) {
      continue;
    }

    counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((left, right) => right.count - left.count || left.keyword.localeCompare(right.keyword))
    .slice(0, limit);
}

function resolveCategoryKeyword(restaurant: Restaurant): string | undefined {
  const poiType = restaurant.poiTypeCode
    ? getAmapFoodPoiType(restaurant.poiTypeCode)
    : undefined;

  const sources = [poiType?.sub, poiType?.mid, restaurant.cuisineType].filter(
    (value): value is string => Boolean(value)
  );

  for (const source of sources) {
    const [term] = extractKnownFoodTerms(source);
    if (term && !isGenericSearchKeyword(term)) {
      return term;
    }
  }

  return undefined;
}

/**
 * 把品类分布做成追问。
 *
 * 每个选项都带确定性 effect（选中即把该品类写进目标），再加一个"随便推荐"
 * 出口。选项一律不需要模型再判断一次。
 *
 * @returns 附近品类少于 2 类时返回 null，调用方应保留原来的追问
 */
export function buildNearbyCategoryQuestion(
  categories: NearbyCategory[],
  fallbackEffect: ClarificationEffect
): PendingQuestion | null {
  if (categories.length < MIN_CATEGORIES_FOR_OPTIONS) {
    return null;
  }

  const options = categories.map((category, index) => ({
    id: `nearby_${index + 1}`,
    label: `${category.keyword} ${category.count}家`,
  }));
  const optionEffects: Record<string, ClarificationEffect> = {};

  categories.forEach((category, index) => {
    optionEffects[`nearby_${index + 1}`] = {
      replaceCategories: [category.keyword],
      replacePrimaryKeywords: [category.keyword],
    };
  });
  optionEffects[CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY] = fallbackEffect;

  return {
    reason: '已按附近实际的餐厅品类分布生成选项。',
    question: `附近主要有这些，想吃哪类？也可以直接说具体想吃的菜。`,
    options: [
      ...options,
      clarificationOption(CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY),
    ],
    allowFreeText: true,
    optionEffects,
  };
}
