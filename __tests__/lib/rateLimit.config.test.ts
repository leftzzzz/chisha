/**
 * @jest-environment node
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE_LIMITS, checkRateLimit, rateLimit } from '@/lib/rateLimit';

/**
 * Cloudflare 原生 ratelimit binding 的额度写在 wrangler.jsonc 里，代码侧只能
 * 按名字取 binding。两边一旦漂移，症状是"线上限流额度和代码注释说的不一样"，
 * 而且不会有任何报错——所以在这里锁死。
 */

interface WranglerRateLimit {
  name: string;
  namespace_id: string;
  simple: { limit: number; period: number };
}

function readWranglerRateLimits(): WranglerRateLimit[] {
  const path = join(process.cwd(), 'wrangler.jsonc');
  const raw = readFileSync(path, 'utf8');

  // 只剥整行注释：行内出现的 // 可能是 URL 的一部分
  const stripped = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  const parsed = JSON.parse(stripped) as { ratelimits?: WranglerRateLimit[] };
  return parsed.ratelimits ?? [];
}

describe('rate limit config', () => {
  const declared = readWranglerRateLimits();

  it('declares every RATE_LIMITS domain in wrangler.jsonc', () => {
    const declaredNames = declared.map((entry) => entry.name).sort();
    const expectedNames = Object.values(RATE_LIMITS).map((c) => c.binding).sort();

    expect(declaredNames).toEqual(expectedNames);
  });

  it.each(Object.entries(RATE_LIMITS))(
    'matches limit and period for %s',
    (_domain, config) => {
      const entry = declared.find((candidate) => candidate.name === config.binding);

      expect(entry).toBeDefined();
      expect(entry?.simple.limit).toBe(config.limit);
      expect(entry?.simple.period).toBe(config.periodSeconds);
    }
  );

  it('uses only periods Cloudflare accepts', () => {
    // 原生 binding 只支持 10 或 60 秒，写别的值部署时才会炸
    for (const config of Object.values(RATE_LIMITS)) {
      expect([10, 60]).toContain(config.periodSeconds);
    }
  });

  it('gives every domain a unique namespace_id', () => {
    const ids = declared.map((entry) => entry.namespace_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('checkRateLimit memory fallback', () => {
  // 测试环境拿不到 Cloudflare binding，checkRateLimit 会退回进程内存计数。
  // 这里验证的就是兜底路径本身还能挡住洪水。
  it('rejects once the domain limit is exceeded', async () => {
    const key = 'fallback-flood';
    const { limit } = RATE_LIMITS.geocodePerIp;
    let last = await checkRateLimit('geocodePerIp', key);

    for (let i = 1; i <= limit; i += 1) {
      last = await checkRateLimit('geocodePerIp', key);
    }

    expect(last.success).toBe(false);
    expect(last.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keys domains separately so one endpoint cannot exhaust another', async () => {
    const key = 'shared-ip';

    for (let i = 0; i < RATE_LIMITS.geocodePerIp.limit + 1; i += 1) {
      await checkRateLimit('geocodePerIp', key);
    }

    const other = await checkRateLimit('agentChatPerIp', key);
    expect(other.success).toBe(true);
  });
});

describe('rateLimit', () => {
  it('reports a positive retry-after when rejecting', () => {
    const key = 'retry-after-case';
    rateLimit(key, 1, 60 * 1000);
    const rejected = rateLimit(key, 1, 60 * 1000);

    expect(rejected.success).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    expect(rejected.remaining).toBe(0);
  });
});
