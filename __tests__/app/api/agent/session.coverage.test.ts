/**
 * @jest-environment node
 */

const mockConfigureStore = jest.fn(async () => false);
const mockGetSession = jest.fn();
const mockSaveSession = jest.fn(async () => undefined);
const mockDeleteSession = jest.fn(async () => undefined);
const mockClaimLegacy = jest.fn(() => false);
const mockGetOwner = jest.fn();
const mockBelongs = jest.fn(() => true);
const mockRateLimit = jest.fn();
const mockAcquireLease = jest.fn();

jest.mock('@/lib/agent/cloudflareSessionStore', () => ({
  configureCloudflareAgentSessionStore: (...args: Parameters<typeof mockConfigureStore>) => mockConfigureStore(...args),
}));
jest.mock('@/lib/agent/session', () => ({
  getAgentSessionAsync: (...args: Parameters<typeof mockGetSession>) => mockGetSession(...args),
  saveAgentSessionAsync: (...args: Parameters<typeof mockSaveSession>) => mockSaveSession(...args),
  deleteAgentSessionAsync: (...args: Parameters<typeof mockDeleteSession>) => mockDeleteSession(...args),
}));
jest.mock('@/lib/agent/sessionOwner', () => {
  class SessionOwnerConfigurationError extends Error {}
  return {
    claimLegacySessionOwner: (...args: Parameters<typeof mockClaimLegacy>) => mockClaimLegacy(...args),
    getSessionOwner: (...args: Parameters<typeof mockGetOwner>) => mockGetOwner(...args),
    sessionBelongsToOwner: (...args: Parameters<typeof mockBelongs>) => mockBelongs(...args),
    SessionOwnerConfigurationError,
  };
});
jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: (...args: Parameters<typeof mockRateLimit>) => mockRateLimit(...args),
  getClientIP: jest.fn(() => '198.51.100.1'),
}));
jest.mock('@/lib/providerScheduler', () => {
  class ProviderSchedulerError extends Error {
    constructor(
      message: string,
      public kind: 'busy' | 'unavailable' | 'blocked' | 'configuration',
      public retryAfterMs: number,
      public providerCategory?: string
    ) { super(message); }
  }
  return {
    acquireProviderLease: (...args: Parameters<typeof mockAcquireLease>) => mockAcquireLease(...args),
    getProviderSchedulerConfig: jest.fn(() => ({ maxInFlight: 1 })),
    providerSchedulerName: jest.fn((_kind: string, id: string) => `session:${id}`),
    ProviderSchedulerError,
  };
});

import { DELETE, GET } from '@/app/api/agent/session/[id]/route';
import { SessionOwnerConfigurationError } from '@/lib/agent/sessionOwner';
import { ProviderSchedulerError } from '@/lib/providerScheduler';

function request(method = 'GET', includeTrace = false) {
  return new Request(`https://example.test/api/agent/session/s1${includeTrace ? '?include=trace' : ''}`, { method });
}

const context = { params: Promise.resolve({ id: 's1' }) };
const session = {
  id: 's1', ownerId: 'owner-1', version: 2, createdAt: 1, updatedAt: 2, expiresAt: 3,
  pendingQuestion: null,
  goal: {
    rawQuery: '川菜', primaryKeywords: ['川菜'], requestedItems: [],
    acceptableCategories: [], allowBroaden: true,
  },
  actions: [{ id: 'a1', action: { type: 'search' }, summary: '搜索', createdAt: 4 }],
  observations: [{
    actionId: 'a1', plan: { keywords: ['川菜'], searchIntent: '正餐' }, rawCount: 3,
    acceptedPrimaryIds: ['r1'], candidateIds: ['r2'], hardRejected: [],
    evaluatedIds: ['r1', 'r2'], unevaluatedIds: ['r3'],
    evaluationStopReason: 'budget_exhausted',
    unmetConstraints: ['a', 'b', 'c', 'd', 'e', 'f'],
  }],
  trace: [{ type: 'thinking', createdAt: 1 }],
};

