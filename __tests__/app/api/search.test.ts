/**
 * @jest-environment node
 */

jest.mock('@/lib/amap', () => ({
  amapPoiSearch: jest.fn(async () => []),
  AmapProviderError: class AmapProviderError extends Error {},
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
import { POST } from '@/app/api/search/route';
import { amapPoiSearch } from '@/lib/amap';

describe('/api/search', () => {
  beforeEach(() => jest.clearAllMocks());

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
});
