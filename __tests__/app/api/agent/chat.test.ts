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

import { POST } from '@/app/api/agent/chat/route';
import { createAgentSession, getAgentSession, saveAgentSession } from '@/lib/agent/session';
import { AgentRunError } from '@/lib/agent/types';
import { runSearchAgentV3 } from '@/lib/agent/orchestrator/runtime';
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
}

describe('/api/agent/chat', () => {
  const originalNodeEnv = process.env.NODE_ENV;
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
    jest.clearAllMocks();
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