describe('/api/agent/session route branches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockResolvedValue({ success: true, remaining: 1, resetTime: 0, retryAfterSeconds: 9 });
    mockGetOwner.mockResolvedValue({ ownerId: 'owner-1', setCookie: 'owner=cookie' });
    mockGetSession.mockResolvedValue({ ...session });
    mockBelongs.mockReturnValue(true);
    mockClaimLegacy.mockReturnValue(false);
    mockAcquireLease.mockResolvedValue({ release: jest.fn(async () => undefined) });
  });

  it('rate limits reads and deletes', async () => {
    mockRateLimit.mockResolvedValue({ success: false, remaining: 0, resetTime: 0, retryAfterSeconds: 9 });
    const get = await GET(request(), context);
    const del = await DELETE(request('DELETE'), context);
    expect(get.status).toBe(429);
    expect(del.status).toBe(429);
    expect(get.headers.get('Retry-After')).toBe('9');
    expect(mockGetOwner).not.toHaveBeenCalled();
  });

  it('maps owner configuration errors and propagates unexpected owner failures', async () => {
    mockGetOwner.mockRejectedValueOnce(new SessionOwnerConfigurationError('missing'));
    expect((await GET(request(), context)).status).toBe(503);
    mockGetOwner.mockRejectedValueOnce(new SessionOwnerConfigurationError('missing'));
    expect((await DELETE(request('DELETE'), context)).status).toBe(503);
    mockGetOwner.mockRejectedValueOnce(new Error('unexpected'));
    await expect(GET(request(), context)).rejects.toThrow('unexpected');
    mockGetOwner.mockRejectedValueOnce(new Error('unexpected delete'));
    await expect(DELETE(request('DELETE'), context)).rejects.toThrow('unexpected delete');
  });

  it('hides missing and foreign sessions', async () => {
    mockGetSession.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(404);
    mockBelongs.mockReturnValueOnce(false);
    expect((await GET(request(), context)).status).toBe(404);
    mockGetSession.mockResolvedValueOnce(null);
    expect((await DELETE(request('DELETE'), context)).status).toBe(404);
    mockBelongs.mockReturnValueOnce(false);
    expect((await DELETE(request('DELETE'), context)).status).toBe(404);
  });

  it('claims legacy ownership and conditionally returns goal, trace and cookies', async () => {
    mockClaimLegacy.mockReturnValueOnce(true);
    const traced = await GET(request('GET', true), context);
    const body = await traced.json();
    expect(traced.status).toBe(200);
    expect(traced.headers.get('Set-Cookie')).toBe('owner=cookie');
    expect(body).toMatchObject({ id: 's1', goal: { rawQuery: '川菜' }, traceCount: 1, trace: session.trace, actionCount: 1, observationCount: 1 });
    expect(body.observations[0]).toMatchObject({
      evaluatedCount: 2,
      unevaluatedCount: 1,
      evaluationStopReason: 'budget_exhausted',
    });
    expect(body.observations[0].unmetConstraints).toHaveLength(5);
    expect(mockSaveSession).toHaveBeenCalled();

    mockGetOwner.mockResolvedValueOnce({ ownerId: 'owner-1' });
    mockGetSession.mockResolvedValueOnce({ ...session, goal: undefined });
    const untraced = await GET(request(), context);
    const untracedBody = await untraced.json();
    expect(untraced.headers.get('Set-Cookie')).toBeNull();
    expect(untracedBody.goal).toBeUndefined();
    expect(untracedBody.trace).toBeUndefined();
  });

  it('deletes under a lease and always releases it', async () => {
    const release = jest.fn(async () => undefined);
    mockAcquireLease.mockResolvedValueOnce({ release });
    const response = await DELETE(request('DELETE'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toBe('owner=cookie');
    expect(mockDeleteSession).toHaveBeenCalledWith('s1');
    expect(release).toHaveBeenCalled();

    mockGetOwner.mockResolvedValueOnce({ ownerId: 'owner-1' });
    const noCookie = await DELETE(request('DELETE'), context);
    expect(noCookie.headers.get('Set-Cookie')).toBeNull();
  });

  it('preserves unknown evaluation counts in legacy observations', async () => {
    mockGetSession.mockResolvedValueOnce({
      ...session,
      observations: session.observations.map((observation) => ({
        ...observation, evaluatedIds: undefined, unevaluatedIds: undefined,
        evaluationStopReason: undefined,
      })),
    });
    const body = await (await GET(request(), context)).json();
    expect(body.observations[0].unevaluatedCount).toBeNull();
    expect(body.observations[0].evaluationStopReason).toBeUndefined();
  });

  it.each([
    ['busy', 429, '会话正在处理中，请稍后重试'],
    ['blocked', 429, '会话正在处理中，请稍后重试'],
    ['unavailable', 503, '服务暂时不可用'],
  ] as const)('maps %s lease errors', async (kind, status, message) => {
    mockAcquireLease.mockRejectedValue(new ProviderSchedulerError('lease', kind, 1200));
    const response = await DELETE(request('DELETE'), context);
    expect(response.status).toBe(status);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(await response.json()).toEqual({ error: message });
  });

  it('rethrows unknown delete failures after releasing an acquired lease', async () => {
    const release = jest.fn(async () => undefined);
    mockAcquireLease.mockResolvedValueOnce({ release });
    mockDeleteSession.mockRejectedValueOnce(new Error('delete failed'));
    await expect(DELETE(request('DELETE'), context)).rejects.toThrow('delete failed');
    expect(release).toHaveBeenCalled();
  });
});
