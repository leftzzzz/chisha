/**
 * 高德地图 API 调用封装
 */

import type { Location, Restaurant } from '@/types';
import { ApiError } from '@/types';
import { logger } from './logger';
import { fetchWithTimeout } from './withTimeout';
import { ErrorCode } from './apiResponse';
import { osmReverseGeocode } from './osm';
import {
  MAX_POI_PAGES,
  getPagesPerKeyword,
  normalizeSearchKeywords,
  resolvePoiTypesForKeyword,
} from './agent/poiTaxonomy';

const AMAP_API_KEY = process.env.AMAP_API_KEY;
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE;
const AMAP_BASE_URL = 'https://restapi.amap.com/v3';
const AMAP_TIMEOUT = 10000; // 10 秒超时
const AMAP_MAX_QPS = parsePositiveInt(process.env.AMAP_MAX_QPS, 4);
const AMAP_MAX_RETRIES = parsePositiveInt(process.env.AMAP_MAX_RETRIES, 2);
const AMAP_SEARCH_CACHE_TTL_MS = parsePositiveInt(process.env.AMAP_SEARCH_CACHE_TTL_MS, 2 * 60 * 1000);
const AMAP_DETAIL_CACHE_TTL_MS = parsePositiveInt(process.env.AMAP_DETAIL_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
const AMAP_GEOCODE_CACHE_TTL_MS = parsePositiveInt(process.env.AMAP_GEOCODE_CACHE_TTL_MS, 60 * 60 * 1000);
const AMAP_RATE_LIMIT_INFOCODES = new Set(['10020', '10021']);

/**
 * 高德 API 响应类型
 */
interface AmapStatusResponse {
  status: string;
  info: string;
  infocode: string;
}

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

const amapResponseCache = new Map<string, { expiresAt: number; data: unknown }>();
let amapRequestSchedule = Promise.resolve();
let lastAmapRequestAt = 0;

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
  poiType?: string,
  pageCount: number = 1
): Promise<Restaurant[]> {
  // 检查 API Key
  if (!AMAP_API_KEY) {
    logger.error('Missing Amap API Key');
    throw new ApiError(
      ErrorCode.MISSING_API_KEY,
      'Amap API key is not configured'
    );
  }

  const searchKeywords = normalizeSearchKeywords(keywords);
  const pages = Math.max(1, Math.min(Math.round(pageCount), MAX_POI_PAGES));
  const pagesPerKeyword = getPagesPerKeyword(searchKeywords.length, pages);
  const searchTasks = searchKeywords.map((keyword) => ({
    keyword,
    poiType: resolvePoiTypesForKeyword(keyword, poiType, searchKeywords.length > 1),
  }));

  logger.info('Calling Amap POI search', {
    keywords: searchKeywords,
    tasks: searchTasks,
    poiTypeSource: poiType ? 'llm-or-keyword' : 'keyword-or-default',
    location,
    distance,
    pageCount,
    pagesPerKeyword,
  });

  try {
    const allPois: AmapPoi[] = [];

    for (const task of searchTasks) {
      for (let page = 1; page <= pagesPerKeyword; page++) {
        const data = await fetchAmapPoiPage(task.keyword, task.poiType, location, distance, page);
        if (!data.pois || data.pois.length === 0) {
          if (page === 1) {
            logger.info('Amap search returned no results', {
              keyword: task.keyword,
              poiType: task.poiType,
            });
          }
          break;
        }

        allPois.push(...data.pois);

        if (data.pois.length < 20 || page * 20 >= Number(data.count || 0)) {
          break;
        }
      }
    }

    const uniquePois = dedupeAmapPois(allPois);

    logger.info('Amap search successful', {
      rawCount: allPois.length,
      count: uniquePois.length,
    });

    return uniquePois.map((poi) => transformAmapPoi(poi));
  } catch (error) {
    logger.error('Amap search failed', { error });
    throw error;
  }
}

function dedupeAmapPois(pois: AmapPoi[]): AmapPoi[] {
  const poiMap = new Map<string, AmapPoi>();

  for (const poi of pois) {
    const key = poi.id || `${poi.name}_${poi.location}`;
    const existing = poiMap.get(key);

    if (!existing || amapPoiCompletenessScore(poi) > amapPoiCompletenessScore(existing)) {
      poiMap.set(key, poi);
    }
  }

  return Array.from(poiMap.values()).sort((left, right) =>
    parsePoiDistance(left) - parsePoiDistance(right)
  );
}

function amapPoiCompletenessScore(poi: AmapPoi): number {
  let score = 0;

  if (poi.tel) score += 1;
  if (poi.biz_ext?.rating || poi.rating) score += 1;
  if (poi.biz_ext?.cost || poi.cost) score += 1;
  if (pickOpeningHours(poi)) score += 1;
  if (poi.photos?.length) score += 1;

  return score;
}

