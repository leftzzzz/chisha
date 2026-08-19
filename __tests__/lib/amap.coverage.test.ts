import type { Location, Restaurant } from '@/types';

const location: Location = { lat: 31.23, lng: 121.47, address: '上海' };

function poi(overrides: Record<string, unknown> = {}) {
  return {
    id: 'poi-1', name: '测试餐厅', type: '餐饮服务;中餐厅;川菜馆', typecode: '050102',
    address: '测试地址', location: '121.47,31.23', distance: '500',
    ...overrides,
  };
}

function amapResponse(overrides: Record<string, unknown> = {}) {
  return { status: '1', count: '1', info: 'OK', infocode: '10000', pois: [poi()], ...overrides };
}

function response(data: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: jest.fn(async () => data) };
}

interface SetupOptions {
  key?: string | null;
  securityCode?: string | null;
  maxRetries?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<unknown>;
  osmImpl?: (location: Location, signal?: AbortSignal) => Promise<unknown>;
  schedulerImpl?: (name: string, config: unknown, task: (lease: { probe: boolean; leaseId: string }, signal: AbortSignal) => Promise<unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
  probe?: boolean;
}

async function setup(options: SetupOptions = {}) {
  jest.resetModules();
  if (options.key === null) delete process.env.AMAP_API_KEY;
  else process.env.AMAP_API_KEY = options.key ?? 'test-key';
  if (options.securityCode === null || options.securityCode === undefined) delete process.env.AMAP_SECURITY_CODE;
  else process.env.AMAP_SECURITY_CODE = options.securityCode;
  process.env.AMAP_MAX_RETRIES = options.maxRetries ?? '0';
  process.env.AMAP_DETAIL_CONCURRENCY = '2';
  process.env.AMAP_SEARCH_CACHE_TTL_MS = '120000';

  const fetchWithTimeout = jest.fn(options.fetchImpl ?? (async () => response(amapResponse())));
  const osmReverseGeocode = jest.fn(options.osmImpl ?? (async () => ({ address: 'OSM 地址' })));
  const reportProviderFailure = jest.fn(async () => undefined);
  const reportProviderSuccess = jest.fn(async () => true);
  class MockProviderSchedulerError extends Error {
    constructor(
      message: string,
      public kind = 'blocked',
      public retryAfterMs = 1000,
      public providerCategory?: string
    ) { super(message); }
  }
  const runWithProviderLease = jest.fn(options.schedulerImpl ?? (async (
    _name: string,
    _config: unknown,
    task: (lease: { probe: boolean; leaseId: string }, signal: AbortSignal) => Promise<unknown>,
    runOptions?: { signal?: AbortSignal }
  ) => task(
    { probe: options.probe ?? true, leaseId: 'lease-1' },
    runOptions?.signal ?? new AbortController().signal
  )));
  jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));
  jest.doMock('@/lib/osm', () => ({ osmReverseGeocode }));
  jest.doMock('@/lib/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
  jest.doMock('@/lib/providerScheduler', () => ({
    getProviderSchedulerConfig: jest.fn(() => ({ maxInFlight: 1 })),
    providerSchedulerName: jest.fn((name: string) => `provider:${name}`),
    reportProviderFailure,
    reportProviderSuccess,
    runWithProviderLease,
    ProviderSchedulerError: MockProviderSchedulerError,
  }));
  const module = await import('@/lib/amap');
  return { module, fetchWithTimeout, osmReverseGeocode, reportProviderFailure, reportProviderSuccess, runWithProviderLease, MockProviderSchedulerError };
}

