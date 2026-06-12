/**
 * 数据格式转换和合并工具
 */

import type { Restaurant } from '@/types';
import { logger } from './logger';
import { getRestaurantBrand } from './restaurantIdentity';

/**
 * 合并并过滤餐厅列表
 * - 去重（基于名称和位置）
 * - 按距离排序
 * - 限制返回数量
 */
export function combineAndFilterRestaurants(
  restaurants: Restaurant[],
  count: number = 8
): Restaurant[] {
  if (restaurants.length === 0) {
    return [];
  }

  logger.info('Combining and filtering restaurants', {
    inputCount: restaurants.length,
    targetCount: count,
  });

  // 去重：基于名称和大致位置（经纬度保留3位小数，约100米精度）
  const uniqueMap = new Map<string, Restaurant>();

  for (const restaurant of restaurants) {
    const key = `${restaurant.name}_${restaurant.location.lat.toFixed(3)}_${restaurant.location.lng.toFixed(3)}`;

    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, restaurant);
    } else {
      // 如果已存在，保留信息更完整的那个
      const existing = uniqueMap.get(key)!;
      if (shouldReplace(existing, restaurant)) {
        uniqueMap.set(key, restaurant);
      }
    }
  }

  // 转换为数组
  let unique = Array.from(uniqueMap.values());

  // 品牌级去重：同一品牌只保留信息最完整的一家
  const brandSeen = new Map<string, Restaurant>();
  for (const r of unique) {
    const brand = getRestaurantBrand(r);
    if (!brand) {
      brandSeen.set(`__noidx_${r.name}`, r);
      continue;
    }
    const existing = brandSeen.get(brand);
    if (!existing || shouldReplace(existing, r)) {
      brandSeen.set(brand, r);
    }
  }
  unique = Array.from(brandSeen.values());

  // 按距离排序
  unique.sort((a, b) => {
    const distA = a.distance ?? Infinity;
    const distB = b.distance ?? Infinity;
    return distA - distB;
  });

  // 限制数量
  if (unique.length > count) {
    unique = unique.slice(0, count);
  }

  logger.info('Filtering complete', {
    uniqueCount: unique.length,
    outputCount: unique.length,
  });

  return unique;
}

/**
 * 判断是否应该用新餐厅替换已存在的餐厅
 * 基于信息完整度
 */
function shouldReplace(existing: Restaurant, candidate: Restaurant): boolean {
  let existingScore = 0;
  let candidateScore = 0;

  // 评分标准
  if (existing.phone) existingScore += 1;
  if (existing.rating) existingScore += 1;
  if (existing.averagePrice) existingScore += 1;
  if (existing.openingHours) existingScore += 1;
  if (existing.address && existing.address !== '地址未知') existingScore += 1;

  if (candidate.phone) candidateScore += 1;
  if (candidate.rating) candidateScore += 1;
  if (candidate.averagePrice) candidateScore += 1;
  if (candidate.openingHours) candidateScore += 1;
  if (candidate.address && candidate.address !== '地址未知') candidateScore += 1;

  // 优先高德数据
  if (existing.source === 'amap' && candidate.source === 'osm') {
    candidateScore -= 1;
  } else if (existing.source === 'osm' && candidate.source === 'amap') {
    candidateScore += 1;
  }

  return candidateScore > existingScore;
}

/**
 * 过滤餐厅（仅价格过滤）
 */
export function filterRestaurants(
  restaurants: Restaurant[],
  options?: {
    priceRange?: { min?: number; max?: number };
  }
): Restaurant[] {
  if (!options?.priceRange) {
    return restaurants;
  }

  const filtered = restaurants.filter((r) => {
    if (!r.averagePrice) {
      return true;
    }

    const { min, max } = options.priceRange!;

    if (min !== undefined && r.averagePrice < min) {
      return false;
    }

    if (max !== undefined && r.averagePrice > max) {
      return false;
    }

    return true;
  });

  logger.info('Restaurants filtered by price', {
    beforeCount: restaurants.length,
    afterCount: filtered.length,
  });

  return filtered;
}