function parsePoiDistance(poi: AmapPoi): number {
  const parsed = Number.parseInt(poi.distance ?? '', 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function fetchAmapPoiPage(
  keyword: string,
  poiType: string,
  location: Location,
  distance: number,
  page: number
): Promise<AmapPoiResponse> {
  const params = new URLSearchParams({
    key: AMAP_API_KEY!,
    keywords: keyword,
    types: poiType,
    location: `${location.lng},${location.lat}`,
    radius: distance.toString(),
    sortrule: 'distance',
    offset: '20',
    page: page.toString(),
    extensions: 'all',
  });

  if (AMAP_SECURITY_CODE) {
    params.append('sig', AMAP_SECURITY_CODE);
  }

  const url = `${AMAP_BASE_URL}/place/around?${params.toString()}`;
  return fetchAmapJson<AmapPoiResponse>(
    url,
    ErrorCode.SEARCH_API_ERROR,
    AMAP_SEARCH_CACHE_TTL_MS
  );
}

async function fetchAmapJson<T extends AmapStatusResponse>(
  url: string,
  errorCode: string,
  cacheTtlMs: number
): Promise<T> {
  const cached = getCachedAmapResponse<T>(url);
  if (cached) {
    logger.info('Amap cache hit', { endpoint: redactAmapUrl(url) });
    return cached;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= AMAP_MAX_RETRIES; attempt++) {
    try {
      await scheduleAmapRequest();
      const response = await fetchWithTimeout(url, {}, AMAP_TIMEOUT);

      if (!response.ok) {
        throw new ApiError(errorCode, `Amap API error: ${response.status}`);
      }

      const data = await response.json() as T;

      if (data.status === '1') {
        setCachedAmapResponse(url, data, cacheTtlMs);
        return data;
      }

      if (isAmapQpsLimit(data) && attempt < AMAP_MAX_RETRIES) {
        const delayMs = getAmapRetryDelayMs(attempt);
        logger.warn('Amap QPS limit hit, retrying after backoff', {
          info: data.info,
          infocode: data.infocode,
          attempt: attempt + 1,
          delayMs,
        });
        await sleep(delayMs);
        continue;
      }

      logger.warn('Amap API returned error', {
        info: data.info,
        infocode: data.infocode,
      });
      throw new ApiError(
        isAmapQpsLimit(data) ? ErrorCode.RATE_LIMIT_EXCEEDED : errorCode,
        `Amap API error: ${data.info}`
      );
    } catch (error) {
      lastError = error;

      if (error instanceof ApiError) {
        throw error;
      }

      if (attempt >= AMAP_MAX_RETRIES) {
        throw error;
      }

      const delayMs = getAmapRetryDelayMs(attempt);
      logger.warn('Amap request failed, retrying after backoff', {
        error: error instanceof Error ? error.message : String(error),
        attempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function scheduleAmapRequest(): Promise<void> {
  const scheduled = amapRequestSchedule.then(async () => {
    const minIntervalMs = Math.ceil(1000 / Math.max(1, AMAP_MAX_QPS));
    const waitMs = Math.max(0, lastAmapRequestAt + minIntervalMs - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    lastAmapRequestAt = Date.now();
  });

  amapRequestSchedule = scheduled.catch(() => undefined);
  return scheduled;
}

function getCachedAmapResponse<T>(url: string): T | null {
  const cached = amapResponseCache.get(url);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    amapResponseCache.delete(url);
    return null;
  }

  return cached.data as T;
}

function setCachedAmapResponse(url: string, data: unknown, ttlMs: number): void {
  if (ttlMs <= 0) {
    return;
  }

  pruneAmapResponseCache();
  amapResponseCache.set(url, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

function pruneAmapResponseCache(): void {
  if (amapResponseCache.size < 500) {
    return;
  }

  const now = Date.now();
  for (const [key, value] of amapResponseCache.entries()) {
    if (value.expiresAt <= now || amapResponseCache.size > 400) {
      amapResponseCache.delete(key);
    }
  }
}

function isAmapQpsLimit(data: AmapStatusResponse): boolean {
  return AMAP_RATE_LIMIT_INFOCODES.has(data.infocode)
    || /QPS|并发|访问过于频繁|限流/.test(data.info);
}

function getAmapRetryDelayMs(attempt: number): number {
  return Math.min(2000, 300 * 2 ** attempt);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactAmapUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('key');
    parsed.searchParams.delete('sig');
    return `${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return 'unknown';
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
  const data = await fetchAmapJson<AmapPoiResponse>(
    url,
    ErrorCode.SEARCH_API_ERROR,
    AMAP_DETAIL_CACHE_TTL_MS
  );
  if (!data.pois || data.pois.length === 0) {
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
    poiTypeCode: poi.typecode,
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
    const data = await fetchAmapJson<{
      status: string;
      info: string;
      infocode: string;
      geocodes?: Array<{
        location: string;
        formatted_address: string;
      }>;
    }>(url, ErrorCode.GEOCODE_ERROR, AMAP_GEOCODE_CACHE_TTL_MS);

    if (!data.geocodes || data.geocodes.length === 0) {
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
    const data = await fetchAmapJson<{
      status: string;
      info: string;
      infocode: string;
      regeocode?: {
        formatted_address?: string | string[];
        addressComponent?: {
          province?: string;
          city?: string;
          district?: string;
        };
      };
    }>(url, ErrorCode.GEOCODE_ERROR, AMAP_GEOCODE_CACHE_TTL_MS);

    logger.info('Amap reverse geocode response', {
      status: data.status,
      hasRegeocode: !!data.regeocode,
      regeocode: data.regeocode,
    });

    if (!data.regeocode) {
      throw new ApiError(
        ErrorCode.GEOCODE_NO_RESULTS,
        'No reverse geocoding results found from Amap'
      );
    }

    const regeocode = data.regeocode;
    const addressComponent = regeocode.addressComponent;
    const rawFormattedAddress = regeocode.formatted_address;
    const formattedAddress = Array.isArray(rawFormattedAddress)
      ? rawFormattedAddress[0]
      : rawFormattedAddress;

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
