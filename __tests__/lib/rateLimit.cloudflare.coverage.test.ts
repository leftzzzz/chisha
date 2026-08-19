/**
 * @jest-environment node
 */

const mockGetCloudflareContext = jest.fn();

jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: Parameters<typeof mockGetCloudflareContext>) => mockGetCloudflareContext(...args),
}));

import { checkRateLimit, getClientIP, rateLimit } from '@/lib/rateLimit';

describe('Cloudflare rate limit binding', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    mockGetCloudflareContext.mockReset();
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('returns the native binding decision without inventing a remaining count', async () => {
    const limit = jest.fn(async () => ({ success: false }));
    mockGetCloudflareContext.mockResolvedValue({ env: { RL_AGENT_CHAT: { limit } } });

    await expect(checkRateLimit('agentChatPerIp', '203.0.113.1')).resolves.toMatchObject({
      success: false,
      remaining: null,
      retryAfterSeconds: 60,
    });
    expect(limit).toHaveBeenCalledWith({ key: 'agentChatPerIp:203.0.113.1' });
  });

  it('falls back to memory for invalid, unavailable, and failing bindings', async () => {
    mockGetCloudflareContext.mockResolvedValueOnce({ env: { RL_GEOCODE: { limit: 'invalid' } } });
    await expect(checkRateLimit('geocodePerIp', 'invalid-binding')).resolves.toMatchObject({ success: true });

    mockGetCloudflareContext.mockRejectedValueOnce(new Error('no context'));
    await expect(checkRateLimit('geocodePerIp', 'no-context')).resolves.toMatchObject({ success: true });

    const limit = jest.fn(async () => { throw new Error('binding failed'); });
    mockGetCloudflareContext.mockResolvedValueOnce({ env: { RL_GEOCODE: { limit } } });
    await expect(checkRateLimit('geocodePerIp', 'binding-failed')).resolves.toMatchObject({ success: true });
  });

  it('supports default memory limits and local proxy headers', () => {
    expect(rateLimit(`defaults-${Math.random()}`)).toMatchObject({ success: true, remaining: 2 });

    process.env.NODE_ENV = 'test';
    expect(getClientIP(new Request('https://example.test', {
      headers: { 'x-forwarded-for': '198.51.100.1, 198.51.100.2' },
    }))).toBe('198.51.100.1');
    expect(getClientIP(new Request('https://example.test', {
      headers: { 'x-real-ip': '192.0.2.1' },
    }))).toBe('192.0.2.1');
    expect(getClientIP(new Request('https://example.test'))).toBe('127.0.0.1');
  });
});
