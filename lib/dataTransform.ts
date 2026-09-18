/**
 * 数据格式转换和合并工具
 */

import type { Restaurant } from '@/types';
import { logger } from './logger';
import { getRestaurantIdentityKeys } from './restaurantIdentity';

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

  const identityMap = new Map<string, number>();
  let unique: Restaurant[] = [];

  for (const restaurant of restaurants) {
    const keys = getRestaurantIdentityKeys(restaurant);
    const existingIndex = keys
      .map((key) => identityMap.get(key))
      .find((index) => index !== undefined);
    if (existingIndex === undefined) {
      keys.forEach((key) => identityMap.set(key, unique.length));
      unique.push(restaurant);
      continue;
    }

    const existing = unique[existingIndex];
    if (shouldReplace(existing, restaurant)) {
      unique[existingIndex] = restaurant;
    }
    keys.forEach((key) => identityMap.set(key, existingIndex));
  }

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
