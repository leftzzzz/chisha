/**
 * 内存限流模块
 * 基于 IP 的滑动窗口限流
 *
 * ⚠️ SERVERLESS 环境限制说明：
 *
 * 本模块使用内存（Map）存储限流数据，在传统 Node.js 服务器环境下可以正常工作。
 * 但在 Serverless 环境（如 Cloudflare Workers、AWS Lambda、Vercel Edge Functions）中存在以下问题：
 *
 * 1. **无状态特性**：每次请求可能在不同的实例（隔离环境）中执行，内存不共享
 * 2. **短生命周期**：函数实例可能随时被销毁，内存数据会丢失
 * 3. **冷启动**：新实例启动时内存为空，无法继承之前的限流记录
 * 4. **并发问题**：多个实例同时处理请求时，无法实现真正的全局限流
 *
 * 结果：在 Serverless 环境下，此限流方案基本无效，用户可能绕过限制发送大量请求。
 *
 * TODO: 推荐的改进方案
 *
 * 对于 Cloudflare Workers 环境，应该使用以下方案之一：
 *
 * 1. **Cloudflare KV（推荐用于低频限流）**
 *    - 全局键值存储，所有实例共享
 *    - 最终一致性，可能有几秒延迟
 *    - 适合较宽松的限流（如：每分钟10次）
 *    - 参考实现：见下方 `rateLimitWithKV` 函数
 *
 * 2. **Cloudflare Durable Objects（推荐用于严格限流）**
 *    - 强一致性，单点协调
 *    - 适合严格的限流控制（如：每秒1次）
 *    - 需要额外配置和费用
 *
 * 3. **Redis/Upstash（通用方案）**
 *    - 支持所有 Serverless 平台
 *    - 低延迟，强一致性
 *    - 需要外部服务和 API 调用
 *
 * 参考文档：
 * - Cloudflare KV: https://developers.cloudflare.com/kv/
 * - Durable Objects: https://developers.cloudflare.com/durable-objects/
 */

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

// 存储每个 IP 的请求记录
// ⚠️ 注意：此 Map 仅在当前实例有效，在 Serverless 环境下不可靠
const requests = new Map<string, RateLimitRecord>();

// 定期清理过期记录（每5分钟）
const CLEANUP_INTERVAL = 5 * 60 * 1000;

// 声明全局类型以避免 TypeScript 错误
declare const EdgeRuntime: string | undefined;

// 检测是否为 Serverless 环境
const isServerless = (() => {
  try {
    // Cloudflare Workers
    if (typeof caches !== 'undefined' && 'default' in caches) {
      return true;
    }
    // Vercel Edge Functions
    if (typeof EdgeRuntime !== 'undefined') {
      return true;
    }
    // AWS Lambda (通过环境变量检测)
    if (typeof process !== 'undefined' && process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
})();

// 环境检测与警告
if (isServerless) {
  console.warn(
    '[RateLimit] ⚠️ 检测到 Serverless 环境，内存限流方案可能无效！\n' +
    '原因：每次请求可能在不同的隔离实例中执行，内存数据无法共享。\n' +
    '建议：使用 Cloudflare KV、Durable Objects 或 Redis 实现持久化限流。\n' +
    '详情请查看 lib/rateLimit.ts 文件顶部的注释说明。'
  );
}

// 定期清理仅在非 Serverless 环境下有效
if (typeof setInterval !== 'undefined' && !isServerless) {
  const cleanupTimer: unknown = setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);

  // 这个定时器只是清理内存，不该拖着进程不退出。
  // 不 unref 的话，任何 import 本模块的 Jest 用例跑完都会挂住不结束。
  if (typeof (cleanupTimer as { unref?: () => void }).unref === 'function') {
    (cleanupTimer as { unref: () => void }).unref();
  }
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
  // Cloudflare Workers 专用 header
  const cfConnectingIP = request.headers.get('cf-connecting-ip');
  if (cfConnectingIP) {
    return cfConnectingIP;
  }
  return '127.0.0.1';
}

/**
 * ============================================================================
 * Cloudflare KV 限流方案（框架代码 - 未实现）
 * ============================================================================
 *
 * 以下是使用 Cloudflare KV 实现全局限流的参考代码框架。
 * 要启用此方案，需要完成以下步骤：
 *
 * 1. 在 wrangler.jsonc 中配置 KV namespace
 *
 * 2. 在 Cloudflare Dashboard 中创建 KV namespace：
 *    https://dash.cloudflare.com/ -> Workers & Pages -> KV
 *
 * 3. 在 API 路由中使用 rateLimitWithKV 替代 rateLimit
 *
 * 4. TypeScript 类型定义（可选）：
 *    创建 types/cloudflare.d.ts
 */

/**
 * 使用 Cloudflare KV 实现的限流函数（框架代码）
 *
 * @param kv - Cloudflare KV namespace binding
 * @param ip - 客户端 IP
 * @param limit - 窗口期内最大请求数（默认10次，KV 延迟较高建议放宽）
 * @param windowMs - 时间窗口（默认60秒）
 * @returns Promise<RateLimitResult>
 *
 * 注意事项：
 * - KV 具有最终一致性，全球同步需要几秒时间
 * - 不适合需要毫秒级精度的严格限流
 * - 免费套餐：每天 100,000 次读取，1,000 次写入
 * - 建议配合 expirationTtl 自动清理过期数据
 */
export async function rateLimitWithKV(
  kv: KVNamespace,
  ip: string,
  limit: number = 10,
  windowMs: number = 60 * 1000
): Promise<RateLimitResult> {
  const now = Date.now();
  const key = `ratelimit:${ip}`;

  try {
    // 从 KV 读取现有记录
    const recordJson = await kv.get(key);
    const record: RateLimitRecord | null = recordJson ? JSON.parse(recordJson) : null;

    // 新用户或窗口已过期
    if (!record || now > record.resetTime) {
      const resetTime = now + windowMs;
      const newRecord: RateLimitRecord = { count: 1, resetTime };

      // 写入 KV，使用 expirationTtl 自动过期
      await kv.put(key, JSON.stringify(newRecord), {
        expirationTtl: Math.ceil(windowMs / 1000) + 60, // 额外60秒缓冲
      });

      return { success: true, remaining: limit - 1, resetTime };
    }

    // 超出限制
    if (record.count >= limit) {
      return { success: false, remaining: 0, resetTime: record.resetTime };
    }

    // 正常请求，计数+1
    record.count++;
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil((record.resetTime - now) / 1000) + 60,
    });

    return { success: true, remaining: limit - record.count, resetTime: record.resetTime };
  } catch (error) {
    // KV 错误时降级：允许请求通过（fail open）
    console.error('[RateLimit] KV error:', error);
    return { success: true, remaining: limit - 1, resetTime: now + windowMs };
  }
}

/**
 * TypeScript 类型定义：Cloudflare KV Namespace
 *
 * 如果项目中没有 @cloudflare/workers-types，可以使用此简化版本。
 * 完整类型请安装：npm i -D @cloudflare/workers-types
 */
export interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: {
    expiration?: number;
    expirationTtl?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: Record<string, unknown> }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}
