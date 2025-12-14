/**
 * 内存限流模块
 * 基于 IP 的滑动窗口限流
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// 存储每个 IP 的请求记录
const requests = new Map<string, RateLimitRecord>();

// 定期清理过期记录（每5分钟）
const CLEANUP_INTERVAL = 5 * 60 * 1000;

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * 检查并更新限流状态
 * @param ip - 客户端 IP
 * @param limit - 窗口期内最大请求数（默认3次）
 * @param windowMs - 时间窗口（默认60秒）
 */
export function rateLimit(
  ip: string,
  limit: number = 3,
  windowMs: number = 60 * 1000
): RateLimitResult {
  const now = Date.now();
  const record = requests.get(ip);

  // 新用户或窗口已过期
  if (!record || now > record.resetTime) {
    const resetTime = now + windowMs;
    requests.set(ip, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime };
  }

  // 超出限制
  if (record.count >= limit) {
    return { success: false, remaining: 0, resetTime: record.resetTime };
  }

  // 正常请求，计数+1
  record.count++;
  return { success: true, remaining: limit - record.count, resetTime: record.resetTime };
}

/**
 * 从请求头获取客户端 IP
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIP = request.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  return '127.0.0.1';
}
