/**
 * @jest-environment node
 */

jest.mock('@/app/api/agent/chat/route', () => ({
  POST: jest.fn(),
}));

import { POST as chatPOST } from '@/app/api/agent/chat/route';
import { GET, POST } from '@/app/api/agent/search/route';

const mockChatPOST = jest.mocked(chatPOST);

describe('/api/agent/search compatibility route', () => {
  beforeEach(() => {
    mockChatPOST.mockReset();
    mockChatPOST.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('maps the legacy query field to message and preserves request context', async () => {
    const response = await POST(new Request('https://example.com/api/agent/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'request-123',
      },
      body: JSON.stringify({
        query: '附近的川菜',
        sessionId: 'session-1',
        location: { lat: 31.2304, lng: 121.4737 },
      }),
    }));

    expect(response.status).toBe(204);
    expect(mockChatPOST).toHaveBeenCalledTimes(1);

    const delegatedRequest = mockChatPOST.mock.calls[0][0];
    expect(delegatedRequest.headers.get('x-request-id')).toBe('request-123');
    expect(await delegatedRequest.json()).toEqual({
      message: '附近的川菜',
      sessionId: 'session-1',
      location: { lat: 31.2304, lng: 121.4737 },
    });
  });

  it('preserves the current message shape when no legacy query is present', async () => {
    await POST(new Request('https://example.com/api/agent/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '想吃火锅', sessionId: 'session-2' }),
    }));

    const delegatedRequest = mockChatPOST.mock.calls[0][0];
    expect(await delegatedRequest.json()).toEqual({
      message: '想吃火锅',
      sessionId: 'session-2',
    });
  });

  it('rejects malformed JSON without entering the main Agent route', async () => {
    const response = await POST(new Request('https://example.com/api/agent/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mockChatPOST).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON without entering the main Agent route', async () => {
    const response = await POST(new Request('https://example.com/api/agent/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('附近的川菜'),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid request parameters' });
    expect(mockChatPOST).not.toHaveBeenCalled();
  });

  it('rejects GET requests', async () => {
    const response = await GET();

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed' });
  });
});
