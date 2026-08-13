/**
 * 限流模块
 *
 * 两套后端，按运行环境自动选择：
 *
 * 1. **Cloudflare Workers 原生 Rate Limiting binding**（生产用这个）
 *    额度由边缘维护，不依赖进程内存，多实例、冷启动都不影响。
 *    2025-09 起 GA，不额外收费，只算 Workers 请求与 CPU。
 *    需要在 wrangler.jsonc 里声明 `ratelimits`，见 RATE_LIMITS 表。
 *
 * 2. **进程内存滑动窗口**（本地 Node / Vercel Node runtime / 测试）
 *    在 Serverless 上基本无效——每个请求可能落在不同隔离实例里，内存不共享。
 *    只有在拿不到 binding 时才会用到，并且会打一次醒目的警告。
 *
 * ⚠️ 部署到公网前请确认 binding 真的生效：`/api/agent/chat` 会用你的
 * OPENAI_API_KEY 跑模型，限流失效等于把账单交给互联网。详见 SECURITY.md。
 */

import { logger } from '@/lib/logger';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

/**
 * 限流域定义。
 *
 * 每一项对应 wrangler.jsonc 里的一个 `ratelimits` 命名空间——**原生 binding 的
 * 额度写在配置里，不能按调用点传参**，所以不同额度必须拆成不同命名空间。
 *
 * 这里的 limit/period 有两个用途：内存兜底按它计数，以及作为 wrangler.jsonc
 * 应当声明什么的唯一事实来源。两边不一致会被
 * `__tests__/lib/rateLimit.config.test.ts` 判红。
 *
 * period 只能是 10 或 60（Cloudflare 的限制），所以这里统一用 60。
 */
export const RATE_LIMITS = {
  /** /api/agent/chat 按 IP。这是最贵的入口：一次请求会跑整个 agent loop */
  agentChatPerIp: { binding: 'RL_AGENT_CHAT', limit: 6, periodSeconds: 60 },
  /**
   * /api/agent/chat 的总量闸门，key 是常量。
   *
   * 按 IP 限流挡不住轮换 IP 的脚本，这条才是真正给账单封顶的。注意原生
   * binding 是**按 Cloudflare 机房各自计数**的，所以最坏情况是这个数乘以
   * 攻击者能打到的机房数——它收窄风险，不是硬上限。
   */
  agentChatGlobal: { binding: 'RL_AGENT_CHAT_ALL', limit: 60, periodSeconds: 60 },
  /** 高德 JS API 代理。瓦片请求密集，额度要宽 */
  amapProxyPerIp: { binding: 'RL_AMAP_PROXY', limit: 300, periodSeconds: 60 },
  /** 地理编码，正反向共用一个域 */
  geocodePerIp: { binding: 'RL_GEOCODE', limit: 3, periodSeconds: 60 },
} as const;

export type RateLimitDomain = keyof typeof RATE_LIMITS;

/** Cloudflare 原生 ratelimit binding 的最小接口 */
interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitResult {
  success: boolean;
  /** 被拒时告诉客户端多久后重试（秒） */
  retryAfterSeconds: number;
  /** 剩余额度。用原生 binding 时拿不到，为 null */
  remaining: number | null;
  resetTime: number;
}

// ============================================================================
// 内存后端
// ============================================================================

const requests = new Map<string, RateLimitRecord>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;

declare const EdgeRuntime: string | undefined;

/** 检测是否为 Serverless 环境 */
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
    // AWS Lambda
    if (typeof process !== 'undefined' && process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
})();

// 定期清理仅在非 Serverless 环境下有效
if (typeof setInterval !== 'undefined' && !isServerless) {
  const cleanupTimer: unknown = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  // 这个定时器只是清理内存，不该拖着进程不退出。
  // 不 unref 的话，任何 import 本模块的 Jest 用例跑完都会挂住不结束。
  if (typeof (cleanupTimer as { unref?: () => void }).unref === 'function') {
    (cleanupTimer as { unref: () => void }).unref();
  }
}

/**
 * 进程内存滑动窗口。
 *
 * 直接调用它只在明确不需要跨实例一致性时才合适；业务路由请用
 * `checkRateLimit`，它会优先走 Cloudflare 原生 binding。
 */
export function rateLimit(
  key: string,
  limit: number = 3,
  windowMs: number = 60 * 1000
): RateLimitResult {
  const now = Date.now();
  const record = requests.get(key);
  const retryAfterSeconds = Math.ceil(windowMs / 1000);

  // 新 key 或窗口已过期
  if (!record || now > record.resetTime) {
    const resetTime = now + windowMs;
    requests.set(key, { count: 1, resetTime });
    return { success: true, remaining: limit - 1, resetTime, retryAfterSeconds };
  }

  // 超出限制
  if (record.count >= limit) {
    return {
      success: false,
      remaining: 0,
      resetTime: record.resetTime,
      retryAfterSeconds: Math.max(1, Math.ceil((record.resetTime - now) / 1000)),
    };
  }

  // 正常请求，计数 +1
  record.count++;
  return {
    success: true,
    remaining: limit - record.count,
    resetTime: record.resetTime,
    retryAfterSeconds,
  };
}

// ============================================================================
// Cloudflare 原生后端
// ============================================================================

let warnedAboutMemoryFallback = false;

function warnMemoryFallbackOnce(domain: RateLimitDomain, binding: string): void {
  if (warnedAboutMemoryFallback || !isServerless) {
    return;
  }
  warnedAboutMemoryFallback = true;
  logger.warn(
    'Rate limit binding missing on a serverless runtime; falling back to in-process memory, '
      + 'which does not limit anything across isolates. Declare it in wrangler.jsonc.',
    { domain, binding }
  );
}

async function getRateLimitBinding(name: string): Promise<RateLimitBinding | null> {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const candidate = (context.env as Record<string, unknown>)[name];
    return isRateLimitBinding(candidate) ? candidate : null;
  } catch {
    // 不在 Cloudflare 运行时（本地 next dev、Vercel Node）
    return null;
  }
}

function isRateLimitBinding(value: unknown): value is RateLimitBinding {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { limit?: unknown }).limit === 'function';
}

/**
 * 检查限流。优先走 Cloudflare 原生 binding，拿不到就退回进程内存。
 *
 * @param domain - RATE_LIMITS 里的限流域
 * @param key - 计数主体。按 IP 限流就传 IP；总量闸门传常量
 */
export async function checkRateLimit(
  domain: RateLimitDomain,
  key: string
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[domain];
  const windowMs = config.periodSeconds * 1000;
  const binding = await getRateLimitBinding(config.binding);

  if (!binding) {
    warnMemoryFallbackOnce(domain, config.binding);
    return rateLimit(`${domain}:${key}`, config.limit, windowMs);
  }

  try {
    const { success } = await binding.limit({ key: `${domain}:${key}` });
    return {
      success,
      remaining: null,
      resetTime: Date.now() + windowMs,
      retryAfterSeconds: config.periodSeconds,
    };
  } catch (error) {
    // binding 出错时退回内存计数而不是直接放行：宁可少挡一些，
    // 也不要在限流器抖动时把最贵的入口彻底敞开
    logger.error('Rate limit binding failed, falling back to memory', { domain, error });
    return rateLimit(`${domain}:${key}`, config.limit, windowMs);
  }
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
