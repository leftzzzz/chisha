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

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    if (originalAmapKey === undefined) {
      delete process.env.AMAP_API_KEY;
    } else {
      process.env.AMAP_API_KEY = originalAmapKey;
    }
  });

  it('searches each keyword separately with keyword-specific POI types', async () => {
    process.env.AMAP_API_KEY = 'test-key';
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
    expect(requests.map((params) => params.get('types'))).toEqual(['050102', '050401']);
    expect(requests.some((params) => params.get('keywords')?.includes('|'))).toBe(false);
    expect(restaurants.map((restaurant) => restaurant.name)).toEqual(['咖啡店', '川菜馆']);
  });

  it('keeps the caller-provided POI type for a single unknown keyword', async () => {
    process.env.AMAP_API_KEY = 'test-key';
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
});
