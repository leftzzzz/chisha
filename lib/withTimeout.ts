/**
 * 超时中间件
 * 为异步操作添加超时控制
 */

import { TimeoutError } from '@/types';
import { logger } from './logger';

/**
 * 为异步函数添加超时控制
 * @param fn 要执行的异步函数
 * @param timeoutMs 超时时间（毫秒）
 * @returns 包装后的函数，会在超时时抛出 TimeoutError
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      logger.warn('Operation timed out', { timeoutMs });
      reject(new TimeoutError(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * 创建一个带超时的 fetch 函数
 * @param url 请求 URL
 * @param options fetch 选项
 * @param timeoutMs 超时时间（毫秒），默认 10000
 */
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}
