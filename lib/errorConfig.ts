/**
 * 错误信息配置
 * 将后端返回的错误码映射到用户友好的错误信息
 */

import type { ErrorInfo } from '@/types';

export const ERROR_CONFIG: Record<string, ErrorInfo> = {
  // ===== 致命错误（error）=====
  MISSING_API_KEY: {
    message: '服务配置错误',
    description: '地图服务 API 密钥未配置，无法进行搜索。请联系管理员。',
    severity: 'error',
    code: 'MISSING_API_KEY',
    retryable: false,
    actionLabel: '返回',
  },
  LOCATION_NOT_SUPPORTED: {
    message: '不支持的地区',
    description: '当前位置不在高德地图服务范围内，暂不支持该地区的餐厅搜索。',
    severity: 'error',
    code: 'LOCATION_NOT_SUPPORTED',
    retryable: false,
    actionLabel: '返回',
  },
  INVALID_LOCATION: {
    message: '位置信息无效',
    description: '无法识别您的位置，请尝试手动输入地址或重新定位。',
    severity: 'error',
    code: 'INVALID_LOCATION',
    retryable: false,
    actionLabel: '返回',
  },

  // ===== 可重试错误（warning）=====
  SEARCH_TIMEOUT: {
    message: '搜索超时',
    description: '搜索耗时过长，请稍后重试。',
    severity: 'warning',
    code: 'SEARCH_TIMEOUT',
    retryable: true,
    actionLabel: '重试',
  },
  SERVICE_BUSY: {
    message: '服务繁忙',
    description: '地图服务暂时繁忙，请稍后再试。',
    severity: 'warning',
    code: 'SERVICE_BUSY',
    retryable: true,
    actionLabel: '重试',
  },
  NETWORK_ERROR: {
    message: '网络连接失败',
    description: '请检查您的网络连接后重试。',
    severity: 'warning',
    code: 'NETWORK_ERROR',
    retryable: true,
    actionLabel: '重试',
  },
  API_CALL_FAILED: {
    message: '搜索失败',
    description: '获取餐厅信息失败，请稍后重试。',
    severity: 'warning',
    code: 'API_CALL_FAILED',
    retryable: true,
    actionLabel: '重试',
  },

  // ===== 信息性错误（info）=====
  NO_RESULTS: {
    message: '未找到餐厅',
    description: '附近暂时没有找到符合条件的餐厅，请尝试调整搜索条件或位置。',
    severity: 'info',
    code: 'NO_RESULTS',
    retryable: true,
    actionLabel: '返回修改',
  },
  PARTIAL_RESULTS: {
    message: '搜索结果不完整',
    description: '部分地图服务异常，已为您展示可用的搜索结果。',
    severity: 'info',
    code: 'PARTIAL_RESULTS',
    retryable: false,
    actionLabel: '关闭',
  },

  // ===== 通用错误 =====
  UNKNOWN_ERROR: {
    message: '发生未知错误',
    description: '请稍后重试，或联系技术支持。',
    severity: 'warning',
    code: 'UNKNOWN_ERROR',
    retryable: true,
    actionLabel: '重试',
  },
};

/**
 * 根据错误码获取错误信息
 */
export function getErrorInfo(code: string): ErrorInfo {
  return (
    ERROR_CONFIG[code] || {
      message: '发生错误',
      description: `错误代码: ${code}`,
      severity: 'warning',
      code,
      retryable: true,
      actionLabel: '重试',
    }
  );
}
