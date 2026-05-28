import { agentChat, agentSearch, APIError } from '@/lib/api';
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

describe('agentSearch', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete (globalThis as typeof globalThis & { fetch?: unknown }).fetch;
    delete (globalThis as typeof globalThis & { TextDecoder?: unknown }).TextDecoder;
  });

  it('returns a paused question instead of throwing no results', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([
        {
          type: 'question',
          sessionId: 'session-1',
          question: '没有找到符合条件的餐厅，要扩大范围或换个类型再搜吗？',
          options: ['扩大范围', '换个类型'],
          allowFreeText: true,
        },
        { type: 'session_paused', sessionId: 'session-1' },
      ]),
    } as Response);

    const onQuestion = jest.fn();
    const result = await agentSearch('想吃非常具体的菜', location, { onQuestion });

    expect(result).toEqual({
      restaurants: [],
      candidates: [],
      sessionId: 'session-1',
      paused: true,
      question: {
        sessionId: 'session-1',
        question: '没有找到符合条件的餐厅，要扩大范围或换个类型再搜吗？',
        options: ['扩大范围', '换个类型'],
        allowFreeText: true,
      },
    });
    expect(onQuestion).toHaveBeenCalledWith(result.question);
  });

  it('still throws no results when the stream finishes without a result or question', async () => {
    mockFetchResponse({
      ok: true,
      body: streamFromEvents([]),
    } as Response);

    await expect(agentSearch('想吃非常具体的菜', location)).rejects.toEqual(
      expect.objectContaining({
        name: 'APIError',
        code: 'NO_RESULTS',
      } satisfies Partial<APIError>)
    );
  });

  it('can send a resumable session token to the deprecated search endpoint', async () => {
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
        { type: 'session_updated', sessionId: 'agent_state_next' },
      ]),
    } as Response);

    const result = await agentSearch(
      '继续找',
      location,
      undefined,
      undefined,
      undefined,
      undefined,
      'agent_state_prev'
    );

    const fetchCall = (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch.mock.calls[0];
    expect(JSON.parse(fetchCall[1].body)).toEqual(
      expect.objectContaining({ sessionId: 'agent_state_prev' })
    );
    expect(result.sessionId).toBe('agent_state_next');
  });
});

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
          sessionId: 'agent_state_abc',
          question: '想吃正餐、小吃，还是喝点东西？',
          options: ['正餐', '小吃'],
          allowFreeText: true,
        },
        { type: 'session_paused', sessionId: 'agent_state_abc' },
      ]),
    } as Response);

    const result = await agentChat('随便吃点', location);

    expect(result).toEqual({
      restaurants: [],
      candidates: [],
      sessionId: 'agent_state_abc',
      paused: true,
      question: {
        sessionId: 'agent_state_abc',
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

  it('returns updated session tokens after successful chat searches', async () => {
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
        { type: 'session_updated', sessionId: 'agent_state_next' },
      ]),
    } as Response);

    const onSessionUpdated = jest.fn();
    const result = await agentChat('想吃日料', location, { onSessionUpdated });

    expect(result.sessionId).toBe('agent_state_next');
    expect(onSessionUpdated).toHaveBeenCalledWith('agent_state_next');
  });
});

function mockFetchResponse(response: Response): void {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue(response);
}
