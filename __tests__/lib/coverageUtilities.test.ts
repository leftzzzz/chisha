import { deflateSync } from 'fflate';
import QRCode from 'qrcode';
import { TextDecoder, TextEncoder } from 'util';
import {
  compressShareData,
  decompressShareData,
  ShareData,
} from '@/lib/binaryCodec';
import {
  clearShareParamFromUrl,
  copyImageToClipboard,
  copyToClipboard,
  downloadImage,
  generateQRCode,
  generateShareUrl,
  getShareParamFromUrl,
  parseShareData,
} from '@/lib/share';
import { haversineDistance, isWithinRadius } from '@/lib/distance';
import { ERROR_CONFIG, getErrorInfo } from '@/lib/errorConfig';
import {
  getTurntableOptionCount,
  getTurntableOptions,
  hasTurntableCapacity,
  MAX_TURNTABLE_OPTIONS,
} from '@/lib/turntableOptions';
import { ErrorCode, error, errorFromException, success } from '@/lib/apiResponse';
import {
  LocationSchema,
  ParsedRequirementSchema,
  SearchRequestSchema,
} from '@/lib/validation';
import { fetchWithTimeout, withTimeout } from '@/lib/withTimeout';
import type { CustomOption, Restaurant } from '@/types';

Object.assign(globalThis, { TextEncoder, TextDecoder });

jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
}));

const restaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
  id: 'r1',
  name: '测试餐厅',
  cuisineType: '川菜',
  address: '测试地址',
  location: { lat: 31.2304, lng: 121.4737 },
  source: 'amap',
  ...overrides,
});

