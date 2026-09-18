import { fetchWithClientAbortBridge } from '@/lib/workerClientAbort';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

class TestRequest extends URL {
  readonly method: string;
  readonly signal: AbortSignal;

  constructor(input: URL | string, init: { method?: string; signal?: AbortSignal } = {}) {
    super(input.toString());
    this.method = init.method ?? (input instanceof TestRequest ? input.method : 'GET');
    this.signal = init.signal ?? (input instanceof TestRequest ? input.signal : new AbortController().signal);
  }
}

class TestResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | string;

  constructor(body: ReadableStream<Uint8Array> | string, init: ResponseInit = {}) {
    this.body = typeof body === 'string'
      ? new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      })
      : body;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.headers = new Headers(init.headers);
  }

  async text(): Promise<string> {
    if (typeof this.body === 'string') return this.body;
    const decoder = new TextDecoder();
    let result = '';
    const reader = this.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    return result;
  }
}

beforeAll(() => {
  globalThis.Request = TestRequest as unknown as typeof globalThis.Request;
  globalThis.Response = TestResponse as unknown as typeof globalThis.Response;
  globalThis.ReadableStream = ReadableStream as unknown as typeof globalThis.ReadableStream;
  globalThis.TextEncoder = TextEncoder;
});

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
        return;
      }
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-test': 'kept' } });
}

describe('fetchWithClientAbortBridge', () => {
  it('aborts the route request when the client cancels the response stream', async () => {
    let routeSignal: AbortSignal | undefined;
    const response = await fetchWithClientAbortBridge(
      async (request) => {
        routeSignal = request.signal;
        return streamingResponse(['data: first\n\n', 'data: second\n\n']);
      },
      new Request('https://chisha.leftzzzz.top/api/agent/chat', { method: 'POST' }),
      {},
      {}
    );

    expect(routeSignal?.aborted).toBe(false);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(routeSignal?.aborted).toBe(true);
  });

  it('preserves response metadata and completes without aborting a healthy stream', async () => {
    let routeSignal: AbortSignal | undefined;
    const response = await fetchWithClientAbortBridge(
      async (request) => {
        routeSignal = request.signal;
        return streamingResponse(['data: first\n\n']);
      },
      new Request('https://chisha.leftzzzz.top/api/agent/chat', { method: 'POST' }),
      {},
      {}
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('x-test')).toBe('kept');
    expect(await response.text()).toBe('data: first\n\n');
    expect(routeSignal?.aborted).toBe(false);
  });

  it('forwards aborts that happen before response headers', async () => {
    const request = new Request('https://chisha.leftzzzz.top/api/agent/chat', { method: 'POST' });
    const controller = new AbortController();
    const signal = controller.signal;
    const response = await fetchWithClientAbortBridge(
      async (routeRequest) => {
        controller.abort();
        return new Response(routeRequest.signal.aborted ? 'aborted' : 'active');
      },
      new Request(request, { signal }),
      {},
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('aborted');
  });

  it('removes the request abort listener after healthy stream completion', async () => {
    const listeners = new Map<string, Array<() => void>>();
    const signal = {
      aborted: false,
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: () => void) {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
      },
    } as AbortSignal;
    const response = await fetchWithClientAbortBridge(
      () => streamingResponse(['data: done\n\n']),
      new Request('https://chisha.leftzzzz.top/api/agent/chat', { method: 'POST', signal }),
      {},
      {}
    );

    expect(await response.text()).toBe('data: done\n\n');
    expect(listeners.get('abort')).toEqual([]);
  });

  it('removes the request abort listener when the handler throws', async () => {
    const listeners = new Map<string, Array<() => void>>();
    const signal = {
      aborted: false,
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener(type: string, listener: () => void) {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener));
      },
    } as AbortSignal;

    await expect(fetchWithClientAbortBridge(
      async () => {
        throw new Error('handler failed');
      },
      new Request('https://chisha.leftzzzz.top/api/agent/chat', { method: 'POST', signal }),
      {},
      {}
    )).rejects.toThrow('handler failed');

    expect(listeners.get('abort')).toEqual([]);
  });
});