describe('Amap adapter coverage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('rejects missing keys and skips detail enrichment without data/config', async () => {
    const { module } = await setup({ key: null });
    await expect(module.amapPoiSearch(['川菜'], location)).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    await expect(module.amapGeocode('南京路')).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    await expect(module.amapReverseGeocode(location)).rejects.toMatchObject({ code: 'MISSING_API_KEY' });
    const restaurants = [{ id: 'osm-1' }] as Restaurant[];
    await expect(module.enrichRestaurantsWithAmapDetails(restaurants)).resolves.toBe(restaurants);
  });

  it('deduplicates richer POIs and brands while normalizing all optional fields', async () => {
    const pois = [
      poi({ id: 'same', name: '完整店', distance: '900' }),
      poi({ id: 'same', name: '完整店', distance: '300', tel: '10086', photos: [{ url: 'x' }], biz_ext: { rating: '4.8', cost: '88', opentime_week: '周一至周日', business_status: '营业中' } }),
      poi({ id: 'brand-1', name: '连锁品牌（人民店）', distance: '100', rating: 'bad', cost: '[]', opentime: '10:00-20:00', business_status: '暂停营业', type: '餐饮服务;', tel: '' }),
      poi({ id: 'brand-2', name: '连锁品牌(徐汇店)', distance: '200' }),
      poi({ id: 'unknown', name: '', distance: 'bad', type: '', rating: '[]', business_status: '待确认', address: '', location: '120,30' }),
    ];
    const urls: string[] = [];
    const { module, reportProviderSuccess } = await setup({
      securityCode: 'security-signature',
      fetchImpl: async (url) => { urls.push(url); return response(amapResponse({ count: String(pois.length), pois })); },
    });
    const result = await module.amapPoiSearch(['川菜'], location, 2000, undefined, 1, { preferProvidedPoiType: false });
    expect(result.map((item) => item.id)).toEqual(['amap_brand-1', 'amap_same', 'amap_unknown']);
    expect(result[0]).toMatchObject({ cuisineType: '餐饮', openingHours: '10:00-20:00', businessStatus: 'closed' });
    expect(result[1]).toMatchObject({ rating: 4.8, averagePrice: 88, openingHours: '周一至周日', businessStatus: 'open', distance: 300 });
    expect(result[2]).toMatchObject({ cuisineType: '餐饮', businessStatus: 'unknown', location: { lng: 120, lat: 30 } });
    expect(result[2].rating).toBeUndefined();
    expect(urls[0]).toContain('sig=security-signature');
    expect(reportProviderSuccess).toHaveBeenCalledWith('provider:amap', 'lease-1');
  });

  it('paginates full result pages, stops on empty later pages and checks aborts', async () => {
    let call = 0;
    const urls: string[] = [];
    const fullPage = Array.from({ length: 20 }, (_, index) => poi({ id: `p${index}`, name: `独立店${index}`, distance: String(index + 1) }));
    const { module } = await setup({ fetchImpl: async (url) => {
      urls.push(url);
      call += 1;
      return response(amapResponse(call === 1 ? { count: '40', pois: fullPage } : { count: '40', pois: [] }));
    } });
    await expect(module.amapPoiSearch(['川菜'], location, 2000, undefined, 99)).resolves.toHaveLength(20);
    expect(urls.map((url) => new URL(url).searchParams.get('page'))).toEqual(['1', '2']);

    const controller = new AbortController();
    controller.abort();
    await expect(module.amapPoiSearch(['粤菜'], location, 2000, undefined, 1, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enriches Amap records in batches while preserving identity and tolerating detail failures', async () => {
    const { module } = await setup({ fetchImpl: async (url) => {
      const id = new URL(url).searchParams.get('id');
      if (id === 'good') return response(amapResponse({ pois: [poi({ id: 'changed', rating: '4.9', cost: '120', distance: '999' })] }));
      if (id === 'empty') return response(amapResponse({ pois: [] }));
      throw new Error('detail unavailable');
    } });
    const inputs: Restaurant[] = [
      { id: 'amap_good', name: 'Good', cuisineType: '菜', distance: 10, address: '', location, source: 'amap' },
      { id: 'amap_empty', name: 'Empty', cuisineType: '菜', distance: 20, address: '', location, source: 'amap' },
      { id: 'amap_fail', name: 'Fail', cuisineType: '菜', distance: 30, address: '', location, source: 'amap' },
      { id: 'osm-1', name: 'OSM', cuisineType: '菜', address: '', location, source: 'osm' },
    ];
    const result = await module.enrichRestaurantsWithAmapDetails(inputs, 4);
    expect(result[0]).toMatchObject({ id: 'amap_good', rating: 4.9, averagePrice: 120, distance: 10 });
    expect(result[1]).toEqual(inputs[1]);
    expect(result[2]).toEqual(inputs[2]);
    expect(result[3]).toEqual(inputs[3]);
  });

  it('propagates aborts during detail enrichment and before a batch', async () => {
    const abort = new Error('abort');
    abort.name = 'AbortError';
    const { module } = await setup({ fetchImpl: async () => { throw abort; } });
    const input = [{ id: 'amap_abort', name: 'A', cuisineType: '菜', address: '', location, source: 'amap' }] as Restaurant[];
    await expect(module.enrichRestaurantsWithAmapDetails(input)).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController();
    controller.abort();
    await expect(module.enrichRestaurantsWithAmapDetails(input, 10, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('geocodes with optional city and rejects empty geocode arrays', async () => {
    const urls: string[] = [];
    const { module } = await setup({ fetchImpl: async (url) => {
      urls.push(url);
      return response(amapResponse({ geocodes: url.includes('empty') ? [] : [{ location: '121.5,31.2', formatted_address: '上海南京路' }], pois: undefined }));
    } });
    await expect(module.amapGeocode('南京路', '上海')).resolves.toEqual({ lng: 121.5, lat: 31.2, address: '上海南京路' });
    expect(new URL(urls[0]).searchParams.get('city')).toBe('上海');
    await expect(module.amapGeocode('empty')).rejects.toMatchObject({ code: 'GEOCODE_NO_RESULTS' });
  });

  it('parses reverse geocode strings/arrays and falls back to OSM on invalid data', async () => {
    const replies = [
      amapResponse({ regeocode: { formatted_address: ['数组地址'], addressComponent: { province: '省', city: '市', district: '区' } }, pois: undefined }),
      amapResponse({ regeocode: { formatted_address: '   ' }, pois: undefined }),
      amapResponse({ regeocode: undefined, pois: undefined }),
    ];
    const { module, osmReverseGeocode } = await setup({ fetchImpl: async () => response(replies.shift()) });
    await expect(module.amapReverseGeocode(location)).resolves.toEqual({ address: '数组地址', formattedAddress: '数组地址', province: '省', city: '市', district: '区' });
    await expect(module.amapReverseGeocode({ ...location, lat: 31.24 })).resolves.toEqual({ address: 'OSM 地址' });
    await expect(module.amapReverseGeocode({ ...location, lat: 31.25 })).resolves.toEqual({ address: 'OSM 地址' });
    expect(osmReverseGeocode).toHaveBeenCalledTimes(2);
  });

  it('uses signed coordinate fallback and propagates aborts from either provider', async () => {
    const { module } = await setup({
      fetchImpl: async () => response(amapResponse({ regeocode: {}, pois: undefined })),
      osmImpl: async () => { throw 'osm failed'; },
    });
    await expect(module.amapReverseGeocode({ lat: -36.2, lng: -138.25 })).resolves.toMatchObject({ address: '36.20°S, 138.25°W' });

    const amapAbort = new Error('amap abort');
    amapAbort.name = 'AbortError';
    const first = await setup({ fetchImpl: async () => { throw amapAbort; } });
    await expect(first.module.amapReverseGeocode(location)).rejects.toMatchObject({ name: 'AbortError' });

    const osmAbort = new Error('osm abort');
    osmAbort.name = 'AbortError';
    const second = await setup({
      fetchImpl: async () => response({}, false, 503),
      osmImpl: async () => { throw osmAbort; },
    });
    await expect(second.module.amapReverseGeocode(location)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    [429, 'rate_limited', true],
    [503, 'unavailable', true],
    [400, 'configuration', false],
  ])('classifies HTTP %s failures as %s', async (status, category, retryable) => {
    const { module, reportProviderFailure } = await setup({ fetchImpl: async () => response({}, false, status) });
    const error = await module.amapPoiSearch([`http-${status}`], location).catch((caught) => caught);
    expect(error).toBeInstanceOf(module.AmapProviderError);
    expect(error).toMatchObject({ category, retryable });
    if (category === 'rate_limited') expect(reportProviderFailure).not.toHaveBeenCalled();
    else expect(reportProviderFailure).toHaveBeenCalled();
  });

  it.each([
    ['INVALID_USER_KEY', '10001', 'configuration'],
    ['QUOTA_PLAN_RUN_OUT', '99999', 'quota_exhausted'],
    ['service unavailable', '99998', 'unavailable'],
    ['QPS limit', '99997', 'rate_limited'],
  ])('classifies Amap business failure %s', async (info, infocode, category) => {
    const { module } = await setup({ fetchImpl: async () => response(amapResponse({ status: '0', info, infocode, pois: [] })) });
    const error = await module.amapPoiSearch([info], location).catch((caught) => caught);
    expect(error).toMatchObject({ category });
  });

  it('passes scheduler failures through and records terminal network failures', async () => {
    let SchedulerError: new (...args: never[]) => Error;
    const blocked = await setup({ schedulerImpl: async () => { throw new Error('placeholder'); } });
    SchedulerError = blocked.MockProviderSchedulerError as unknown as new (...args: never[]) => Error;
    blocked.runWithProviderLease.mockRejectedValueOnce(new SchedulerError());
    await expect(blocked.module.amapPoiSearch(['blocked'], location)).rejects.toBeInstanceOf(SchedulerError);

    const network = await setup({ fetchImpl: async () => { throw 'plain network failure'; } });
    await expect(network.module.amapPoiSearch(['network'], location)).rejects.toBe('plain network failure');
    expect(network.reportProviderFailure).toHaveBeenCalledWith('provider:amap', 'unavailable', expect.any(Number));
  });
});
