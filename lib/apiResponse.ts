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
  SEARCH_TIMEOUT: 'SEARCH_TIMEOUT',
  LOCATION_NOT_SUPPORTED: 'LOCATION_NOT_SUPPORTED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SERVICE_BUSY: 'SERVICE_BUSY',

  // 地理编码错误
  GEOCODE_ERROR: 'GEOCODE_ERROR',
  GEOCODE_NO_RESULTS: 'GEOCODE_NO_RESULTS',
  INVALID_LOCATION: 'INVALID_LOCATION',

  // 配置错误
  MISSING_API_KEY: 'MISSING_API_KEY',

  // 限流错误
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
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
      return error(err.code, err.message, {
        name: err.name,
        message: err.message,
      });
    }

    // 超时错误
    if (err.name === 'TimeoutError') {
      return error(ErrorCode.TIMEOUT, err.message);
    }

    return error(defaultCode, err.message, {
      name: err.name,
      message: err.message,
    });
  }

  return error(defaultCode, 'Unknown error occurred', {
    error: String(err),
  });
}