const custom = (id = 'c1'): CustomOption => ({ id, name: `选项 ${id}`, isCustom: true });

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function writeVarint(value: number, output: number[]) {
  while (value >= 128) {
    output.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  output.push(value);
}

function writeString(value: string, output: number[]) {
  const bytes = new TextEncoder().encode(value);
  writeVarint(bytes.length, output);
  output.push(...bytes);
}

function writeInt32(value: number, output: number[]) {
  output.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function writeUint16(value: number, output: number[]) {
  output.push(value & 0xff, (value >> 8) & 0xff);
}

describe('binary share codec', () => {
  it('round-trips restaurant and custom option data, including optional fields', () => {
    const data: ShareData = {
      query: '想吃很长的 🍜 需求',
      restaurants: [
        restaurant({
          id: 'amap-1',
          name: '超长餐厅名称',
          distance: 70000,
          rating: 4.7,
          source: 'amap',
        }),
        restaurant({
          id: 'osm-1',
          name: 'OSM 店',
          location: { lat: -12.345678, lng: 98.765432 },
          source: 'osm',
          distance: 0,
          rating: 0,
        }),
      ],
      customOptions: [custom('c1'), custom('c2')],
    };

    const encoded = compressShareData(data);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decompressShareData(encoded)).toEqual({
      query: data.query,
      restaurants: [
        expect.objectContaining({
          id: 'amap-1',
          source: 'amap',
          distance: 65535,
          rating: 4.7,
        }),
        expect.objectContaining({
          id: 'osm-1',
          source: 'osm',
          distance: undefined,
          rating: undefined,
        }),
      ],
      customOptions: data.customOptions,
    });
    expect(parseShareData(encoded)?.restaurants).toHaveLength(2);
  });

  it('handles unsupported versions, unknown source values and malformed payloads', () => {
    const raw: number[] = [1];
    writeString('', raw);
    writeVarint(1, raw);
    writeString('name', raw);
    writeString('food', raw);
    writeString('address', raw);
    writeInt32(1_000_000, raw);
    writeInt32(-2_000_000, raw);
    writeUint16(0, raw);
    raw.push(0); // rating
    writeString('id', raw);
    raw.push(99); // unknown source falls back to amap
    writeVarint(0, raw);

    const unsupported = raw.slice();
    unsupported[0] = 2;
    expect(decompressShareData(encodeBase64Url(deflateSync(new Uint8Array(unsupported))))).toBeNull();
    expect(decompressShareData('')).toBeNull();
    expect(decompressShareData('not-valid-deflate')).toBeNull();
    expect(parseShareData('not-valid-deflate')).toBeNull();

    expect(decompressShareData(encodeBase64Url(deflateSync(new Uint8Array(raw))))).toEqual({
      query: '',
      restaurants: [expect.objectContaining({ source: 'amap', distance: undefined, rating: undefined, location: { lat: 1, lng: -2 } })],
      customOptions: [],
    });
  });

  it('supports varint-sized collections and all base64 tail lengths', () => {
    const manyRestaurants = Array.from({ length: 130 }, (_, index) => restaurant({ id: `r-${index}`, name: `店${index}` }));
    const encoded = compressShareData({ query: 'x'.repeat(129), restaurants: manyRestaurants, customOptions: [] });
    expect(decompressShareData(encoded)?.restaurants).toHaveLength(130);

    // Different payload sizes exercise 1/2/3-byte base64 groups in both directions.
    for (const query of ['', 'a', 'ab', 'abc', 'abcd', '你好']) {
      const value = compressShareData({ query, restaurants: [], customOptions: [] });
      expect(decompressShareData(value)?.query).toBe(query);
    }
  });
});

describe('share helpers', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = jest.fn().mockReturnValue(true);
    jest.restoreAllMocks();
  });

  it('generates and reads share URLs in both supported formats', () => {
    const url = generateShareUrl('火锅', [restaurant()], [custom()]);
    expect(url.startsWith('http://localhost/?s=')).toBe(true);
    const param = new URL(url).searchParams.get('s');
    expect(param).toBeTruthy();
    expect(getShareParamFromUrl()).toBeNull();
    window.history.replaceState({}, '', `/?share=${param}`);
    expect(getShareParamFromUrl()).toBe(param);
    expect(parseShareData(param!).query).toBe('火锅');
    clearShareParamFromUrl();
    expect(window.location.search).toBe('');
  });

  it('copies through the secure clipboard and textarea fallback, including failure', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(copyToClipboard('secure')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('secure');

    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    await expect(copyToClipboard('fallback')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');

    (document.execCommand as jest.Mock).mockImplementation(() => { throw new Error('blocked'); });
    await expect(copyToClipboard('fails')).resolves.toBe(false);
  });

  it('generates QR codes, downloads images and copies image blobs', async () => {
    const qrcode = QRCode.toDataURL as jest.Mock;
    qrcode.mockResolvedValueOnce('data:image/png;base64,ok');
    await expect(generateQRCode('https://example.test', 128)).resolves.toBe('data:image/png;base64,ok');
    qrcode.mockRejectedValueOnce(new Error('qr failed'));
    await expect(generateQRCode('bad')).rejects.toThrow('qr failed');

    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadImage('data:image/png;base64,x', 'x.png');
    downloadImage('data:image/png;base64,x');
    expect(click).toHaveBeenCalled();

    const blob = new Blob(['x'], { type: 'image/png' });
    global.fetch = jest.fn().mockResolvedValue({ blob: async () => blob }) as jest.Mock;
    const write = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    Object.defineProperty(global, 'ClipboardItem', { configurable: true, value: FakeClipboardItem });
    await expect(copyImageToClipboard('data:image/png;base64,x')).resolves.toBe(true);
    expect(write).toHaveBeenCalled();

    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {} });
    await expect(copyImageToClipboard('data:image/png;base64,x')).resolves.toBe(false);
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await expect(copyImageToClipboard('bad')).resolves.toBe(false);
    click.mockRestore();
  });
});

