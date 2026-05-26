/**
 * 高德地图 API 调用封装
 */

import type { Location, Restaurant } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { fetchWithTimeout } from './withTimeout';
import { ErrorCode } from './apiResponse';
import { osmReverseGeocode } from './osm';

const AMAP_API_KEY = process.env.AMAP_API_KEY;
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE;
const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const AMAP_TIMEOUT = 10000; // 10 秒超时

// 高德 POI 类型映射（餐饮服务相关）
const DEFAULT_POI_TYPE = '050000'; // 餐饮服务（最宽泛的餐饮大类）

/**
 * 高德 API 响应类型
 */
interface AmapPoiResponse {
  status: string;
  count: string;
  info: string;
  infocode: string;
  pois?: AmapPoi[];
}

interface AmapPoi {
  id: string;
  name: string;
  type: string;
  typecode: string;
  address: string;
  location: string; // 格式: "lng,lat"
  tel?: string;
  distance?: string;
  business_area?: string;
  tag?: string;
  photos?: Array<{ url: string }>;
  biz_ext?: {
    rating?: string;
    cost?: string;
    opentime?: string;
    opentime2?: string;
    opentime_week?: string;
    business_status?: string;
  };
  rating?: string;
  cost?: string;
  opentime?: string;
  opentime_week?: string;
  business_status?: string;
}

/**
 * 调用高德地图 POI 搜索 API
 * @param keywords 搜索关键词数组
 * @param location 搜索中心点
 * @param distance 搜索半径（米）
 * @param poiType 高德 POI 类型代码（可选，由 LLM 决定）
 * @returns 餐厅列表
 */
export async function amapPoiSearch(
  keywords: string[],
  location: Location,
  distance: number = 2000,
  poiType?: string
): Promise<Restaurant[]> {
  // 检查 API Key
  if (!AMAP_API_KEY) {
    logger.error('Missing Amap API Key');
    throw new ApiError(
      ErrorCode.MISSING_API_KEY,
      'Amap API key is not configured'
    );
  }

  // 合并关键词
  const keyword = keywords.join('|');

  // 使用 LLM 提供的 poiType，如果没有则使用默认的餐饮大类
  const finalPoiType = poiType || DEFAULT_POI_TYPE;

  // 构建请求参数
  const params = new URLSearchParams({
    key: AMAP_API_KEY,
    keywords: keyword,
    types: finalPoiType,
    location: `${location.lng},${location.lat}`,
    radius: distance.toString(),
    sortrule: 'distance', // 按距离排序
    offset: '20', // 每页数量
    page: '1',
    extensions: 'all', // 返回详细信息
  });

  // 添加安全码（如果配置了）
  if (AMAP_SECURITY_CODE) {
    params.append('sig', AMAP_SECURITY_CODE);
  }

  const url = `${AMAP_BASE_URL}/place/around?${params.toString()}`;

  logger.info('Calling Amap POI search', {
    keywords,
    poiType: finalPoiType,
    poiTypeSource: poiType ? 'llm' : 'default',
    location,
    distance,
  });

  try {
    const response = await fetchWithTimeout(url, {}, AMAP_TIMEOUT);

    if (!response.ok) {
      throw new ApiError(
        ErrorCode.SEARCH_API_ERROR,
        `Amap API error: ${response.status}`
      );
    }

    const data: AmapPoiResponse = await response.json();

    // 检查响应状态
    if (data.status !== '1') {
      logger.warn('Amap API returned error', {
        info: data.info,
        infocode: data.infocode,
      });
      throw new ApiError(
        ErrorCode.SEARCH_API_ERROR,
        `Amap API error: ${data.info}`
      );
    }

    // 检查结果
    if (!data.pois || data.pois.length === 0) {
      logger.info('Amap search returned no results');
      return [];
    }

    logger.info('Amap search successful', { count: data.pois.length });

    // 转换为统一格式（由 dataTransform 处理）
    return data.pois.map((poi) => transformAmapPoi(poi));
  } catch (error) {
    logger.error('Amap search failed', { error });
    throw error;
  }
}

/**
 * 使用高德 POI 详情接口补全评分、人均、营业时间等字段。
 * 详情接口失败时不影响主搜索结果。
 */
