/**
 * @jest-environment node
 */

import { GET, DELETE } from '@/app/api/agent/session/[id]/route';
import {
  createAgentSession,
  getAgentSession,
  resetAgentSessionStore,
} from '@/lib/agent/session';
import { getSessionOwner } from '@/lib/agent/sessionOwner';

const location = { lat: 31.2304, lng: 121.4737, address: '上海市黄浦区' };

describe('/api/agent/session/[id]', () => {
  const originalSecret = process.env.SESSION_OWNER_SECRET;

  beforeEach(() => {
    process.env.SESSION_OWNER_SECRET = 'session-route-test-secret';
    resetAgentSessionStore();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SESSION_OWNER_SECRET;
    else process.env.SESSION_OWNER_SECRET = originalSecret;
    resetAgentSessionStore();
  });

  async function ownerCookie(): Promise<{ ownerId: string; cookie: string }> {
    const owner = await getSessionOwner(new Request('https://example.com'));
    return {
      ownerId: owner.ownerId,
      cookie: owner.setCookie!.split(';', 1)[0],
    };
  }

  function request(cookie: string, suffix: string, method = 'GET'): Request {
    return new Request(`https://example.com/api/agent/session/id?include=trace`, {
      method,
      headers: {
        cookie,
        'x-forwarded-for': `198.51.100.${suffix}`,
      },
    });
  }

  it('returns an owned session and refreshes its owner cookie', async () => {
    const owner = await ownerCookie();
    const session = createAgentSession('想吃川菜', location, owner.ownerId);

    const response = await GET(request(owner.cookie, '41'), {
      params: Promise.resolve({ id: session.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=3600');
    expect((await response.json()).id).toBe(session.id);
  });

  it('does not reveal or delete a session to another signed owner', async () => {
    const owner = await ownerCookie();
    const other = await ownerCookie();
    const session = createAgentSession('想吃川菜', location, owner.ownerId);
    const context = { params: Promise.resolve({ id: session.id }) };

    const readResponse = await GET(request(other.cookie, '42'), context);
    const deleteResponse = await DELETE(request(other.cookie, '43', 'DELETE'), context);

    expect(readResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
    expect(getAgentSession(session.id)).not.toBeNull();
  });
});
