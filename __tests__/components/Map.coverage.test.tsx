import { act, render, screen, waitFor } from '@testing-library/react';
import { Map } from '@/components/map/Map';
import type { Location, Restaurant } from '@/types';

interface MapMockState {
  maps: Array<Record<string, jest.Mock> & { options: Record<string, unknown> }>;
  markers: Array<Record<string, jest.Mock> & { options: Record<string, unknown>; handlers: Record<string, () => void> }>;
  infoWindows: Array<Record<string, jest.Mock> & { options: Record<string, unknown> }>;
}

function installAMap(): MapMockState {
  const state: MapMockState = { maps: [], markers: [], infoWindows: [] };
  class MockMap {
    options: Record<string, unknown>;
    on = jest.fn((event: string, callback: () => void) => {
      if (event === 'complete') queueMicrotask(callback);
    });
    destroy = jest.fn();
    setCenter = jest.fn();
    setZoom = jest.fn();
    setBounds = jest.fn();
    setZoomAndCenter = jest.fn();
    constructor(_container: HTMLElement, options: Record<string, unknown>) {
      this.options = options;
      state.maps.push(this as unknown as MapMockState['maps'][number]);
    }
  }
  class MockMarker {
    options: Record<string, unknown>;
    handlers: Record<string, () => void> = {};
    setMap = jest.fn();
    on = jest.fn((event: string, callback: () => void) => { this.handlers[event] = callback; });
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.markers.push(this as unknown as MapMockState['markers'][number]);
    }
  }
  class MockInfoWindow {
    options: Record<string, unknown>;
    open = jest.fn();
    close = jest.fn();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      state.infoWindows.push(this as unknown as MapMockState['infoWindows'][number]);
    }
  }
  class Point {
    constructor(public x: number, public y: number) {}
  }
  class LngLat {
    constructor(public lng: number, public lat: number) {}
  }
  class Bounds {
    constructor(public southwest: LngLat, public northeast: LngLat) {}
  }
  Object.defineProperty(window, 'AMap', {
    configurable: true,
    value: { Map: MockMap, Marker: MockMarker, InfoWindow: MockInfoWindow, Pixel: Point, LngLat, Bounds },
  });
  return state;
}

function restaurant(id: string, overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id,
    name: `餐厅${id}`,
    cuisineType: '川菜',
    rating: 4.6,
    averagePrice: 88,
    distance: 1250,
    address: '南京西路 1 号',
    phone: '021-12345678',
    location: { lng: 121.47, lat: 31.23 },
    source: 'amap',
    ...overrides,
  };
}

