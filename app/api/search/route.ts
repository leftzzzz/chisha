/**
 * 餐厅搜索 API 端点
 * POST /api/search
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SearchRequest, SearchResponse } from '@/types';
import { SearchRequestSchema } from '@/lib/validation';
import { success, error, errorFromException, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { amapPoiSearch } from '@/lib/amap';
import { osmSearch } from '@/lib/osm';
import { combineAndFilterRestaurants, filterRestaurants } from '@/lib/dataTransform';

export async function POST(request: NextRequest) {
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
    const { keywords, location, distance = 2000, cuisineTypes, priceRange, count = 8 } = searchRequest;

    logger.info('Processing search request', {
      keywords,
      location,
      distance,
      count,
    });

    let restaurants = [];
    let source: 'amap' | 'osm' | 'mixed' = 'amap';

    try {
      // 优先使用高德地图搜索
      logger.info('Trying Amap search');
      restaurants = await amapPoiSearch(keywords, location, distance);

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
        success<SearchResponse>({
          restaurants: [],
          source: 'amap',
        })
      );
    }

    // 应用过滤条件
    let filtered = restaurants;
    if (cuisineTypes || priceRange) {
      filtered = filterRestaurants(restaurants, {
        cuisineTypes,
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

    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    if (err instanceof Error) {
      if ('code' in err) {
        const code = (err as { code: string }).code;
        if (code === ErrorCode.VALIDATION_ERROR) {
          statusCode = 400;
        } else if (code === ErrorCode.MISSING_API_KEY) {
          statusCode = 503;
        } else if (code === ErrorCode.TIMEOUT) {
          statusCode = 504;
        }
      }
    }

    return NextResponse.json(
      errorFromException(err, ErrorCode.SEARCH_API_ERROR),
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
