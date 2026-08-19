import {
  agentChat,
  API_CONFIG,
  geocode,
  reverseGeocode,
  searchRestaurants,
  understand,
  type AgentSearchCallbacks,
} from '@/lib/api';
import type { Location, Restaurant } from '@/types';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

const location: Location = { lat: 31.23, lng: 121.47, address: '上海' };
const restaurant: Restaurant = {
  id: 'r1', name: '餐厅', cuisineType: '川菜', address: '地址', location,
  source: 'amap',
};

function jsonResponse(data: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: jest.fn(async () => data) } as unknown as Response;
}

function eventStream(events: unknown[], options: { prefix?: string; split?: boolean } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = `${options.prefix ?? ''}${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}`;
  return new ReadableStream({
    start(controller) {
      if (options.split) {
        const middle = Math.floor(payload.length / 2);
        controller.enqueue(encoder.encode(payload.slice(0, middle)));
        controller.enqueue(encoder.encode(payload.slice(middle)));
      } else {
        controller.enqueue(encoder.encode(payload));
      }
      controller.close();
    },
  });
}

function streamResponse(events: unknown[], options?: { prefix?: string; split?: boolean }): Response {
  return { ok: true, status: 200, body: eventStream(events, options) } as unknown as Response;
}

describe('API JSON client coverage', () => {
  const originalConfig = { ...API_CONFIG };

  beforeEach(() => {
    jest.restoreAllMocks();
    API_CONFIG.retryDelay = 0;
    API_CONFIG.retryCount = 2;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
  });

  afterAll(() => Object.assign(API_CONFIG, originalConfig));

  it('calls all JSON endpoints and handles reverse geocode fallbacks', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { parsed: { keywords: ['火锅'], cuisineTypes: ['川菜'], searchRadius: 2000 } } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { restaurants: [restaurant], source: 'amap' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { location } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { address: '明确地址', formattedAddress: '格式地址' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { address: '', formattedAddress: '格式地址' } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { address: '', formattedAddress: '' } }));

    await expect(understand('想吃火锅', location)).resolves.toMatchObject({ keywords: ['火锅'] });
    await expect(searchRestaurants({ keywords: ['火锅'], location })).resolves.toEqual([restaurant]);
    await expect(geocode('南京路', '上海')).resolves.toEqual(location);
    await expect(reverseGeocode(location)).resolves.toBe('明确地址');
    await expect(reverseGeocode(location)).resolves.toBe('格式地址');
    await expect(reverseGeocode(location)).resolves.toBe('未知地址');
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ query: '想吃火锅', location });
  });

  it('validates search responses and preserves no-result semantics', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { restaurants: null } }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { restaurants: [] } }))
      .mockResolvedValueOnce(jsonResponse({ error: '上游失败', code: 'UPSTREAM' }, false, 502));
    await expect(searchRestaurants({ keywords: [], location })).rejects.toMatchObject({ code: 'INVALID_RESPONSE', message: '餐厅搜索失败: 搜索结果格式错误' });
    await expect(searchRestaurants({ keywords: [], location })).rejects.toMatchObject({ code: 'NO_RESULTS', message: expect.stringContaining('附近没有') });
    await expect(searchRestaurants({ keywords: [], location })).rejects.toMatchObject({ code: 'UPSTREAM', statusCode: 502, message: '餐厅搜索失败: 上游失败' });
  });

  it.each([
    ['understand', () => understand('query'), '需求理解失败'],
    ['geocode', () => geocode('address'), '地址解析失败'],
    ['reverse', () => reverseGeocode(location), '位置解析失败'],
  ])('wraps %s endpoint API errors', async (_name, invoke, prefix) => {
    (fetch as jest.Mock).mockResolvedValue(jsonResponse({ message: '服务异常', code: 'BAD' }, false, 400));
    await expect(invoke()).rejects.toMatchObject({ code: 'BAD', statusCode: 400, message: `${prefix}: 服务异常` });
  });

  it('uses default server messages and maps unknown JSON failures', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(jsonResponse({}, false, 500))
      .mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn(async () => { throw new SyntaxError('bad json'); }) });
    await expect(understand('x')).rejects.toMatchObject({ message: '需求理解失败: 请求失败' });
    await expect(understand('x')).rejects.toMatchObject({ code: 'UNKNOWN_ERROR', message: '需求理解失败: 未知错误,请稍后重试' });
  });

  it('retries transient network and abort failures, then reports their distinct messages', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    (fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { location } }));
    await expect(geocode('retry')).resolves.toEqual(location);
    expect(fetch).toHaveBeenCalledTimes(2);

    (fetch as jest.Mock).mockReset().mockRejectedValue(new TypeError('offline'));
    await expect(geocode('offline')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('网络连接失败') });
    expect(fetch).toHaveBeenCalledTimes(3);

    (fetch as jest.Mock).mockReset().mockRejectedValue(abortError);
    await expect(geocode('timeout')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('请求超时') });
  });
});

