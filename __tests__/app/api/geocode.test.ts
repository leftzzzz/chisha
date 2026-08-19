/**
 * @jest-environment node
 */

jest.mock('@/lib/amap', () => ({
  amapGeocode: jest.fn(),
  amapReverseGeocode: jest.fn(),
}));

jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn(),
  getClientIP: jest.fn(() => '198.51.100.20'),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { NextRequest } from 'next/server';
import { GET as getGeocode, POST as postGeocode } from '@/app/api/geocode/route';
import {
  GET as getReverseGeocode,
  POST as postReverseGeocode,
} from '@/app/api/geocode/reverse/route';
import { amapGeocode, amapReverseGeocode } from '@/lib/amap';
import { ErrorCode } from '@/lib/apiResponse';
import { checkRateLimit } from '@/lib/rateLimit';

const mockAmapGeocode = jest.mocked(amapGeocode);
const mockAmapReverseGeocode = jest.mocked(amapReverseGeocode);
const mockCheckRateLimit = jest.mocked(checkRateLimit);

function request(path: string, body: unknown): NextRequest {
  return new NextRequest(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(`provider failed: ${code}`), { code });
}

describe('geocode API routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({
      success: true,
      remaining: 2,
      resetTime: 0,
      retryAfterSeconds: 0,
    });
  });

  it('validates forward geocode input before calling Amap', async () => {
    const response = await postGeocode(request('/api/geocode', { address: '' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(mockAmapGeocode).not.toHaveBeenCalled();
  });

  it('passes normalized forward geocode input and the request signal to Amap', async () => {
    mockAmapGeocode.mockResolvedValue({
      lat: 31.2304,
      lng: 121.4737,
      address: '上海市黄浦区',
    });
    const apiRequest = request('/api/geocode', {
      address: '人民广场',
      city: '上海',
    });

    const response = await postGeocode(apiRequest);

    expect(response.status).toBe(200);
    expect(mockAmapGeocode).toHaveBeenCalledWith('人民广场', '上海', apiRequest.signal);
    expect(await response.json()).toMatchObject({
      success: true,
      data: { location: { lat: 31.2304, lng: 121.4737 } },
    });
  });

  it.each([
    [ErrorCode.MISSING_API_KEY, 503],
    [ErrorCode.GEOCODE_NO_RESULTS, 404],
    [ErrorCode.TIMEOUT, 504],
  ])('maps forward geocode error %s to HTTP %s', async (code, status) => {
    mockAmapGeocode.mockRejectedValue(codedError(code));

    const response = await postGeocode(request('/api/geocode', { address: '人民广场' }));

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it('returns retry metadata when geocode rate limiting rejects the request', async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      success: false,
      remaining: 0,
      resetTime: 1_725_000_000,
      retryAfterSeconds: 12,
    });

    const response = await postGeocode(request('/api/geocode', { address: '人民广场' }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(response.headers.get('X-RateLimit-Reset')).toBe('1725000000');
    expect(mockAmapGeocode).not.toHaveBeenCalled();
  });

  it('validates reverse geocode coordinates before calling Amap', async () => {
    const response = await postReverseGeocode(request('/api/geocode/reverse', {
      location: { lat: 91, lng: 121.4737 },
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(mockAmapReverseGeocode).not.toHaveBeenCalled();
  });

  it('passes reverse geocode input and the request signal to Amap', async () => {
    mockAmapReverseGeocode.mockResolvedValue({
      address: '上海市黄浦区人民广场',
      formattedAddress: '上海市黄浦区人民广场',
      province: '上海市',
      city: '上海市',
      district: '黄浦区',
    });
    const apiRequest = request('/api/geocode/reverse', {
      location: { lat: 31.2304, lng: 121.4737 },
    });

    const response = await postReverseGeocode(apiRequest);

    expect(response.status).toBe(200);
    expect(mockAmapReverseGeocode).toHaveBeenCalledWith(
      { lat: 31.2304, lng: 121.4737 },
      apiRequest.signal
    );
    expect(await response.json()).toMatchObject({
      success: true,
      data: { address: '上海市黄浦区人民广场' },
    });
  });

  it('maps reverse geocode timeout errors to HTTP 504', async () => {
    mockAmapReverseGeocode.mockRejectedValue(codedError(ErrorCode.TIMEOUT));

    const response = await postReverseGeocode(request('/api/geocode/reverse', {
      location: { lat: 31.2304, lng: 121.4737 },
    }));

    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe(ErrorCode.TIMEOUT);
  });

  it('rejects GET requests on both geocode routes', async () => {
    const [forward, reverse] = await Promise.all([getGeocode(), getReverseGeocode()]);

    expect(forward.status).toBe(405);
    expect(reverse.status).toBe(405);
  });
});
