/**
 * 理解用户需求 API 端点
 * POST /api/understand
 */

import { NextRequest, NextResponse } from 'next/server';
import type { UnderstandRequest, UnderstandResponse } from '@/types';
import { UnderstandRequestSchema } from '@/lib/validation';
import { success, error, errorFromException, ErrorCode } from '@/lib/apiResponse';
import { logger } from '@/lib/logger';
import { callOpenAI } from '@/lib/llm';

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body: unknown = await request.json();

    // 参数验证
    const validationResult = UnderstandRequestSchema.safeParse(body);
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

    const { query, location }: UnderstandRequest = validationResult.data;

    logger.info('Processing understand request', { query, location });

    // 调用 LLM 理解需求
    const parsed = await callOpenAI(query, location);

    const response: UnderstandResponse = { parsed };

    logger.info('Understand request successful', { parsed });

    return NextResponse.json(success(response));
  } catch (err) {
    logger.error('Understand request failed', { error: err });

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
      errorFromException(err, ErrorCode.LLM_API_ERROR),
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
