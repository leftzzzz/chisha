/**
 * 地理编码 API 端点 (地址 -> 坐标)
 * POST /api/geocode
 */

import { NextRequest, NextResponse } from 'next/server';
import type { GeocodeRequest, GeocodeResponse } from '@/types';
import { GeocodeRequestSchema } from '@/lib/validation';
import { success, error, errorFromException, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { amapGeocode } from '@/lib/amap';

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body: unknown = await request.json();

    // 参数验证
    const validationResult = GeocodeRequestSchema.safeParse(body);
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

    const { address, city }: GeocodeRequest = validationResult.data;

    logger.info('Processing geocode request', { address, city });

    // 调用高德地图地理编码
    const location = await amapGeocode(address, city);

    const response: GeocodeResponse = { location };

    logger.info('Geocode request successful', { location });

    return NextResponse.json(success(response));
  } catch (err) {
    logger.error('Geocode request failed', { error: err });

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
