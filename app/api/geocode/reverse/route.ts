/**
 * 逆向地理编码 API 端点 (坐标 -> 地址)
 * POST /api/geocode/reverse
 */

import { NextRequest, NextResponse } from 'next/server';
import type { ReverseGeocodeRequest, ReverseGeocodeResponse } from '@/types';
import { ReverseGeocodeRequestSchema } from '@/lib/validation';
import { success, error, errorFromException, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { amapReverseGeocode } from '@/lib/amap';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  // 限流检查：额度见 RATE_LIMITS.geocodePerIp
  const ip = getClientIP(request);
  const rateLimitResult = await checkRateLimit('geocodePerIp', ip);

  if (!rateLimitResult.success) {
    logger.warn('Rate limit exceeded', { ip });
    return NextResponse.json(
      error(ErrorCode.RATE_LIMIT_EXCEEDED, '请求过于频繁，请稍后再试'),
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimitResult.resetTime),
          'Retry-After': String(rateLimitResult.retryAfterSeconds),
        },
      }
    );
  }

  try {
    // 解析请求体
    const body: unknown = await request.json();

    // 参数验证
    const validationResult = ReverseGeocodeRequestSchema.safeParse(body);
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

    const { location }: ReverseGeocodeRequest = validationResult.data;

    logger.info('Processing reverse geocode request', { location });

    // 调用高德地图逆向地理编码
    const result = await amapReverseGeocode(location, request.signal);

    const response: ReverseGeocodeResponse = result;

    logger.info('Reverse geocode request successful', { address: result.address });

    return NextResponse.json(success(response));
  } catch (err) {
    logger.error('Reverse geocode request failed', { error: err });

    // 根据错误类型返回不同的状态码
    let statusCode = 500;
    if (err instanceof Error) {
      if ('code' in err) {
        const code = (err as { code: string }).code;
        if (code === ErrorCode.VALIDATION_ERROR) {
          statusCode = 400;
        } else if (code === ErrorCode.MISSING_API_KEY) {
          statusCode = 503;
        } else if (code === ErrorCode.GEOCODE_NO_RESULTS) {
          statusCode = 404;
        } else if (code === ErrorCode.TIMEOUT) {
          statusCode = 504;
        }
      }
    }

    return NextResponse.json(
      errorFromException(err, ErrorCode.GEOCODE_ERROR),
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