describe('Agent SSE client coverage', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: jest.fn() });
  });

  it('dispatches every progress event and trace summary across split chunks', async () => {
    const events = [
      { type: 'heartbeat', at: 1 },
      { type: 'thinking', message: '思考', traceId: 't1' },
      { type: 'status', message: '状态', traceId: 't2' },
      { type: 'searching', keywords: ['火锅', '串串'], round: 1, searchIntent: '正餐', planId: 'p1', traceId: 't3' },
      { type: 'search_result', found: 2, total: 3, restaurants: [restaurant], planId: 'p1', traceId: 't4' },
      { type: 'filtering', message: '筛选', total: 3, traceId: 't5' },
      { type: 'action', summary: '继续搜索', actionType: 'search', traceId: 't6' },
      { type: 'observation', found: 3, accepted: 1, rejected: 2, traceId: 't7' },
      { type: 'guardrail', message: '已放宽', severity: 'warn', traceId: 't8' },
      { type: 'tool_start', tool: 'amap_search', traceId: 't9' },
      { type: 'tool_result', tool: 'amap_search', traceId: 't10' },
      { type: 'partial_results', restaurants: [restaurant], traceId: 't11' },
      { type: 'session_resumed', sessionId: 's1', traceId: 't12' },
      { type: 'session_updated', sessionId: 's2', traceId: 't13' },
      { type: 'final', restaurants: [restaurant], explanation: '完成', unmetConstraints: ['未知价格'], sessionId: 's3', traceId: 't14' },
      { type: 'done', restaurants: [restaurant], candidates: [], explanation: '重复终态', traceId: 't15' },
    ];
    (fetch as jest.Mock).mockResolvedValue(streamResponse(events, { prefix: 'event: message\n\nnot-data\n', split: true }));
    const callbacks: AgentSearchCallbacks = {
      onThinking: jest.fn(), onStatus: jest.fn(), onSearching: jest.fn(), onSearchResult: jest.fn(),
      onFiltering: jest.fn(), onAction: jest.fn(), onObservation: jest.fn(), onGuardrail: jest.fn(),
      onPartialResults: jest.fn(), onSessionResumed: jest.fn(), onSessionUpdated: jest.fn(),
      onDone: jest.fn(), onTrace: jest.fn(),
    };
    const result = await agentChat('吃什么', location, callbacks, undefined, undefined, { favoriteCuisines: [] }, [], 'option-1');
    expect(result).toMatchObject({ restaurants: [restaurant], candidates: [], sessionId: 's3' });
    expect(callbacks.onThinking).toHaveBeenCalledWith('思考');
    expect(callbacks.onSearching).toHaveBeenCalledWith(['火锅', '串串'], 1, '正餐', 'p1');
    expect(callbacks.onSearchResult).toHaveBeenCalledWith(2, 3, [restaurant], 'p1');
    expect(callbacks.onDone).toHaveBeenCalledTimes(1);
    expect(callbacks.onTrace).toHaveBeenCalledTimes(15);
    expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toMatchObject({ optionId: 'option-1' });
  });

  it('handles done results, candidates-only results and malformed events', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce(streamResponse([{ type: 'done', restaurants: [restaurant], explanation: 'done' }], { prefix: 'data: {bad json}\n\n' }))
      .mockResolvedValueOnce(streamResponse([{ type: 'final', restaurants: [], candidates: [restaurant] }]));
    await expect(agentChat('done', location)).resolves.toMatchObject({ restaurants: [restaurant], candidates: [] });
    await expect(agentChat('candidate', location)).resolves.toMatchObject({ restaurants: [], candidates: [restaurant] });
  });

  it('returns questions and emits session pause callbacks', async () => {
    (fetch as jest.Mock).mockResolvedValue(streamResponse([
      { type: 'question', sessionId: 'question-session', question: '想吃什么', options: [{ id: 'a', label: '正餐' }], allowFreeText: false, traceId: 'q1' },
      { type: 'session_paused', sessionId: 'pause-session', traceId: 'q2' },
    ]));
    const callbacks = { onQuestion: jest.fn(), onSessionPaused: jest.fn(), onTrace: jest.fn() };
    await expect(agentChat('ask', location, callbacks)).resolves.toMatchObject({ paused: true, sessionId: 'pause-session', question: { sessionId: 'question-session' } });
    expect(callbacks.onQuestion).toHaveBeenCalled();
    expect(callbacks.onSessionPaused).toHaveBeenCalledWith('pause-session');
  });

  it.each([
    ['会话已过期，请重试', 'SESSION_EXPIRED'],
    ['缺少 OPENAI_API_KEY', 'CONFIG_MISSING'],
    ['搜索超时', 'SEARCH_PROVIDER_FAILED'],
    ['EvaluationModel failed', 'EVALUATION_FAILED'],
    ['其他错误', 'UNKNOWN'],
  ])('classifies legacy stream error %s', async (message, code) => {
    (fetch as jest.Mock).mockResolvedValue(streamResponse([{ type: 'error', message, traceId: 'error-trace' }]));
    const onError = jest.fn();
    await expect(agentChat('error', location, { onError })).rejects.toMatchObject({ code });
    expect(onError).toHaveBeenCalledWith(message);
  });

  it('maps HTTP, missing body, rejected fetch and external abort failures', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 503, json: jest.fn(async () => { throw new Error('not json'); }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: jest.fn(async () => ({ error: '明确错误' })) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: null })
      .mockRejectedValueOnce(new Error('network detail'))
      .mockRejectedValueOnce('plain failure');
    await expect(agentChat('http', location)).rejects.toMatchObject({ message: 'Agent 请求失败: 503', statusCode: 503 });
    await expect(agentChat('http', location)).rejects.toMatchObject({ message: '明确错误', statusCode: 400 });
    await expect(agentChat('body', location)).rejects.toMatchObject({ code: 'STREAM_ERROR' });
    await expect(agentChat('network', location)).rejects.toMatchObject({ code: 'API_CALL_FAILED', message: 'network detail' });
    await expect(agentChat('plain', location)).rejects.toMatchObject({ code: 'API_CALL_FAILED', message: 'Agent 请求失败' });

    (fetch as jest.Mock).mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    const external = new AbortController();
    const pending = agentChat('abort', location, undefined, external.signal);
    external.abort();
    await expect(pending).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT' });
  });
});
