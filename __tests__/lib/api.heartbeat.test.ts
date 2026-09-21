/**
 * SSE 卡死检测。
 *
 * 历史缺陷：客户端在响应头到达后就清掉了唯一的超时，此后流可以无限挂起，
 * Worker 静默失败时 UI 会一直转圈且不报错。这里锁定"无事件超时 + 心跳重置"行为。
 */

import { agentChat, APIError } from '@/lib/api';
import type { Location } from '@/types';
import { TextDecoder, TextEncoder } from 'util';
import { ReadableStream } from 'stream/web';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

const HEARTBEAT_TIMEOUT_MS = 45000;

interface StreamHandle {
  emit(event: unknown): void;
  close(): void;
}

/**
 * 模拟 fetch：返回一个受 AbortSignal 控制的流，
 * 让 controller.abort() 能像真实 fetch 一样中断 reader.read()。
 */
function mockAbortableStream(): StreamHandle {
  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockImplementation((_url: string, init: { signal: AbortSignal }) => ({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          init.signal.addEventListener('abort', () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            controller.error(abortError);
          });
        },
      }),
    }));

  return {
    emit(event: unknown) {
      streamController?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      streamController?.close();
    },
  };
}

describe('agentChat 卡死检测', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    delete (globalThis as typeof globalThis & { fetch?: unknown }).fetch;
    delete (globalThis as typeof globalThis & { TextDecoder?: unknown }).TextDecoder;
  });

  it('aborts the stream when no event arrives within the heartbeat timeout', async () => {
    mockAbortableStream();

    const pending = agentChat('想吃日料', location);
    const assertion = expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: 'APIError',
        code: 'SEARCH_TIMEOUT',
      } satisfies Partial<APIError>)
    );

    await jest.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS + 1000);
    await assertion;
  });

  it('keeps the early session id on timeout failures', async () => {
    const stream = mockAbortableStream();
    const pending = agentChat('想吃日料', location);
    const assertion = expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: 'APIError',
        code: 'SEARCH_TIMEOUT',
        sessionId: 'session-cancelled',
      } satisfies Partial<APIError>)
    );

    stream.emit({ type: 'session_created', sessionId: 'session-cancelled' });
    await jest.advanceTimersByTimeAsync(HEARTBEAT_TIMEOUT_MS + 1000);
    await assertion;
  });

  it('keeps waiting while the server sends heartbeats', async () => {
    const stream = mockAbortableStream();
    const pending = agentChat('想吃日料', location);

    // 服务端每 10s 一次心跳：远超单次超时窗口也不应被判定为卡死。
    for (let elapsed = 0; elapsed < HEARTBEAT_TIMEOUT_MS * 2; elapsed += 10000) {
      await jest.advanceTimersByTimeAsync(10000);
      stream.emit({ type: 'heartbeat', at: elapsed });
    }

    stream.emit({
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
    });
    stream.close();

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ restaurants: expect.arrayContaining([
        expect.objectContaining({ id: 'r1' }),
      ]) })
    );
  });
});