export async function enrichRestaurantsWithAmapDetails(
  restaurants: Restaurant[],
  limit: number = 10
): Promise<Restaurant[]> {
  if (!AMAP_API_KEY || restaurants.length === 0) {
    return restaurants;
  }

  const enrichedRestaurants = [...restaurants];
  const detailTargets = restaurants
    .slice(0, limit)
    .map((restaurant, index) => ({
      index,
      amapId: restaurant.id.startsWith('amap_') ? restaurant.id.slice(5) : '',
    }))
    .filter((target) => target.amapId.length > 0);

  await Promise.all(detailTargets.map(async (target) => {
    try {
      const detail = await amapPoiDetail(target.amapId);
      if (detail) {
        enrichedRestaurants[target.index] = {
          ...enrichedRestaurants[target.index],
          ...detail,
          id: enrichedRestaurants[target.index].id,
          distance: enrichedRestaurants[target.index].distance,
        };
      }
    } catch (error) {
      logger.warn('Amap detail enrichment failed', {
        amapId: target.amapId,
        error,
      });
    }
  }));

  return enrichedRestaurants;
}

async function amapPoiDetail(amapId: string): Promise<Restaurant | null> {
  const params = new URLSearchParams({
    key: AMAP_API_KEY!,
    id: amapId,
    extensions: 'all',
  });

  const url = `${AMAP_BASE_URL}/place/detail?${params.toString()}`;
  const response = await fetchWithTimeout(url, {}, AMAP_TIMEOUT);

  if (!response.ok) {
    throw new ApiError(
      ErrorCode.SEARCH_API_ERROR,
      `Amap detail API error: ${response.status}`
    );
  }

  const data: AmapPoiResponse = await response.json();
  if (data.status !== '1' || !data.pois || data.pois.length === 0) {
    return null;
  }

  return transformAmapPoi(data.pois[0]);
}

/**
 * 将高德 POI 转换为统一的 Restaurant 格式
 */
function transformAmapPoi(poi: AmapPoi): Restaurant {
  // 解析经纬度
  const [lng, lat] = poi.location.split(',').map(Number);

  // 提取菜系类型（从 type 或 tag 中提取）
  let cuisineType = '餐饮';
  if (poi.type) {
    // type 格式如: "餐饮服务;中餐厅;川菜馆"
    const types = poi.type.split(';');
    cuisineType = types[types.length - 1] || types[1] || '餐饮';
  }

  return {
    id: `amap_${poi.id}`,
    name: poi.name,
    cuisineType,
    rating: parseOptionalNumber(poi.biz_ext?.rating ?? poi.rating),
    distance: poi.distance ? parseInt(poi.distance, 10) : undefined,
    address: poi.address,
    phone: poi.tel,
    openingHours: pickOpeningHours(poi),
    averagePrice: parseOptionalNumber(poi.biz_ext?.cost ?? poi.cost),
    businessStatus: parseBusinessStatus(poi.biz_ext?.business_status ?? poi.business_status),
    location: { lat, lng },
    source: 'amap',
  };
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value || value === '[]') {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function pickOpeningHours(poi: AmapPoi): string | undefined {
  return firstNonEmpty([
    poi.biz_ext?.opentime_week,
    poi.biz_ext?.opentime2,
    poi.biz_ext?.opentime,
    poi.opentime_week,
    poi.opentime,
  ]);
}

function parseBusinessStatus(value?: string): Restaurant['businessStatus'] | undefined {
  if (!value || value === '[]') {
    return undefined;
  }

  if (/休息|关闭|闭店|暂停|停业|打烊/.test(value)) {
    return 'closed';
  }

  if (/营业|开门|open/i.test(value)) {
    return 'open';
  }

  return 'unknown';
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value && value !== '[]'));
}

/**
 * 地理编码：地址转坐标
 */
export async function amapGeocode(
  address: string,
  city?: string
): Promise<Location> {
  if (!AMAP_API_KEY) {
    throw new ApiError(
      ErrorCode.MISSING_API_KEY,
      'Amap API key is not configured'
    );
  }

  const params = new URLSearchParams({
    key: AMAP_API_KEY,
    address,
  });

  if (city) {
    params.append('city', city);
  }

  const url = `${AMAP_BASE_URL}/geocode/geo?${params.toString()}`;

  logger.info('Calling Amap geocode', { address, city });

  try {
    const response = await fetchWithTimeout(url, {}, AMAP_TIMEOUT);

    if (!response.ok) {
      throw new ApiError(
        ErrorCode.GEOCODE_ERROR,
        `Amap API error: ${response.status}`
      );
    }

    const data = await response.json();

    if (data.status !== '1' || !data.geocodes || data.geocodes.length === 0) {
      throw new ApiError(
        ErrorCode.GEOCODE_NO_RESULTS,
        'No geocoding results found'
      );
    }

    const geocode = data.geocodes[0];
    const [lng, lat] = geocode.location.split(',').map(Number);

    return {
      lat,
      lng,
      address: geocode.formatted_address,
    };
  } catch (error) {
    logger.error('Amap geocode failed', { error });
    throw error;
  }
}

