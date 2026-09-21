import { act, renderHook } from '@testing-library/react';
import { useLocation } from '@/hooks/useLocation';
import {
  BREAKPOINTS,
  useBreakpoint,
  useIsDesktop,
  useIsLandscape,
  useIsMobile,
  useIsPortrait,
  useIsTablet,
  useMediaQuery,
} from '@/hooks/useMediaQuery';
import { calculateItemPosition, useTurntable } from '@/hooks/useTurntable';
import { useAppState } from '@/hooks/useAppState';
import { geocode, reverseGeocode, APIError } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  geocode: jest.fn(),
  reverseGeocode: jest.fn(),
  APIError: class APIError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

jest.mock('@/hooks/useAppState', () => ({ useAppState: jest.fn() }));

describe('useLocation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('loads, expires and clears cached locations', () => {
    const cached = { location: { lat: 1, lng: 2, address: '缓存' }, timestamp: Date.now() };
    sessionStorage.setItem('chisha_last_location', JSON.stringify(cached));
    const { result } = renderHook(() => useLocation());
    expect(result.current.location).toEqual(cached.location);
    act(() => result.current.clearLocation());
    expect(result.current.location).toBeNull();
    expect(sessionStorage.getItem('chisha_last_location')).toBeNull();

    sessionStorage.setItem('chisha_last_location', JSON.stringify({ ...cached, timestamp: Date.now() - 31 * 60 * 1000 }));
    const second = renderHook(() => useLocation());
    expect(second.result.current.location).toBeNull();
    sessionStorage.setItem('chisha_last_location', '{bad');
    renderHook(() => useLocation());
    expect(sessionStorage.getItem('chisha_last_location')).toBeNull();
  });

  it('geocodes addresses and handles validation/API/unexpected failures', async () => {
    (geocode as jest.Mock).mockResolvedValueOnce({ lat: 3, lng: 4 });
    const { result } = renderHook(() => useLocation());
    await act(async () => expect(result.current.geocodeAddress(' 新地址 ', '上海')).resolves.toEqual({ lat: 3, lng: 4, address: ' 新地址 ' }));
    expect(result.current.location?.address).toBe(' 新地址 ');
    await act(async () => expect(result.current.geocodeAddress('   ')).resolves.toBeNull());
    expect(result.current.error).toBe('请输入地址');
    (geocode as jest.Mock).mockRejectedValueOnce(new APIError('BAD', 'API 错误'));
    await act(async () => expect(result.current.geocodeAddress('地址')).resolves.toBeNull());
    expect(result.current.error).toBe('API 错误');
    (geocode as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await act(async () => expect(result.current.geocodeAddress('地址')).resolves.toBeNull());
    expect(result.current.error).toBe('地址解析失败,请重新输入');
  });

  it('gets auto location with reverse geocoding success and fallback', async () => {
    const getCurrentPosition = jest.fn((resolve: PositionCallback) => resolve({ coords: { latitude: 10, longitude: 20 } } as GeolocationPosition));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });
    (reverseGeocode as jest.Mock).mockResolvedValueOnce('反向地址');
    const { result } = renderHook(() => useLocation());
    await act(async () => expect(result.current.getAutoLocation()).resolves.toEqual({ lat: 10, lng: 20, address: '反向地址' }));
    (reverseGeocode as jest.Mock).mockRejectedValueOnce(new Error('reverse failed'));
    await act(async () => expect(result.current.getAutoLocation()).resolves.toEqual({ lat: 10, lng: 20, address: '10.000000, 20.000000' }));

    const unsupported = renderHook(() => useLocation());
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined });
    await act(async () => expect(unsupported.result.current.getAutoLocation()).resolves.toBeNull());
    expect(unsupported.result.current.error).toContain('不支持');
  });

  it('maps geolocation error codes', async () => {
    class MockGeolocationPositionError extends Error {
      readonly PERMISSION_DENIED = 1;
      readonly POSITION_UNAVAILABLE = 2;
      readonly TIMEOUT = 3;

      constructor(readonly code: number) {
        super('geo');
      }
    }
    Object.defineProperty(globalThis, 'GeolocationPositionError', {
      configurable: true,
      value: MockGeolocationPositionError,
    });
    const errors = [
      [1, '定位权限被拒绝'], [2, '无法获取位置信息'], [3, '定位超时'], [99, '定位失败'],
    ] as const;
    for (const [code, message] of errors) {
      const error = new MockGeolocationPositionError(code);
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok: unknown, fail: (e: unknown) => void) => fail(error) } });
      const { result } = renderHook(() => useLocation());
      await act(async () => expect(result.current.getAutoLocation()).resolves.toBeNull());
      expect(result.current.error).toContain(message);
    }
  });
});

