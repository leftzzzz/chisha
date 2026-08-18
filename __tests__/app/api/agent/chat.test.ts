jest.mock('@/lib/agent/orchestrator/runtime', () => ({
  runSearchAgentV3: jest.fn(async (
    input: { runtimeState?: unknown },
    emit: (event: Record<string, unknown>) => void
  ) => {
    const result = {
      restaurants: [],
      candidates: [],
      explanation: '测试结果',
      unmetConstraints: [],
      runtimeState: input.runtimeState,
    };
    emit({ type: 'final', ...result });
    emit({ type: 'done', ...result });
    return result;
  }),
}));

jest.mock('@/lib/providerScheduler', () => {
  const actual = jest.requireActual('@/lib/providerScheduler');
  return {
    ...actual,
    acquireProviderLease: jest.fn(actual.acquireProviderLease),
  };
});

import { POST } from '@/app/api/agent/chat/route';
import { createAgentSession, getAgentSession, saveAgentSession } from '@/lib/agent/session';
import { AgentRunError } from '@/lib/agent/types';
import { runSearchAgentV3 } from '@/lib/agent/orchestrator/runtime';
import * as providerScheduler from '@/lib/providerScheduler';
import type { RestaurantCandidate, SearchAttempt, UserGoal } from '@/lib/agent/types';
import type { Location } from '@/types';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

jest.mock('@/lib/rateLimit', () => ({
  getClientIP: jest.fn(() => '127.0.0.1'),
  rateLimit: jest.fn(() => ({ success: true })),
  checkRateLimit: jest.fn(async () => ({
    success: true,
    remaining: null,
    resetTime: 0,
    retryAfterSeconds: 60,
  })),
}));

jest.mock('@/lib/amap', () => ({
  amapPoiSearch: jest.fn(async () => [{
    id: 'r1',
    name: '寿司店',
    cuisineType: '日本料理',
    address: '测试地址',
    location: {
      lat: 31.2304,
      lng: 121.4737,
      address: '上海市黄浦区',
    },
    source: 'amap',
    distance: 300,
  }]),
  enrichRestaurantsWithAmapDetails: jest.fn(async (restaurants) => restaurants),
}));

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃日料',
    requestedItems: [],
    acceptableCategories: [{ name: '日料', confidence: 0.9 }],
    alternativeGroups: [],
    primaryKeywords: ['日料'],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: false,
    ...overrides,
  };
}

async function readSseEvents(response: Response): Promise<Array<{ type: string; [key: string]: unknown }>> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

function jsonRequest(body: unknown): Request {
  return {
    json: async () => body,
    headers: new Headers(),
    signal: new AbortController().signal,
  } as Request;
}

class TestResponse {
  constructor(
    private readonly body: ReadableStream<Uint8Array> | string,
    public readonly init?: ResponseInit
  ) {}

  async text(): Promise<string> {
    if (typeof this.body === 'string') {
      return this.body;
    }

    const reader = this.body.getReader();
    const decoder = new TextDecoder();
    let text = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  }

  async cancel(): Promise<void> {
    if (typeof this.body !== 'string') {
      await this.body.cancel();
    }
  }
}

