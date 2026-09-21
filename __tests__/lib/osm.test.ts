import { osmReverseGeocode, osmSearch } from '@/lib/osm';
import { ApiError, TimeoutError } from '@/types';

jest.mock('@/lib/withTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

jest.mock('@/lib/providerScheduler', () => ({
  getProviderSchedulerConfig: jest.fn(() => ({ maxInFlight: 2, ratePerSecond: 2, requestsPerMinute: 60, tokensPerMinute: 0, leaseTtlMs: 1000 })),
  providerSchedulerName: jest.fn((name: string) => name),
  runWithProviderLease: jest.fn(async (_name: string, _config: unknown, fn: (lease: unknown, signal: AbortSignal) => Promise<unknown>) => fn({}, new AbortController().signal)),
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { fetchWithTimeout } = jest.requireMock('@/lib/withTimeout') as { fetchWithTimeout: jest.Mock };

describe('OSM provider adapters', () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  it('transforms nodes and ways, filters by distance and sorts nearest first', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        elements: [
          { type: 'node', id: 1, lat: 31.2301, lon: 121.4701, tags: { name: '远店', amenity: 'restaurant', cuisine: '川菜', 'addr:street': '南京路', 'addr:housenumber': '1号', phone: '10086', opening_hours: '24/7' } },
          { type: 'way', id: 2, center: { lat: 31.23, lon: 121.47 }, tags: { name: '近店', 'name:zh': '近店中文', amenity: 'cafe' } },
          { type: 'node', id: 3, lat: 31.5, lon: 121.8, tags: { name: '超远' } },
          { type: 'node', id: 4, lat: 31.23, lon: 121.47, tags: {} },
          { type: 'relation', id: 5, tags: { name: '无坐标' } },
        ],
      }),
    });
    const result = await osmSearch(['川菜'], { lat: 31.23, lng: 121.47 }, 2000);
    expect(result.map((item) => item.name)).toEqual(['近店中文', '远店']);
    expect(result[0]).toMatchObject({ cuisineType: '咖啡厅', address: '地址未知', source: 'osm' });
    expect(result[1]).toMatchObject({ cuisineType: '川菜', address: '南京路 1号', phone: '10086' });
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://overpass-api.de/api/interpreter',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('data=') }),
      15000
    );
  });

  it('returns empty results and propagates HTTP/search failures', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ elements: [] }) });
    await expect(osmSearch([], { lat: 0, lng: 0 })).resolves.toEqual([]);
    fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(osmSearch([], { lat: 0, lng: 0 })).rejects.toThrow('OSM API error: 503');
    fetchWithTimeout.mockRejectedValueOnce(new Error('network down'));
    await expect(osmSearch([], { lat: 0, lng: 0 })).rejects.toThrow('network down');
  });

  it('parses Nominatim address fields and country fallback', async () => {
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Tokyo address', address: { province: '', country: 'Japan', town: 'Town', suburb: 'Suburb' } }),
    });
    await expect(osmReverseGeocode({ lat: 35, lng: 139 })).resolves.toEqual({
      address: 'Tokyo address', formattedAddress: 'Tokyo address', province: 'Japan', city: 'Town', district: 'Suburb',
    });
    expect(fetchWithTimeout).toHaveBeenCalledWith(expect.stringContaining('format=json'), expect.objectContaining({ headers: { 'User-Agent': 'Chisha-Restaurant-App/1.0' }, signal: expect.anything() }), 15000);
  });

  it('distinguishes empty responses, API errors, timeouts and unknown failures', async () => {
    fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({ display_name: '' }) });
    await expect(osmReverseGeocode({ lat: 1, lng: 2 })).rejects.toThrow('No address information found');
    fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
    await expect(osmReverseGeocode({ lat: 1, lng: 2 })).rejects.toThrow('Nominatim API error: 429');
    fetchWithTimeout.mockRejectedValueOnce(new TimeoutError('timed out'));
    await expect(osmReverseGeocode({ lat: 1, lng: 2 })).rejects.toBeInstanceOf(TimeoutError);
    fetchWithTimeout.mockRejectedValueOnce(new ApiError('X' as never, 'api failure'));
    await expect(osmReverseGeocode({ lat: 1, lng: 2 })).rejects.toThrow('api failure');
    fetchWithTimeout.mockRejectedValueOnce('plain failure');
    await expect(osmReverseGeocode({ lat: 1, lng: 2 })).rejects.toBe('plain failure');
  });
});
