/**
 * 餐厅搜索 API 端点
 * POST /api/search
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SearchRequest, SearchResponse, Restaurant } from '@/types';
import { SearchRequestSchema } from '@/lib/validation';
import { success, error, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { amapPoiSearch } from '@/lib/amap';
import { osmSearch } from '@/lib/osm';
import { combineAndFilterRestaurants, filterRestaurants } from '@/lib/dataTransform';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  // 限流检查：每分钟3次
  const ip = getClientIP(request);
  const rateLimitResult = rateLimit(ip, 3, 60 * 1000);

  if (!rateLimitResult.success) {
    logger.warn('Rate limit exceeded', { ip });
    return NextResponse.json(
      error(ErrorCode.RATE_LIMIT_EXCEEDED, '请求过于频繁，请稍后再试'),
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
          'Retry-After': String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)),
        },
      }
    );
  }

  try {
    // 解析请求体
    const body: unknown = await request.json();

    // 参数验证
    const validationResult = SearchRequestSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn('Validation failed', {
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        error(
          ErrorCode.VALIDATION_ERROR,
          'Invalid request parameters',
          validationResult.error.errors
        ),
        { status: 400 }
      );
    }

    const searchRequest: SearchRequest = validationResult.data;
    const { keywords, location, distance = 2000, priceRange, count = 8, poiType } = searchRequest;

    logger.info('Processing search request', {
      keywords,
      location,
      distance,
      count,
      poiType,
    });

    let restaurants: unknown[] = [];
    let source: 'amap' | 'osm' | 'mixed' = 'amap';

    try {
      // 优先使用高德地图搜索
      logger.info('Trying Amap search');
      restaurants = await amapPoiSearch(keywords, location, distance, poiType);

      if (restaurants.length > 0) {
        logger.info('Amap search successful', { count: restaurants.length });
        source = 'amap';
      } else {
        throw new Error('No results from Amap');
      }
    } catch (amapError) {
      // 高德搜索失败，降级到 OSM
      logger.warn('Amap search failed, falling back to OSM', { error: amapError });

      try {
        restaurants = await osmSearch(keywords, location, distance);
        if (restaurants.length > 0) {
          logger.info('OSM search successful', { count: restaurants.length });
          source = 'osm';
        }
      } catch (osmError) {
        logger.error('OSM search also failed', { error: osmError });
        // 如果两个都失败了，返回空结果
        restaurants = [];
      }
    }

    // 检查是否有结果
    if (restaurants.length === 0) {
      logger.warn('No restaurants found');
      return NextResponse.json(
        error(
          ErrorCode.SEARCH_NO_RESULTS,
          'No restaurants found in this area'
        ),
        { status: 200 }
      );
    }

    // 应用价格过滤
    let filtered = restaurants as Restaurant[];
    if (priceRange) {
      filtered = filterRestaurants(restaurants as Restaurant[], {
        priceRange,
      });
    }

    // 合并去重并限制数量
    const final = combineAndFilterRestaurants(filtered, count);

    const response: SearchResponse = {
      restaurants: final,
      source,
    };

    logger.info('Search request successful', {
      totalFound: restaurants.length,
      afterFilter: filtered.length,
      returned: final.length,
    });

    return NextResponse.json(success(response));
  } catch (err) {
    logger.error('Search request failed', { error: err });

    // 根据错误类型返回不同的错误码和状态码
    let errorCode: string = ErrorCode.SEARCH_API_ERROR;
    let statusCode = 500;
    let message = 'Search failed, please try again later';

    if (err instanceof Error) {
      // 检查是否是自定义错误
      if ('code' in err && typeof err.code === 'string') {
        const customCode = (err as { code: string }).code;
        errorCode = customCode;
        if (customCode === ErrorCode.VALIDATION_ERROR) {
          statusCode = 400;
        } else if (customCode === ErrorCode.MISSING_API_KEY) {
          statusCode = 503;
          message = 'Service configuration error';
        } else if (customCode === ErrorCode.TIMEOUT || customCode === ErrorCode.SEARCH_TIMEOUT) {
          statusCode = 504;
          message = 'Search timeout, please try again';
        } else if (customCode === ErrorCode.LOCATION_NOT_SUPPORTED) {
          statusCode = 400;
          message = 'Location not supported';
        }
      }
    }

    return NextResponse.json(
      error(errorCode, message),
      { status: statusCode }
    );
  }
}

// 只允许 POST 方法
export async function GET() {
  return NextResponse.json(
    error(ErrorCode.VALIDATION_ERROR, 'Method not allowed'),
    { status: 405 }
  );
}