describe('small pure helpers and schemas', () => {
  it('computes geographic distances and radius boundaries', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0);
    expect(haversineDistance(0, 0, 0, 1)).toBeGreaterThan(111000);
    expect(isWithinRadius(0, 0, 0, 0, 0)).toBe(true);
    expect(isWithinRadius(0, 0, 0, 1, 100)).toBe(false);
  });

  it('returns configured and fallback error information', () => {
    expect(Object.keys(ERROR_CONFIG).length).toBeGreaterThan(10);
    expect(getErrorInfo('MODEL_UNAVAILABLE').retryable).toBe(true);
    expect(getErrorInfo('brand-new-code')).toEqual(expect.objectContaining({ code: 'brand-new-code', retryable: true }));
  });

  it('combines turntable options and reports capacity', () => {
    const restaurants = Array.from({ length: MAX_TURNTABLE_OPTIONS }, (_, i) => restaurant({ id: `r${i}` }));
    expect(getTurntableOptions(restaurants, [custom()])).toHaveLength(MAX_TURNTABLE_OPTIONS);
    expect(getTurntableOptions(restaurants)).toHaveLength(MAX_TURNTABLE_OPTIONS);
    expect(getTurntableOptionCount(restaurants, [custom()])).toBe(MAX_TURNTABLE_OPTIONS);
    expect(getTurntableOptionCount(restaurants)).toBe(MAX_TURNTABLE_OPTIONS);
    expect(hasTurntableCapacity(restaurants)).toBe(false);
    expect(hasTurntableCapacity(restaurants.slice(0, 2), [custom()])).toBe(true);
  });

  it('normalizes API responses, exceptions and schema defaults', () => {
    expect(success({ ok: true })).toEqual({ success: true, data: { ok: true } });
    expect(error('X', 'bad')).toEqual({ success: false, error: { code: 'X', message: 'bad', details: undefined } });
    const customError = Object.assign(new Error('custom'), { code: 'CUSTOM' });
    expect(errorFromException(customError).error?.code).toBe('CUSTOM');
    expect(errorFromException(Object.assign(new Error('timeout'), { name: 'TimeoutError' })).error?.code).toBe(ErrorCode.TIMEOUT);
    expect(errorFromException(new Error('ordinary'), 'FALLBACK').error?.code).toBe('FALLBACK');
    expect(errorFromException('string', 'FALLBACK').error?.details).toEqual({ error: 'string' });

    expect(LocationSchema.parse({ lat: 1, lng: 2, address: ['first', 'second'] }).address).toBe('first');
    expect(LocationSchema.parse({ lat: 1, lng: 2, address: [] }).address).toBeUndefined();
    expect(ParsedRequirementSchema.parse({ keywords: ['火锅'], cuisineTypes: [] }).searchRadius).toBe(2000);
    expect(SearchRequestSchema.parse({ keywords: ['火锅'], location: { lat: 1, lng: 2 } })).toEqual(expect.objectContaining({ distance: 2000, count: 8 }));
  });
});

describe('timeout helpers', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves, rejects underlying failures and times out async work', async () => {
    await expect(withTimeout(async () => 'ok', 100)).resolves.toBe('ok');
    await expect(withTimeout(async () => { throw new Error('failed'); }, 100)).rejects.toThrow('failed');

    jest.useFakeTimers();
    const pending = withTimeout(() => new Promise<string>(() => undefined), 25);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    jest.advanceTimersByTime(25);
    await assertion;
  });

  it('propagates caller aborts, timeout aborts and ordinary fetch failures', async () => {
    const response = { ok: true } as unknown as Response;
    global.fetch = jest.fn().mockResolvedValue(response) as jest.Mock;
    await expect(fetchWithTimeout('/ok', undefined, 100)).resolves.toBe(response);

    const controller = new AbortController();
    (global.fetch as jest.Mock).mockImplementationOnce((_url: string, options: RequestInit) => (
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      })
    ));
    const aborted = fetchWithTimeout('/abort', { signal: controller.signal }, 100);
    controller.abort('caller');
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    (global.fetch as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('timed'), { name: 'AbortError' }));
    await expect(fetchWithTimeout('/timeout', undefined, 100)).rejects.toMatchObject({ name: 'TimeoutError' });
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await expect(fetchWithTimeout('/network', undefined, 100)).rejects.toThrow('network');
  });
});