describe('Map', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.useFakeTimers();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
    Object.defineProperty(window, 'AMap', { configurable: true, value: undefined });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates markers, bounds and rich info windows with a preloaded SDK', async () => {
    const amap = installAMap();
    const onMarkerClick = jest.fn();
    const first = restaurant('1');
    const second = restaurant('2', { cuisineType: '', rating: Number.NaN, averagePrice: 0, distance: 500, address: '', phone: undefined, location: { lat: 31.24, lng: 121.48 } });
    const invalid = restaurant('bad', { location: { lat: Number.NaN, lng: 1 } });
    const userLocation: Location = { lat: 31.22, lng: 121.46 };

    const view = render(
      <Map restaurants={[first, second, invalid]} selectedRestaurant={first} focusedRestaurant={second} userLocation={userLocation} onMarkerClick={onMarkerClick} className="map-class" />
    );
    await waitFor(() => expect(screen.queryByText('加载地图中…')).not.toBeInTheDocument());
    expect(amap.maps[0].options).toMatchObject({ center: [121.46, 31.22], zoom: 14 });
    await waitFor(() => expect(amap.markers.length).toBe(3));
    expect(amap.maps[0].setBounds).toHaveBeenCalled();

    act(() => amap.markers[0].handlers.click());
    expect(onMarkerClick).toHaveBeenCalledWith(first);
    expect(String(amap.infoWindows[0].options.content)).toContain('¥88/人');
    expect(String(amap.infoWindows[0].options.content)).toContain('1.3公里');
    act(() => amap.markers[1].handlers.click());
    expect(amap.infoWindows[0].close).toHaveBeenCalled();
    expect(String(amap.infoWindows[1].options.content)).toContain('美食');
    expect(String(amap.infoWindows[1].options.content)).toContain('500米');
    expect(String(amap.infoWindows[1].options.content)).toContain('地址未知');

    act(() => jest.runAllTimers());
    expect(amap.maps[0].setZoomAndCenter).toHaveBeenCalledTimes(2);

    view.rerender(<Map restaurants={[second]} selectedRestaurant={null} />);
    await waitFor(() => expect(amap.maps[0].setCenter).toHaveBeenCalledWith([121.48, 31.24]));
    expect(amap.maps[0].setZoom).toHaveBeenCalledWith(15);
    expect(amap.markers.some((marker) => marker.setMap.mock.calls.some(([map]) => map === null))).toBe(true);
    view.unmount();
    expect(amap.maps[0].destroy).toHaveBeenCalled();
  });

  it.each([
    ['center', { center: { lat: 10, lng: 20 }, userLocation: { lat: 11, lng: 21 }, restaurants: [restaurant('r')] }, [20, 10]],
    ['restaurant', { center: { lat: Infinity, lng: 1 }, userLocation: { lat: 1, lng: Number.NaN }, restaurants: [restaurant('r', { location: { lat: 30, lng: 120 } })] }, [120, 30]],
    ['default', { center: undefined, userLocation: undefined, restaurants: [] }, [114.05, 22.55]],
  ])('chooses the %s initial center fallback', async (_label, props, expected) => {
    const amap = installAMap();
    const view = render(<Map {...props} selectedRestaurant={null} />);
    await waitFor(() => expect(amap.maps).toHaveLength(1));
    expect(amap.maps[0].options.center).toEqual(expected);
    view.unmount();
  });

  it('loads the script from server config and handles all script/config failures', async () => {
    const append = jest.spyOn(document.head, 'appendChild');
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ amapKey: ' key value ' }) });
    const success = render(<Map restaurants={[]} selectedRestaurant={null} />);
    await waitFor(() => expect(append).toHaveBeenCalled());
    const script = append.mock.calls[0][0] as HTMLScriptElement;
    expect(script.src).toContain('key=key%20value');
    installAMap();
    act(() => script.onload?.(new Event('load')));
    await waitFor(() => expect(screen.queryByText('加载地图中…')).not.toBeInTheDocument());
    success.unmount();

    Object.defineProperty(window, 'AMap', { configurable: true, value: undefined });
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
    const missing = render(<Map restaurants={[]} selectedRestaurant={null} />);
    await waitFor(() => expect(screen.getByText('地图 API Key 未配置')).toBeInTheDocument());
    missing.unmount();

    (fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    const network = render(<Map restaurants={[]} selectedRestaurant={null} />);
    await waitFor(() => expect(screen.getByText('地图 API Key 未配置')).toBeInTheDocument());
    network.unmount();

    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ amapKey: 'key' }) });
    const failedScript = render(<Map restaurants={[]} selectedRestaurant={null} />);
    await waitFor(() => expect(append.mock.calls.length).toBeGreaterThan(1));
    const failed = append.mock.calls.at(-1)?.[0] as HTMLScriptElement;
    act(() => failed.onerror?.(new Event('error')));
    await waitFor(() => expect(screen.getByText('地图加载失败')).toBeInTheDocument());
    failedScript.unmount();

    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ amapKey: 'key' }) });
    const emptySdk = render(<Map restaurants={[]} selectedRestaurant={null} />);
    await waitFor(() => expect(append.mock.calls.length).toBeGreaterThan(2));
    const empty = append.mock.calls.at(-1)?.[0] as HTMLScriptElement;
    act(() => empty.onload?.(new Event('load')));
    await waitFor(() => expect(screen.getByText('地图加载失败')).toBeInTheDocument());
    emptySdk.unmount();
  });
});
