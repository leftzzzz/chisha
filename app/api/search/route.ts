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
import { amapPoiSearch, AmapProviderError } from '@/lib/amap';
import { combineAndFilterRestaurants } from '@/lib/dataTransform';
import { z } from 'zod';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import { ProviderSchedulerError } from '@/lib/providerScheduler';

const MAX_SEARCH_REQUEST_BYTES = 16 * 1024;

const SearchRequestSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(8),
  location: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    address: z.string().max(200).optional(),
  }),
  distance: z.number().finite().min(100).max(10_000).optional().default(2000),
  count: z.number().int().min(1).max(20).optional().default(8),
  poiType: z.string().trim().max(32).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_SEARCH_REQUEST_BYTES) {
      return NextResponse.json(
        error(ErrorCode.VALIDATION_ERROR, 'Request body too large'),
        { status: 413 }
      );
    }
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

    const ip = getClientIP(request);
    const [perIp, global] = await Promise.all([
      checkRateLimit('agentChatPerIp', ip),
      checkRateLimit('agentChatGlobal', 'all'),
    ]);
    const rejected = !perIp.success ? perIp : (!global.success ? global : null);
    if (rejected) {
      return NextResponse.json(
        error(ErrorCode.RATE_LIMIT_EXCEEDED, '请求过于频繁，请稍后再试'),
        { status: 429, headers: { 'Retry-After': String(rejected.retryAfterSeconds) } }
      );
    }

    logger.info('Simple POI search', { keywords, location, distance });

    // 调用高德搜索
    const restaurants = await amapPoiSearch(
      keywords,
      location,
      distance,
      poiType,
      1,
      { signal: request.signal }
    );

    // 去重和筛选
    const filteredRestaurants = combineAndFilterRestaurants(restaurants, count);

    const response: SearchResponse = {
      restaurants: filteredRestaurants,
      source: 'amap',
    };

    return NextResponse.json(success(response));

  } catch (err) {
    logger.error('Simple search failed', { error: err });

    if (err instanceof ProviderSchedulerError) {
      const hardBlock = err.providerCategory === 'configuration'
        || err.providerCategory === 'quota_exhausted';
      const status = !hardBlock && (err.kind === 'busy' || err.kind === 'blocked') ? 429 : 503;
      return NextResponse.json(
        error(status === 429 ? ErrorCode.RATE_LIMIT_EXCEEDED : ErrorCode.SERVICE_BUSY, '服务暂时不可用'),
        { status, headers: { 'Retry-After': String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))) } }
      );
    }

    if (err instanceof AmapProviderError) {
      const status = err.category === 'rate_limited' ? 429 : 503;
      const retryAfter = err.category === 'configuration'
        ? 300
        : err.category === 'quota_exhausted' ? 60 : 5;
      return NextResponse.json(
        error(err.code, err.message),
        { status, headers: { 'Retry-After': String(retryAfter) } }
      );
    }

    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(error(ErrorCode.NETWORK_ERROR, 'Request aborted'), { status: 499 });
    }

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