describe('/api/agent/chat', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProviderMaxWaitMs = process.env.PROVIDER_MAX_WAIT_MS;
  const originalReadableStream = globalThis.ReadableStream;
  const originalResponse = globalThis.Response;
  const originalTextEncoder = globalThis.TextEncoder;
  const originalTextDecoder = globalThis.TextDecoder;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    (globalThis as typeof globalThis & { ReadableStream: typeof ReadableStream }).ReadableStream = ReadableStream;
    (globalThis as typeof globalThis & { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
    (globalThis as typeof globalThis & { Response: typeof TestResponse }).Response = TestResponse;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.ReadableStream = originalReadableStream;
    globalThis.Response = originalResponse;
    globalThis.TextEncoder = originalTextEncoder;
    globalThis.TextDecoder = originalTextDecoder;
    if (originalProviderMaxWaitMs === undefined) delete process.env.PROVIDER_MAX_WAIT_MS;
    else process.env.PROVIDER_MAX_WAIT_MS = originalProviderMaxWaitMs;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('rejects unbounded preference fanout before starting the Agent', async () => {
    const response = await POST(jsonRequest({
      message: '想吃日料',
      location,
      groupPreferenceSummaries: Array.from({ length: 9 }, () => ({
        favoriteCuisines: [{ name: '日料', weight: 1 }],
      })),
    }));

    expect((response as unknown as TestResponse).init?.status).toBe(400);
    expect(runSearchAgentV3).not.toHaveBeenCalled();
  });

  it('rejects a concurrent turn for the same session before entering the Agent', async () => {
    process.env.PROVIDER_MAX_WAIT_MS = '0';
    const session = createAgentSession('想吃日料', location);
    let finishFirst!: (value: {
      restaurants: never[];
      candidates: never[];
      explanation: string;
      unmetConstraints: never[];
      runtimeState: undefined;
    }) => void;
    (runSearchAgentV3 as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = resolve;
    }));

    const first = await POST(jsonRequest({
      message: '继续找日料',
      location,
      sessionId: session.id,
    }));
    const second = await POST(jsonRequest({
      message: '同时再找火锅',
      location,
      sessionId: session.id,
    }));

    expect((second as unknown as TestResponse).init?.status).toBe(429);
    expect(runSearchAgentV3).toHaveBeenCalledTimes(1);

    finishFirst({
      restaurants: [],
      candidates: [],
      explanation: '测试结果',
      unmetConstraints: [],
      runtimeState: undefined,
    });
    await readSseEvents(first);
  });

  it('releases admission leases before ending a successful SSE stream', async () => {
    const releaseResolvers: Array<() => void> = [];
    const leases = ['active-runs', 'session'].map((leaseId) => ({
      leaseId,
      probe: false,
      release: jest.fn(() => new Promise<void>((resolve) => releaseResolvers.push(resolve))),
      renew: jest.fn(async () => true),
      startAutoRenew: jest.fn(),
      stopAutoRenew: jest.fn(),
    }));
    (providerScheduler.acquireProviderLease as jest.Mock)
      .mockResolvedValueOnce(leases[0])
      .mockResolvedValueOnce(leases[1]);

    const response = await POST(jsonRequest({
      message: '想吃日料',
      location,
    }));
    let bodyEnded = false;
    const bodyPromise = (response as unknown as TestResponse).text().then((text) => {
      bodyEnded = true;
      return text;
    });

    for (let attempt = 0; attempt < 20 && releaseResolvers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(releaseResolvers).toHaveLength(2);
    expect(bodyEnded).toBe(false);
    releaseResolvers.forEach((resolve) => resolve());

    await expect(bodyPromise).resolves.toContain('"type":"session_updated"');
    expect(bodyEnded).toBe(true);
  });

  it('waits for an aborted run to unwind before releasing admission leases', async () => {
    let runtimeSettled = false;
    (runSearchAgentV3 as jest.Mock).mockImplementationOnce((input: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          queueMicrotask(() => {
            runtimeSettled = true;
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }, { once: true });
      })
    ));
    const releaseOrder: boolean[] = [];
    const releaseResolvers: Array<() => void> = [];
    const leases = ['active-runs', 'session'].map((leaseId) => ({
      leaseId,
      probe: false,
      release: jest.fn(() => {
        releaseOrder.push(runtimeSettled);
        return new Promise<void>((resolve) => releaseResolvers.push(resolve));
      }),
      renew: jest.fn(async () => true),
      startAutoRenew: jest.fn(),
      stopAutoRenew: jest.fn(),
    }));
    (providerScheduler.acquireProviderLease as jest.Mock)
      .mockResolvedValueOnce(leases[0])
      .mockResolvedValueOnce(leases[1]);

    const response = await POST(jsonRequest({
      message: '想吃日料',
      location,
    }));
    let cancelEnded = false;
    const cancelPromise = (response as unknown as TestResponse).cancel().then(() => {
      cancelEnded = true;
    });

    for (let attempt = 0; attempt < 20 && releaseResolvers.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(releaseOrder).toEqual([true, true]);
    expect(cancelEnded).toBe(false);
    releaseResolvers.forEach((resolve) => resolve());
    await cancelPromise;
    expect(cancelEnded).toBe(true);
  });

  it('resumes a valid completed session id as a follow-up conversation', async () => {
    const previousSession = createAgentSession('想吃日料', location);
    previousSession.goal = goal();
    previousSession.pendingQuestion = undefined;
    saveAgentSession(previousSession);

    const response = await POST(jsonRequest({
      message: '想吃火锅',
      location,
      sessionId: previousSession.id,
    }));
    const events = await readSseEvents(response);
    const runtimeInput = (runSearchAgentV3 as jest.Mock).mock.calls.at(-1)?.[0];

    expect(events.map((event) => event.type)).toContain('session_resumed');
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
    expect(runtimeInput.runtimeState.goal).toEqual(expect.objectContaining({
      primaryKeywords: ['日料'],
    }));
    expect(runtimeInput.messages.at(-1)).toEqual(expect.objectContaining({
      role: 'user',
      content: '想吃火锅',
    }));
  });

  it('resumes sessions that are waiting for a pending question', async () => {
    const pausedSession = createAgentSession('随便吃点', location);
    pausedSession.goal = goal({ primaryKeywords: ['餐厅'], acceptableCategories: [] });
    pausedSession.pendingQuestion = {
      question: '要允许放宽吗？',
      options: ['允许放宽'],
      allowFreeText: true,
      optionEffects: {
        '允许放宽': { allowBroaden: true },
      },
    };
    saveAgentSession(pausedSession);

    const response = await POST(jsonRequest({
      message: '允许放宽',
      location,
      sessionId: pausedSession.id,
    }));
    const events = await readSseEvents(response);

    expect(events.map((event) => event.type)).toContain('session_resumed');
  });

  it('passes pending question option effects to runtime for Supervisor-owned handling', async () => {
    const pausedSession = createAgentSession('想吃日料', location);
    pausedSession.goal = goal({
      hardConstraints: [{ kind: 'distance', label: '500米内', value: 500, maxMeters: 500, strict: true }],
    });
    pausedSession.pendingQuestion = {
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      options: ['扩大范围'],
      allowFreeText: true,
      optionEffects: {
        '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
      },
    };
    saveAgentSession(pausedSession);

    const response = await POST(jsonRequest({
      message: '扩大范围',
      location,
      sessionId: pausedSession.id,
    }));
    await readSseEvents(response);

    const runtimeInput = (runSearchAgentV3 as jest.Mock).mock.calls.at(-1)?.[0];
    expect(runtimeInput.runtimeState.pendingQuestion).toEqual(expect.objectContaining({
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      optionEffects: {
        '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
      },
    }));
    expect(runtimeInput.runtimeState.goal.allowBroaden).toBe(false);
  });

  it('preserves existing fallback candidates when a pending answer reaches the runtime', async () => {
    const pausedSession = createAgentSession('随便吃点', location);
    pausedSession.goal = goal({ allowBroaden: false });
    pausedSession.attempts = [{
      keywords: ['餐厅', '美食'],
      radius: 1800,
      searchIntent: 'fallback',
      allowedForPrimary: false,
      reason: '未授权时作为候补搜索。',
      found: 1,
      accepted: 1,
    }] satisfies SearchAttempt[];
    pausedSession.candidates = [{
      restaurant: {
        id: 'r1',
        name: '社区餐厅',
        cuisineType: '餐饮',
        address: '测试地址',
        location,
        source: 'amap',
        distance: 300,
      },
      score: 70,
      matched: ['Agent 验证符合搜索意图。'],
      warnings: [],
      sourceAttempt: 1,
      verification: {
        restaurantId: 'r1',
        status: 'passed',
        primaryEligible: false,
        hardFailures: [],
        itemMatches: [],
        categoryMatches: ['餐饮'],
        warnings: [],
        confidence: 0.9,
      },
    }] satisfies RestaurantCandidate[];
    pausedSession.pendingQuestion = {
      question: '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
      options: ['允许放宽'],
      allowFreeText: true,
      optionEffects: {
        '允许放宽': { allowBroaden: true },
      },
    };
    saveAgentSession(pausedSession);

    const response = await POST(jsonRequest({
      message: '允许放宽',
      location,
      sessionId: pausedSession.id,
    }));
    await readSseEvents(response);

    const runtimeInput = (runSearchAgentV3 as jest.Mock).mock.calls.at(-1)?.[0];
    expect(runtimeInput.runtimeState.pendingQuestion).toEqual(expect.objectContaining({
      question: '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    }));
    expect(runtimeInput.runtimeState.attempts[0].allowedForPrimary).toBe(false);
    expect(runtimeInput.runtimeState.candidates[0].verification.primaryEligible).toBe(false);
  });

  it('persists the trace of a failed turn before reporting the error', async () => {
    // 失败路径与成功路径同等留痕：最需要 trace 的这一轮不能什么都查不到。
    const session = createAgentSession('想吃日料', location);
    session.goal = goal();
    saveAgentSession(session);

    (runSearchAgentV3 as jest.Mock).mockImplementationOnce(async () => {
      throw new AgentRunError('EvaluationModel API failed: 429', 'RATE_LIMITED', {
        attempts: [],
        candidates: [],
        actions: [],
        observations: [],
        trace: [{
          id: 'trace_error_1',
          sessionId: session.id,
          turnId: 'turn-1',
          type: 'error',
          createdAt: 1,
          error: {
            code: 'RATE_LIMITED',
            message: 'EvaluationModel API failed: 429',
            retryable: true,
          },
        }],
      });
    });

    const response = await POST(jsonRequest({
      message: '想吃日料',
      location,
      sessionId: session.id,
    }));
    const events = await readSseEvents(response);
    const errorEvent = events.find((event) => event.type === 'error');

    expect(errorEvent).toEqual(expect.objectContaining({
      code: 'RATE_LIMITED',
      recoverable: true,
    }));
    expect(getAgentSession(session.id)?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error' }),
    ]));
  });

  it('reports an expired session with a structured error code', async () => {
    const response = await POST(jsonRequest({
      message: '想吃日料',
      location,
      sessionId: 'missing-session',
    }));
    const events = await readSseEvents(response);

    expect(events.find((event) => event.type === 'error')).toEqual(expect.objectContaining({
      code: 'SESSION_EXPIRED',
      recoverable: false,
    }));
  });
});
