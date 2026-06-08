/**
 * @jest-environment node
 */

import { dynamic, GET, revalidate } from '@/app/api/map/config/route';

const ENV_NAMES = [
  'NEXT_PUBLIC_AMAP_KEY',
  'AMAP_JS_API_KEY',
] as const;

describe('/api/map/config', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const envName of ENV_NAMES) {
      originalEnv.set(envName, process.env[envName]);
    }
  });

  beforeEach(() => {
    for (const envName of ENV_NAMES) {
      delete process.env[envName];
    }
  });

  afterAll(() => {
    for (const envName of ENV_NAMES) {
      const originalValue = originalEnv.get(envName);
      if (originalValue === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = originalValue;
      }
    }
  });

  it('opts out of static generation so runtime env vars can be read', () => {
    expect(dynamic).toBe('force-dynamic');
    expect(revalidate).toBe(0);
  });

  it('returns the runtime public Amap map key', async () => {
    process.env.NEXT_PUBLIC_AMAP_KEY = ' runtime-map-key ';

    const response = await GET();

    expect(await response.json()).toEqual({
      amapKey: 'runtime-map-key',
      configured: true,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('supports a server-only runtime alias for deployments', async () => {
    process.env.AMAP_JS_API_KEY = 'server-runtime-map-key';

    const response = await GET();

    expect(await response.json()).toEqual({
      amapKey: 'server-runtime-map-key',
      configured: true,
    });
  });
});
