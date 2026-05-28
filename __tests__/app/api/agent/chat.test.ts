import { POST } from '@/app/api/agent/chat/route';
import { createAgentSession, createAgentSessionToken, saveAgentSession } from '@/lib/agent/session';
import type { UserGoal } from '@/lib/agent/types';
import type { Location } from '@/types';
import { ReadableStream } from 'stream/web';
import { TextDecoder, TextEncoder } from 'util';

jest.mock('@/lib/rateLimit', () => ({
  getClientIP: jest.fn(() => '127.0.0.1'),
  rateLimit: jest.fn(() => ({ success: true })),
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

  it('starts a fresh search when a completed session token is sent by mistake', async () => {
    const previousSession = createAgentSession('想吃日料', location);
    previousSession.goal = goal();
    previousSession.pendingQuestion = undefined;
    saveAgentSession(previousSession);
    const completedSessionToken = createAgentSessionToken(previousSession);

    const response = await POST(jsonRequest({
      message: '想吃火锅',
      location,
      sessionId: completedSessionToken,
    }));
    const events = await readSseEvents(response);

    expect(events.map((event) => event.type)).not.toContain('session_resumed');
    expect(events.find((event) => event.type === 'error')).toBeUndefined();
  });

  it('resumes only sessions that are waiting for a pending question', async () => {
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
      sessionId: createAgentSessionToken(pausedSession),
    }));
    const events = await readSseEvents(response);

    expect(events.map((event) => event.type)).toContain('session_resumed');
  });
});
