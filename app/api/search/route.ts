/**
 * 简单 POI 搜索 API 端点
 * POST /api/search
 *
 * 用于转盘管理面板添加餐厅的简单搜索
 * 不经过 Agent，直接调用高德 POI
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SearchResponse } from '@/types';
import { success, error, errorFromException, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { amapPoiSearch } from '@/lib/amap';
import { combineAndFilterRestaurants } from '@/lib/dataTransform';
import { z } from 'zod';

const SearchRequestSchema = z.object({
  keywords: z.array(z.string()).min(1),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  distance: z.number().optional().default(2000),
  count: z.number().optional().default(8),
  poiType: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();

    // 参数验证
    const validationResult = SearchRequestSchema.safeParse(body);
    if (!validationResult.success) {
      logger.warn('Search validation failed', {
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

    const { keywords, location, distance, count, poiType } = validationResult.data;

    logger.info('Simple POI search', { keywords, location, distance });

    // 调用高德搜索
    const restaurants = await amapPoiSearch(keywords, location, distance, poiType);

    // 去重和筛选
    const filteredRestaurants = combineAndFilterRestaurants(restaurants, count);

    const response: SearchResponse = {
      restaurants: filteredRestaurants,
      source: 'amap',
    };

    return NextResponse.json(success(response));

  } catch (err) {
    logger.error('Simple search failed', { error: err });

    return NextResponse.json(
      errorFromException(err, ErrorCode.SEARCH_API_ERROR),
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    error(ErrorCode.VALIDATION_ERROR, 'Method not allowed'),
    { status: 405 }
  );
}
