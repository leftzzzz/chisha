/**
 * 高德地图 API 调用封装
 */

import type { Location, Restaurant } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { fetchWithTimeout } from './withTimeout';
import { ErrorCode } from './apiResponse';

const AMAP_API_KEY = process.env.AMAP_API_KEY;
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE;
const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const AMAP_TIMEOUT = 10000; // 10 秒超时

// 高德 POI 类型映射（餐饮服务相关）
const POI_TYPES = '050000|餐饮服务';

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
}

/**
 * 调用高德地图 POI 搜索 API
 * @param keywords 搜索关键词数组
 * @param location 搜索中心点
 * @param distance 搜索半径（米）
 * @returns 餐厅列表
 */
export async function amapPoiSearch(
  keywords: string[],
  location: Location,
  distance: number = 2000
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

  // 构建请求参数
  const params = new URLSearchParams({
    key: AMAP_API_KEY,
    keywords: keyword,
    types: POI_TYPES,
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
    distance: poi.distance ? parseInt(poi.distance, 10) : undefined,
    address: poi.address,
    phone: poi.tel,
    location: { lat, lng },
    source: 'amap',
  };
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
 * 逆向地理编码：坐标转地址
 */
export async function amapReverseGeocode(location: Location): Promise<{
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

    if (data.status !== '1' || !data.regeocode) {
      throw new ApiError(
        ErrorCode.GEOCODE_NO_RESULTS,
        'No reverse geocoding results found'
      );
    }

    const regeocode = data.regeocode;
    const addressComponent = regeocode.addressComponent;

    return {
      address: regeocode.formatted_address,
      formattedAddress: regeocode.formatted_address,
      province: addressComponent?.province,
      city: addressComponent?.city,
      district: addressComponent?.district,
    };
  } catch (error) {
    logger.error('Amap reverse geocode failed', { error });
    throw error;
  }
}
