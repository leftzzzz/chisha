import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function amapPoi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'poi-id',
    name: '测试餐厅',
    type: '餐饮服务;中餐厅;中餐厅',
    typecode: '050000',
    address: '测试地址',
    location: '121.4737,31.2304',
    distance: '500',
    ...overrides,
  };
}

describe('amapPoiSearch', () => {
  const originalAmapKey = process.env.AMAP_API_KEY;
  const originalAmapMaxQps = process.env.AMAP_MAX_QPS;
  const originalAmapMaxRetries = process.env.AMAP_MAX_RETRIES;
  const originalProviderMaxWaitMs = process.env.PROVIDER_MAX_WAIT_MS;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    if (originalAmapKey === undefined) {
      delete process.env.AMAP_API_KEY;
    } else {
      process.env.AMAP_API_KEY = originalAmapKey;
    }
    if (originalAmapMaxQps === undefined) {
      delete process.env.AMAP_MAX_QPS;
    } else {
      process.env.AMAP_MAX_QPS = originalAmapMaxQps;
    }
    if (originalAmapMaxRetries === undefined) {
      delete process.env.AMAP_MAX_RETRIES;
    } else {
      process.env.AMAP_MAX_RETRIES = originalAmapMaxRetries;
    }
    if (originalProviderMaxWaitMs === undefined) {
      delete process.env.PROVIDER_MAX_WAIT_MS;
    } else {
      process.env.PROVIDER_MAX_WAIT_MS = originalProviderMaxWaitMs;
    }
  });

  it('searches each keyword separately with keyword-specific POI types', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    const requestUrls: string[] = [];

    jest.doMock('@/lib/withTimeout', () => ({
      fetchWithTimeout: jest.fn(async (url: string) => {
        requestUrls.push(url);
        const params = new URL(url).searchParams;
        const keyword = params.get('keywords');

        return {
          ok: true,
          json: async () => ({
            status: '1',
            count: '1',
            info: 'OK',
            infocode: '10000',
            pois: [
              amapPoi({
                id: keyword === '川菜' ? 'sichuan' : 'coffee',
                name: keyword === '川菜' ? '川菜馆' : '咖啡店',
                type: keyword === '川菜'
                  ? '餐饮服务;中餐厅;川菜馆'
                  : '餐饮服务;咖啡厅;咖啡厅',
                distance: keyword === '川菜' ? '600' : '300',
              }),
            ],
          }),
        };
      }),
    }));

    const { amapPoiSearch } = await import('@/lib/amap');
    const restaurants = await amapPoiSearch(['川菜', '咖啡'], location, 1800, '050102', 3);

    const requests = requestUrls.map((url) => new URL(url).searchParams);
    expect(requests).toHaveLength(2);
    expect(requests.map((params) => params.get('keywords'))).toEqual(['川菜', '咖啡']);
    expect(requests.map((params) => params.get('types'))).toEqual(['050102', '050500']);
    expect(requests.some((params) => params.get('keywords')?.includes('|'))).toBe(false);
    expect(restaurants.map((restaurant) => restaurant.name)).toEqual(['咖啡店', '川菜馆']);
  });

  it('keeps the caller-provided POI type for a single unknown keyword', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    const requestUrls: string[] = [];

    jest.doMock('@/lib/withTimeout', () => ({
      fetchWithTimeout: jest.fn(async (url: string) => {
        requestUrls.push(url);

        return {
          ok: true,
          json: async () => ({
            status: '1',
            count: '1',
            info: 'OK',
            infocode: '10000',
            pois: [amapPoi()],
          }),
        };
      }),
    }));

    const { amapPoiSearch } = await import('@/lib/amap');
    await amapPoiSearch(['私房菜'], location, 1800, '050100', 1);

    const params = new URL(requestUrls[0]).searchParams;
    expect(params.get('keywords')).toBe('私房菜');
    expect(params.get('types')).toBe('050100');
  });

  it('normalizes sentence-like keywords before calling Amap', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    const requestUrls: string[] = [];

    jest.doMock('@/lib/withTimeout', () => ({
      fetchWithTimeout: jest.fn(async (url: string) => {
        requestUrls.push(url);

        return {
          ok: true,
          json: async () => ({
            status: '1',
            count: '1',
            info: 'OK',
            infocode: '10000',
            pois: [amapPoi({
              id: 'steak',
              name: '牛排馆',
              type: '餐饮服务;外国餐厅;西餐厅',
              typecode: '050201',
            })],
          }),
        };
      }),
    }));

    const { amapPoiSearch } = await import('@/lib/amap');
    await amapPoiSearch(['想吃牛排'], location, 1800, undefined, 1);

    const params = new URL(requestUrls[0]).searchParams;
    expect(params.get('keywords')).toBe('牛排');
    expect(params.get('types')).toBe('050201|050211');
  });

  it('caches successful Amap POI pages to avoid duplicate quota usage', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    const fetchWithTimeout = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: '1',
        count: '1',
        info: 'OK',
        infocode: '10000',
        pois: [amapPoi({ id: 'cache-hit' })],
      }),
    }));

    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { amapPoiSearch } = await import('@/lib/amap');
    await amapPoiSearch(['川菜'], location, 1800, undefined, 1);
    await amapPoiSearch(['川菜'], location, 1800, undefined, 1);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('retries once when Amap reports a QPS limit error', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    process.env.AMAP_MAX_RETRIES = '1';
    const fetchWithTimeout = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: '0',
          count: '0',
          info: 'ACCESS_TOO_FREQUENT',
          infocode: '10004',
          pois: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: '1',
          count: '1',
          info: 'OK',
          infocode: '10000',
          pois: [amapPoi({ id: 'retried' })],
        }),
      });

    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { amapPoiSearch } = await import('@/lib/amap');
    const restaurants = await amapPoiSearch(['川菜'], location, 1800, undefined, 1);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(restaurants.map((restaurant) => restaurant.id)).toEqual(['amap_retried']);
  });

  it('retries an HTTP 429 response instead of treating it as a configuration failure', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    process.env.AMAP_MAX_RETRIES = '1';
    const fetchWithTimeout = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: '1',
          count: '1',
          info: 'OK',
          infocode: '10000',
          pois: [amapPoi({ id: 'http-429-retried' })],
        }),
      });

    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { amapPoiSearch } = await import('@/lib/amap');
    const restaurants = await amapPoiSearch(['川菜'], location, 1800, undefined, 1);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
    expect(restaurants.map((restaurant) => restaurant.id)).toEqual(['amap_http-429-retried']);
  });

  it('does not retry exhausted quota and short-circuits subsequent requests', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    process.env.AMAP_MAX_RETRIES = '2';
    process.env.PROVIDER_MAX_WAIT_MS = '0';
    const fetchWithTimeout = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        status: '0',
        count: '0',
        info: 'DAILY_QUERY_OVER_LIMIT',
        infocode: '10003',
        pois: [],
      }),
    }));

    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { amapPoiSearch, AmapProviderError } = await import('@/lib/amap');
    const { ProviderSchedulerError } = await import('@/lib/providerScheduler');
    const first = await amapPoiSearch(['川菜'], location, 1800, undefined, 1)
      .catch((error) => error);
    const second = await amapPoiSearch(['粤菜'], location, 1800, undefined, 1)
      .catch((error) => error);

    expect(first).toBeInstanceOf(AmapProviderError);
    expect(first.category).toBe('quota_exhausted');
    expect(second).toBeInstanceOf(ProviderSchedulerError);
    expect(second.providerCategory).toBe('quota_exhausted');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('classifies account-level daily usage exhaustion as quota instead of QPS', async () => {
    process.env.AMAP_API_KEY = 'test-key';
    process.env.AMAP_MAX_QPS = '1000';
    process.env.AMAP_MAX_RETRIES = '2';
    const fetchWithTimeout = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: '0',
        count: '0',
        info: 'USER_DAILY_QUERY_OVER_LIMIT',
        infocode: '10044',
        pois: [],
      }),
    }));

    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { amapPoiSearch, AmapProviderError } = await import('@/lib/amap');
    const result = await amapPoiSearch(['川菜'], location, 1800, undefined, 1)
      .catch((error) => error);

    expect(result).toBeInstanceOf(AmapProviderError);
    expect(result.category).toBe('quota_exhausted');
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
