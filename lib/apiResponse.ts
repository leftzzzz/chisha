/**
 * 统一 API 响应格式
 */

// API 响应接口
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// 错误码常量
export const ErrorCode = {
  // 通用错误
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TIMEOUT: 'TIMEOUT',

  // LLM 相关错误
  LLM_API_ERROR: 'LLM_API_ERROR',
  LLM_PARSE_ERROR: 'LLM_PARSE_ERROR',

  // 搜索相关错误
  SEARCH_NO_RESULTS: 'SEARCH_NO_RESULTS',
  SEARCH_API_ERROR: 'SEARCH_API_ERROR',

  // 地理编码错误
  GEOCODE_ERROR: 'GEOCODE_ERROR',
  GEOCODE_NO_RESULTS: 'GEOCODE_NO_RESULTS',

  // 配置错误
  MISSING_API_KEY: 'MISSING_API_KEY',
} as const;

/**
 * 创建成功响应
 */
export function success<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
  };
}

/**
 * 创建错误响应
 */
export function error(
  code: string,
  message: string,
  details?: unknown
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
  };
}

/**
 * 从 Error 对象创建错误响应
 */
export function errorFromException(
  err: unknown,
  defaultCode: string = ErrorCode.INTERNAL_ERROR
): ApiResponse<never> {
  if (err instanceof Error) {
    // 检查是否是自定义错误
    if ('code' in err && typeof err.code === 'string') {
      return error(err.code, err.message, err);
    }

    // 超时错误
    if (err.name === 'TimeoutError') {
      return error(ErrorCode.TIMEOUT, err.message);
    }

    return error(defaultCode, err.message, err);
  }

  return error(defaultCode, 'Unknown error occurred', err);
}
