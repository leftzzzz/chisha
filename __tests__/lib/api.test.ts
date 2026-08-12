import { agentChat, APIError } from '@/lib/api';
import type { Location } from '@/types';
import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function streamFromEvents(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

describe('agentChat', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete (globalThis as typeof globalThis & { fetch?: unknown }).fetch;
    delete (globalThis as typeof globalThis & { TextDecoder?: unknown }).TextDecoder;
  });

  it('returns resumable paused questions from the chat endpoint', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        {
          type: 'question',
          sessionId: 'session-abc',
          question: '想吃正餐、小吃，还是喝点东西？',
          options: ['正餐', '小吃'],
          allowFreeText: true,
        },
        { type: 'session_paused', sessionId: 'session-abc' },
      ]),
    } as Response);

    const result = await agentChat('随便吃点', location);

    expect(result).toEqual({
      restaurants: [],
      candidates: [],
      sessionId: 'session-abc',
      paused: true,
      question: {
        sessionId: 'session-abc',
        question: '想吃正餐、小吃，还是喝点东西？',
        options: ['正餐', '小吃'],
        allowFreeText: true,
      },
    });
    expect((globalThis as typeof globalThis & { fetch: jest.Mock }).fetch).toHaveBeenCalledWith(
      '/api/agent/chat',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('still throws no results when the stream finishes without a result or question', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([]),
    } as Response);

    await expect(agentChat('想吃非常具体的菜', location)).rejects.toEqual(
      expect.objectContaining({
        name: 'APIError',
        code: 'NO_RESULTS',
      } satisfies Partial<APIError>)
    );
  });

  it('sends an opaque session id when resuming a conversation', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        {
          type: 'final',
          restaurants: [{
            id: 'r1',
            name: '测试餐厅',
            cuisineType: '餐饮',
            address: '测试地址',
            location,
            source: 'amap',
          }],
          candidates: [],
          explanation: '继续会话后找到餐厅。',
          unmetConstraints: [],
        },
        { type: 'session_updated', sessionId: 'session-next' },
      ]),
    } as Response);

    const result = await agentChat('继续找', location, undefined, undefined, 'session-prev');

    const fetchCall = (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch.mock.calls[0];
    expect(JSON.parse(fetchCall[1].body)).toEqual(
      expect.objectContaining({ sessionId: 'session-prev' })
    );
    expect(result.sessionId).toBe('session-next');
  });

  it('ignores heartbeat events without invoking business callbacks', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        { type: 'heartbeat', at: 1 },
        { type: 'heartbeat', at: 2 },
        {
          type: 'final',
          restaurants: [{
            id: 'r1',
            name: '测试餐厅',
            cuisineType: '餐饮',
            address: '测试地址',
            location,
            source: 'amap',
          }],
          candidates: [],
          explanation: '搜索完成。',
          unmetConstraints: [],
        },
      ]),
    } as Response);

    const onStatus = jest.fn();
    const onTrace = jest.fn();
    const result = await agentChat('想吃日料', location, { onStatus, onTrace });

    expect(onStatus).not.toHaveBeenCalled();
    expect(onTrace).not.toHaveBeenCalled();
    expect(result.restaurants).toHaveLength(1);
  });

  it('classifies stream errors by structured code', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        {
          type: 'error',
          message: '会话已过期，请重新发起搜索',
          code: 'SESSION_EXPIRED',
          recoverable: false,
        },
      ]),
    } as Response);

    await expect(agentChat('继续找', location)).rejects.toEqual(
      expect.objectContaining({
        name: 'APIError',
        code: 'SESSION_EXPIRED',
      } satisfies Partial<APIError>)
    );
  });

  it('returns updated opaque session ids after successful chat searches', async () => {
    const restaurants = [{
      id: 'r1',
      name: '寿司店',
      cuisineType: '日本料理',
      address: '测试地址',
      location,
      source: 'amap' as const,
    }];

    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        {
          type: 'final',
          restaurants,
          candidates: [],
          explanation: '已找到日料。',
          unmetConstraints: [],
        },
        { type: 'session_updated', sessionId: 'session-next' },
      ]),
    } as Response);

    const onSessionUpdated = jest.fn();
    const result = await agentChat('想吃日料', location, { onSessionUpdated });

    expect(result.sessionId).toBe('session-next');
    expect(onSessionUpdated).toHaveBeenCalledWith('session-next');
  });
});

function mockFetchResponse(response: Response): void {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue(response);
}
