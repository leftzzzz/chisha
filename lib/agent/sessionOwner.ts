const OWNER_COOKIE = 'chisha_owner';
// Sessions extend their 30-minute TTL when a run finishes. Keep the browser
// owner comfortably longer so a long run cannot outlive its authorization.
const OWNER_TTL_SECONDS = 60 * 60;

export class SessionOwnerConfigurationError extends Error {
  constructor() {
    super('SESSION_OWNER_SECRET is not configured securely');
    this.name = 'SessionOwnerConfigurationError';
  }
}

export interface SessionOwnerContext {
  ownerId: string;
  setCookie?: string;
}

export async function getSessionOwner(request: Request): Promise<SessionOwnerContext> {
  const secret = process.env.SESSION_OWNER_SECRET;
  if ((!secret || secret.length < 32) && process.env.NODE_ENV === 'production') {
    throw new SessionOwnerConfigurationError();
  }

  // Tests and local Next dev intentionally use a stable non-production owner so that
  // existing in-memory session fixtures remain useful without weakening production.
  if (!secret) {
    return { ownerId: 'local-test-owner' };
  }

  const cookieHeader = request.headers?.get?.('cookie') ?? null;
  const cookies = parseCookies(cookieHeader);
  const existing = cookies[OWNER_COOKIE];
  if (existing) {
    const ownerId = await verifyOwnerToken(existing, secret);
    if (ownerId) {
      // Refresh Max-Age on every authenticated request so the browser owner does
      // not expire before a session whose TTL was extended by the same request.
      return { ownerId, setCookie: serializeOwnerCookie(await createOwnerToken(ownerId, secret)) };
    }
  }

  const ownerId = createOwnerId();
  const token = await createOwnerToken(ownerId, secret);
  return {
    ownerId,
    setCookie: serializeOwnerCookie(token),
  };
}

export function sessionBelongsToOwner(
  sessionOwnerId: string | undefined,
  ownerId: string
): boolean {
  if (sessionOwnerId) {
    return sessionOwnerId === ownerId;
  }

  return process.env.NODE_ENV !== 'production';
}

export function claimLegacySessionOwner(
  session: { ownerId?: string },
  ownerId: string
): boolean {
  if (!session.ownerId && process.env.NODE_ENV !== 'production') {
    session.ownerId = ownerId;
    return true;
  }
  return false;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(';').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) {
        return ['', ''];
      }
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, ''];
      }
    }).filter(([key, value]) => Boolean(key && value))
  );
}

async function verifyOwnerToken(token: string, secret: string): Promise<string | null> {
  if (token.length > 1024) {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [ownerId, expiresAtRaw, signature] = parts;
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!ownerId || ownerId.length > 128
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  const expected = await sign(`${ownerId}.${expiresAtRaw}`, secret);
  return timingSafeEqual(signature, expected) ? ownerId : null;
}

async function createOwnerToken(ownerId: string, secret: string): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + OWNER_TTL_SECONDS;
  const payload = `${ownerId}.${expiresAt}`;
  return `${payload}.${await sign(payload, secret)}`;
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function createOwnerId(): string {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return toBase64Url(bytes);
}

function serializeOwnerCookie(token: string): string {
  const attributes = [
    `${OWNER_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${OWNER_TTL_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
