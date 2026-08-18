import { getSessionOwner, sessionBelongsToOwner } from '@/lib/agent/sessionOwner';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

describe('session owner cookie', () => {
  const originalSecret = process.env.SESSION_OWNER_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCrypto = globalThis.crypto;
  const originalTextEncoder = globalThis.TextEncoder;

  afterEach(() => {
    jest.useRealTimers();
    if (originalSecret === undefined) delete process.env.SESSION_OWNER_SECRET;
    else process.env.SESSION_OWNER_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: originalTextEncoder });
  });

  function request(cookie?: string): Request {
    return {
      headers: {
        get: (name: string) => name === 'cookie' ? cookie ?? null : null,
      },
    } as unknown as Request;
  }

  it('signs and verifies an owner cookie without accepting a forged value', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_OWNER_SECRET = 'test-secret';
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
    const first = await getSessionOwner(request());
    expect(first.setCookie).toContain('chisha_owner=');

    const cookie = first.setCookie!.split(';', 1)[0];
    const second = await getSessionOwner(request(cookie));
    expect(second.ownerId).toBe(first.ownerId);
    expect(second.setCookie).toContain('Max-Age=3600');
    expect(sessionBelongsToOwner(first.ownerId, second.ownerId)).toBe(true);

    const forged = await getSessionOwner(request(cookie.replace(first.ownerId, 'forged-owner')));
    expect(forged.ownerId).not.toBe('forged-owner');
  });

  it('does not treat an ownerless legacy session as public in production', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionBelongsToOwner(undefined, 'owner')).toBe(false);
  });

  it('rejects a replayed owner token after its server-side expiry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-18T00:00:00Z'));
    process.env.NODE_ENV = 'test';
    process.env.SESSION_OWNER_SECRET = 'test-secret';
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });

    const first = await getSessionOwner(request());
    const cookie = first.setCookie!.split(';', 1)[0];
    jest.setSystemTime(new Date('2026-08-18T01:00:01Z'));

    const expired = await getSessionOwner(request(cookie));
    expect(expired.ownerId).not.toBe(first.ownerId);
  });

  it('fails closed on a weak production signing secret', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SESSION_OWNER_SECRET = 'short';

    await expect(getSessionOwner(request())).rejects.toMatchObject({
      name: 'SessionOwnerConfigurationError',
    });
  });
});
