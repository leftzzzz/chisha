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
});

function mockFetchResponse(response: Response): void {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue(response);
}