describe('media query hooks', () => {
  function installMediaQuery(matches: boolean, legacy = false) {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    const media = {
      matches,
      addEventListener: legacy ? undefined : (_type: string, cb: (event: MediaQueryListEvent) => void) => listeners.push(cb),
      removeEventListener: legacy ? undefined : (_type: string, cb: (event: MediaQueryListEvent) => void) => listeners.splice(listeners.indexOf(cb), 1),
      addListener: (cb: (event: MediaQueryListEvent) => void) => listeners.push(cb),
      removeListener: (cb: (event: MediaQueryListEvent) => void) => listeners.splice(listeners.indexOf(cb), 1),
    } as unknown as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => media) });
    return { media, listeners };
  }

  it('tracks modern and legacy media query listeners and predefined hooks', () => {
    const modern = installMediaQuery(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1px)'));
    expect(result.current).toBe(false);
    act(() => modern.listeners[0]?.({ matches: true } as MediaQueryListEvent));
    expect(result.current).toBe(true);
    unmount();
    installMediaQuery(true, true);
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
    expect(renderHook(() => useIsTablet()).result.current).toBe(true);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
    expect(renderHook(() => useIsLandscape()).result.current).toBe(true);
    expect(renderHook(() => useIsPortrait()).result.current).toBe(true);
    expect(BREAKPOINTS.desktop).toContain('1025');
  });

  it('selects breakpoint precedence', () => {
    const installBreakpoint = (mobile: boolean, tablet: boolean) => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: jest.fn((query: string) => ({
          matches: query === BREAKPOINTS.mobile ? mobile : tablet,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
        })),
      });
    };
    installBreakpoint(true, true);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('mobile');
    installBreakpoint(false, true);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('tablet');
    installBreakpoint(false, false);
    expect(renderHook(() => useBreakpoint()).result.current).toBe('desktop');
  });
});

describe('useTurntable', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (useAppState as jest.Mock).mockReturnValue({ state: { step: 'READY', selectedIndex: -1 }, setStep: jest.fn(), setSelectedIndex: jest.fn() });
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: (cb: FrameRequestCallback) => { cb(0); return 1; } });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: jest.fn() });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('calculates positions and guards invalid spin states', () => {
    expect(calculateItemPosition(0, 4, 10)).toEqual({ x: 10, y: 0, rotation: 0 });
    const { result, rerender } = renderHook(({ count }) => useTurntable(count), { initialProps: { count: 2 } });
    act(() => result.current.startSpin());
    expect(result.current.isSpinning).toBe(false);
    (useAppState as jest.Mock).mockReturnValue({ state: { step: 'READY', selectedIndex: -1 }, setStep: jest.fn(), setSelectedIndex: jest.fn() });
    rerender({ count: 3 });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    act(() => result.current.startSpin());
    expect(result.current.isSpinning).toBe(true);
    act(() => jest.runAllTimers());
    expect(result.current.isSpinning).toBe(false);
    act(() => result.current.reset());
    expect(result.current.rotation).toBe(0);
  });

  it('rejects non-ready and already-spinning states', () => {
    const setStep = jest.fn();
    const setSelectedIndex = jest.fn();
    (useAppState as jest.Mock).mockReturnValue({ state: { step: 'INPUT', selectedIndex: -1 }, setStep, setSelectedIndex });
    const { result } = renderHook(() => useTurntable(4));
    act(() => result.current.startSpin());
    expect(setStep).not.toHaveBeenCalled();
  });
});
