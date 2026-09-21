/**
 * @jest-environment node
 */

jest.mock('@/lib/amap', () => ({
  amapPoiSearch: jest.fn(async () => []),
  AmapProviderError: class AmapProviderError extends Error {
    constructor(
      public code: string,
      message: string,
      public category: string,
      public retryable: boolean
    ) { super(message); }
  },
}));

jest.mock('@/lib/rateLimit', () => ({
  getClientIP: jest.fn(() => '198.51.100.50'),
  checkRateLimit: jest.fn(async () => ({
    success: true,
    remaining: null,
    resetTime: 0,
    retryAfterSeconds: 60,
  })),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/search/route';
import { amapPoiSearch, AmapProviderError } from '@/lib/amap';
import { checkRateLimit } from '@/lib/rateLimit';
import { ProviderSchedulerError } from '@/lib/providerScheduler';

describe('/api/search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(checkRateLimit).mockResolvedValue({
      success: true,
      remaining: null,
      resetTime: 0,
      retryAfterSeconds: 60,
    });
    jest.mocked(amapPoiSearch).mockResolvedValue([]);
  });

  function request(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('https://example.com/api/search', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  it('rejects oversized keyword fanout before touching Amap', async () => {
    const request = new NextRequest('https://example.com/api/search', {
      method: 'POST',
      body: JSON.stringify({
        keywords: Array.from({ length: 9 }, (_, index) => `keyword-${index}`),
        location: { lat: 31.2304, lng: 121.4737 },
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(amapPoiSearch).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized request body before parsing or touching Amap', async () => {
    const request = new NextRequest('https://example.com/api/search', {
      method: 'POST',
      body: JSON.stringify({ keywords: ['川菜'] }),
      headers: {
        'content-type': 'application/json',
        'content-length': String(16 * 1024 + 1),
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(amapPoiSearch).not.toHaveBeenCalled();
  });

  it('passes a bounded request and its abort signal to Amap', async () => {
    const request = new NextRequest('https://example.com/api/search', {
      method: 'POST',
      body: JSON.stringify({
        keywords: ['川菜'],
        location: { lat: 31.2304, lng: 121.4737 },
        count: 8,
      }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(amapPoiSearch).toHaveBeenCalledWith(
      ['川菜'],
      { lat: 31.2304, lng: 121.4737 },
      2000,
      undefined,
      1,
      { signal: request.signal }
    );
  });

  it('returns filtered search data and accepts all optional request fields', async () => {
    const result = {
      id: 'r1', name: '餐厅', cuisineType: '川菜', address: '地址',
      location: { lat: 31.23, lng: 121.47 }, source: 'amap' as const,
    };
    jest.mocked(amapPoiSearch).mockResolvedValue([result]);
    const response = await POST(request({
      keywords: [' 川菜 '], location: { lat: 31.23, lng: 121.47, address: '上海' },
      distance: 100, count: 1, poiType: '050102',
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { source: 'amap', restaurants: [result] } });
  });

  it.each([
    [0, 'per-ip'],
    [1, 'global'],
  ])('rejects the %s rate-limit layer', async (failureIndex) => {
    jest.mocked(checkRateLimit)
      .mockResolvedValueOnce(failureIndex === 0 ? { success: false, remaining: 0, resetTime: 0, retryAfterSeconds: 7 } : { success: true, remaining: 1, resetTime: 0, retryAfterSeconds: 0 })
      .mockResolvedValueOnce(failureIndex === 1 ? { success: false, remaining: 0, resetTime: 0, retryAfterSeconds: 9 } : { success: true, remaining: 1, resetTime: 0, retryAfterSeconds: 0 });
    const response = await POST(request({ keywords: ['川菜'], location: { lat: 1, lng: 2 } }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(failureIndex === 0 ? '7' : '9');
    expect(amapPoiSearch).not.toHaveBeenCalled();
  });

  it.each([
    ['busy', undefined, 429],
    ['blocked', undefined, 429],
    ['unavailable', undefined, 503],
    ['blocked', 'configuration', 503],
    ['blocked', 'quota_exhausted', 503],
  ] as const)('maps scheduler %s/%s to HTTP %s', async (kind, category, status) => {
    jest.mocked(amapPoiSearch).mockRejectedValue(new ProviderSchedulerError('scheduler', kind, 1200, category));
    const response = await POST(request({ keywords: ['川菜'], location: { lat: 1, lng: 2 } }));
    expect(response.status).toBe(status);
    expect(response.headers.get('Retry-After')).toBe('2');
  });

  it.each([
    ['rate_limited', 429, '5'],
    ['configuration', 503, '300'],
    ['quota_exhausted', 503, '60'],
    ['unavailable', 503, '5'],
  ])('maps Amap %s failures', async (category, status, retryAfter) => {
    jest.mocked(amapPoiSearch).mockRejectedValue(new AmapProviderError('AMAP', 'failed', category as never, true));
    const response = await POST(request({ keywords: ['川菜'], location: { lat: 1, lng: 2 } }));
    expect(response.status).toBe(status);
    expect(response.headers.get('Retry-After')).toBe(retryAfter);
  });

  it('maps aborts and unknown failures and rejects GET', async () => {
    const abort = new Error('abort');
    abort.name = 'AbortError';
    jest.mocked(amapPoiSearch).mockRejectedValueOnce(abort).mockRejectedValueOnce('plain failure');
    expect((await POST(request({ keywords: ['川菜'], location: { lat: 1, lng: 2 } }))).status).toBe(499);
    expect((await POST(request({ keywords: ['川菜'], location: { lat: 1, lng: 2 } }))).status).toBe(500);
    expect((await GET()).status).toBe(405);
  });
});