/**
 * 逆向地理编码：坐标转地址（仅调用高德地图）
 */
async function amapReverseGeocodeOnly(location: Location): Promise<{
  address: string;
  formattedAddress?: string;
  province?: string;
  city?: string;
  district?: string;
}> {
  if (!AMAP_API_KEY) {
    throw new ApiError(
      ErrorCode.MISSING_API_KEY,
      'Amap API key is not configured'
    );
  }

  const params = new URLSearchParams({
    key: AMAP_API_KEY,
    location: `${location.lng},${location.lat}`,
  });

  const url = `${AMAP_BASE_URL}/geocode/regeo?${params.toString()}`;

  logger.info('Calling Amap reverse geocode', { location });

  try {
    const response = await fetchWithTimeout(url, {}, AMAP_TIMEOUT);

    if (!response.ok) {
      throw new ApiError(
        ErrorCode.GEOCODE_ERROR,
        `Amap API error: ${response.status}`
      );
    }

    const data = await response.json();

    logger.info('Amap reverse geocode response', {
      status: data.status,
      hasRegeocode: !!data.regeocode,
      regeocode: data.regeocode,
    });

    if (data.status !== '1' || !data.regeocode) {
      throw new ApiError(
        ErrorCode.GEOCODE_NO_RESULTS,
        'No reverse geocoding results found from Amap'
      );
    }

    const regeocode = data.regeocode;
    const addressComponent = regeocode.addressComponent;
    let formattedAddress = regeocode.formatted_address;

    // 如果 formatted_address 是数组，取第一个元素
    if (Array.isArray(formattedAddress)) {
      formattedAddress = formattedAddress[0] || null;
    }

    // 验证 formatted_address 存在且非空
    const isValidAddress =
      typeof formattedAddress === 'string' &&
      formattedAddress.trim().length > 0;

    if (!isValidAddress) {
      logger.warn('Amap reverse geocode returned invalid formatted_address', {
        location,
        formattedAddress,
        type: typeof formattedAddress,
      });
      throw new ApiError(
        ErrorCode.GEOCODE_NO_RESULTS,
        'No address information found for this location'
      );
    }

    return {
      address: formattedAddress,
      formattedAddress: formattedAddress,
      province: addressComponent?.province,
      city: addressComponent?.city,
      district: addressComponent?.district,
    };
  } catch (error) {
    logger.error('Amap reverse geocode failed', { error });
    throw error;
  }
}

/**
 * 逆向地理编码：坐标转地址（带 OSM 降级方案）
 * 优先使用高德地图，失败则降级到 OSM Nominatim
 * 最后降级到坐标格式化地址
 */
export async function amapReverseGeocode(location: Location): Promise<{
  address: string;
  formattedAddress?: string;
  province?: string;
  city?: string;
  district?: string;
}> {
  try {
    // 优先使用高德地图
    return await amapReverseGeocodeOnly(location);
  } catch (amapError) {
    logger.warn('Amap reverse geocode failed, falling back to OSM Nominatim', {
      error: amapError instanceof Error ? amapError.message : String(amapError),
    });

    try {
      // 降级到 OSM Nominatim
      const osmResult = await osmReverseGeocode(location);
      logger.info('OSM Nominatim reverse geocode successful', {
        address: osmResult.address,
      });
      return osmResult;
    } catch (osmError) {
      logger.warn('OSM Nominatim reverse geocode also failed, using fallback coordinate format', {
        amapError: amapError instanceof Error ? amapError.message : String(amapError),
        osmError: osmError instanceof Error ? osmError.message : String(osmError),
      });

      // 最后的降级方案：使用坐标格式化为地址
      // 格式: "36.20°N, 138.25°E" 或更详细的格式
      const formattedAddress = formatCoordinatesAsAddress(location);

      logger.info('Using fallback address format from coordinates', {
        location,
        formattedAddress,
      });

      return {
        address: formattedAddress,
        formattedAddress,
        province: undefined,
        city: undefined,
        district: undefined,
      };
    }
  }
}

/**
 * 将坐标格式化为易读的地址字符串
 * 用作最后的降级方案
 */
function formatCoordinatesAsAddress(location: Location): string {
  const latDir = location.lat >= 0 ? 'N' : 'S';
  const lngDir = location.lng >= 0 ? 'E' : 'W';

  const latAbs = Math.abs(location.lat);
  const lngAbs = Math.abs(location.lng);

  // 格式："36.20°N, 138.25°E"
  return `${latAbs.toFixed(2)}°${latDir}, ${lngAbs.toFixed(2)}°${lngDir}`;
}
