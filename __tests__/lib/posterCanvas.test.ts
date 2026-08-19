import { generatePosterCanvas } from '@/lib/posterCanvas';
import type { CustomOption, Restaurant } from '@/types';

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'r1',
    name: '江南小馆',
    cuisineType: '本帮菜',
    distance: 1250,
    rating: 4.6,
    address: '上海市黄浦区',
    location: { lat: 31.23, lng: 121.47 },
    source: 'amap',
    ...overrides,
  };
}

function installCanvas() {
  const gradient = { addColorStop: jest.fn() };
  const context = new Proxy(
    {
      measureText: jest.fn((value: string) => ({ width: value.length * 20 })),
      createRadialGradient: jest.fn(() => gradient),
      createLinearGradient: jest.fn(() => gradient),
    } as Record<string, unknown>,
    {
      get(target, property: string) {
        if (!(property in target)) target[property] = jest.fn();
        return target[property];
      },
    }
  );
  const getContext = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  const toDataURL = jest
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue('data:image/png;base64,poster');
  return { context, getContext, toDataURL };
}

describe('generatePosterCanvas', () => {
  const OriginalImage = globalThis.Image;

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: OriginalImage });
  });

  it('draws a restaurant poster with QR code and distance/rating tags', async () => {
    const { context, toDataURL } = installCanvas();
    class LoadedImage {
      crossOrigin = '';
      onload?: () => void;
      onerror?: (error: unknown) => void;
      set src(_value: string) { this.onload?.(); }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: LoadedImage });
    jest.spyOn(Math, 'random').mockReturnValue(0.3);

    const selected = restaurant();
    await expect(generatePosterCanvas({
      query: '附近好吃的',
      selectedOption: selected,
      allOptions: [selected, restaurant({ id: 'r2', name: '另一家' })],
      qrCodeDataUrl: 'data:image/png;base64,qr',
    })).resolves.toBe('data:image/png;base64,poster');

    expect(toDataURL).toHaveBeenCalledWith('image/png', 1);
    expect((context.measureText as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect((context.drawImage as jest.Mock)).toHaveBeenCalled();
  });

  it('handles custom options, long names, no QR and failed QR image loads', async () => {
    const { context } = installCanvas();
    class BrokenImage {
      crossOrigin = '';
      onload?: () => void;
      onerror?: (error: unknown) => void;
      set src(_value: string) { this.onerror?.(new Error('bad image')); }
    }
    Object.defineProperty(globalThis, 'Image', { configurable: true, value: BrokenImage });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const selected: CustomOption = { id: 'custom-1', name: '这是一个非常非常长的自定义选项', isCustom: true };
    await expect(generatePosterCanvas({
      query: '',
      selectedOption: selected,
      allOptions: [selected],
      qrCodeDataUrl: 'broken',
    })).resolves.toContain('data:image/png');
    expect((context.drawImage as jest.Mock)).not.toHaveBeenCalled();
  });

  it('rejects missing selection and unavailable canvas contexts', async () => {
    installCanvas();
    await expect(generatePosterCanvas({
      query: '',
      selectedOption: undefined as never,
      allOptions: [],
      qrCodeDataUrl: '',
    })).rejects.toThrow('selectedOption is required');

    jest.restoreAllMocks();
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const selected = restaurant({ name: '空上下文' });
    await expect(generatePosterCanvas({
      query: '',
      selectedOption: selected,
      allOptions: [selected],
      qrCodeDataUrl: '',
    })).rejects.toThrow('Failed to get canvas context');
  });
});
