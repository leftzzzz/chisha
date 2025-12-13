/**
 * OpenStreetMap Overpass API 调用封装
 * 用于高德地图搜索失败时的降级方案
 */

import type { Location, Restaurant } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { fetchWithTimeout } from './withTimeout';
import { haversineDistance } from './distance';
import { ErrorCode } from './apiResponse';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OSM_TIMEOUT = 15000; // 15 秒超时

/**
 * OSM Overpass API 响应类型
 */
interface OverpassResponse {
  version: number;
  generator: string;
  elements: OverpassElement[];
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: {
    name?: string;
    'name:zh'?: string;
    amenity?: string;
    cuisine?: string;
    'addr:full'?: string;
    'addr:street'?: string;
    'addr:housenumber'?: string;
    phone?: string;
    opening_hours?: string;
    [key: string]: string | undefined;
  };
  center?: {
    lat: number;
    lon: number;
  };
}

/**
 * 构建 Overpass QL 查询语句
 */
function buildOverpassQuery(
  keywords: string[],
  location: Location,
  distance: number
): string {
  // 转换半径为度数（粗略估算）
  const radiusInDegrees = distance / 111000; // 1度约等于111km

  // 计算边界框
  const south = location.lat - radiusInDegrees;
  const north = location.lat + radiusInDegrees;
  const west = location.lng - radiusInDegrees;
  const east = location.lng + radiusInDegrees;

  // 构建查询
  // 查询餐厅相关的 amenity 标签
  const query = `
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](${south},${west},${north},${east});
      node["amenity"="fast_food"](${south},${west},${north},${east});
      node["amenity"="cafe"](${south},${west},${north},${east});
      node["amenity"="food_court"](${south},${west},${north},${east});
      way["amenity"="restaurant"](${south},${west},${north},${east});
      way["amenity"="fast_food"](${south},${west},${north},${east});
      way["amenity"="cafe"](${south},${west},${north},${east});
    );
    out center;
  `;

  return query;
}

/**
 * 使用 OpenStreetMap Overpass API 搜索餐厅
 */
export async function osmSearch(
  keywords: string[],
  location: Location,
  distance: number = 2000
): Promise<Restaurant[]> {
  const query = buildOverpassQuery(keywords, location, distance);

  logger.info('Calling OSM Overpass API', {
    keywords,
    location,
    distance,
  });

  try {
    const response = await fetchWithTimeout(
      OVERPASS_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
      },
      OSM_TIMEOUT
    );

    if (!response.ok) {
      throw new ApiError(
        ErrorCode.SEARCH_API_ERROR,
        `OSM API error: ${response.status}`
      );
    }

    const data: OverpassResponse = await response.json();

    if (!data.elements || data.elements.length === 0) {
      logger.info('OSM search returned no results');
      return [];
    }

    logger.info('OSM search successful', { count: data.elements.length });

    // 转换为统一格式
    const restaurants = data.elements
      .map((element) => transformOsmElement(element, location))
      .filter((r): r is Restaurant => r !== null);

    // 过滤距离并排序
    const filtered = restaurants
      .filter((r) => {
        if (r.distance === undefined) return true;
        return r.distance <= distance;
      })
      .sort((a, b) => {
        const distA = a.distance ?? Infinity;
        const distB = b.distance ?? Infinity;
        return distA - distB;
      });

    return filtered;
  } catch (error) {
    logger.error('OSM search failed', { error });
    throw error;
  }
}

/**
 * 将 OSM Element 转换为 Restaurant 格式
 */
function transformOsmElement(
  element: OverpassElement,
  searchLocation: Location
): Restaurant | null {
  const tags = element.tags;
  if (!tags || !tags.name) {
    return null;
  }

  // 获取坐标
  let lat: number;
  let lng: number;

  if (element.type === 'node' && element.lat && element.lon) {
    lat = element.lat;
    lng = element.lon;
  } else if (element.center) {
    lat = element.center.lat;
    lng = element.center.lon;
  } else {
    return null;
  }

  // 计算距离
  const distance = haversineDistance(
    searchLocation.lat,
    searchLocation.lng,
    lat,
    lng
  );

  // 提取菜系类型
  let cuisineType = '餐饮';
  if (tags.cuisine) {
    cuisineType = tags.cuisine;
  } else if (tags.amenity === 'fast_food') {
    cuisineType = '快餐';
  } else if (tags.amenity === 'cafe') {
    cuisineType = '咖啡厅';
  }

  // 构建地址
  let address = tags['addr:full'] || '';
  if (!address && tags['addr:street']) {
    address = tags['addr:street'];
    if (tags['addr:housenumber']) {
      address += ' ' + tags['addr:housenumber'];
    }
  }
  if (!address) {
    address = '地址未知';
  }

  return {
    id: `osm_${element.type}_${element.id}`,
    name: tags['name:zh'] || tags.name,
    cuisineType,
    distance,
    address,
    phone: tags.phone,
    openingHours: tags.opening_hours,
    location: { lat, lng },
    source: 'osm',
  };
}
