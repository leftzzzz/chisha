import {
  applyRuntimeStateToSession,
  createAgentSession,
  getAgentSession,
  resetAgentSessionStore,
  setAgentSessionStore,
} from '@/lib/agent/session';
import type { AgentSession, UserGoal } from '@/lib/agent/types';
import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

const goal: UserGoal = {
  intent: 'find_restaurants',
  rawQuery: '随便吃点',
  requestedItems: [],
  acceptableCategories: [],
  alternativeGroups: [],
  primaryKeywords: ['餐厅'],
  relatedKeywords: [],
  broadenedKeywords: [],
  hardConstraints: [],
  softPreferences: [],
  exclusions: [],
  ambiguity: [],
  clarificationNeeded: [],
  allowBroaden: true,
};

describe('agent session store', () => {
  afterEach(() => {
    resetAgentSessionStore();
  });

  it('uses opaque server-side session ids instead of encoded state tokens', () => {
    const session = createAgentSession('随便吃点', location);
    applyRuntimeStateToSession(session, {
      goal,
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
    });

    const restored = getAgentSession(session.id);

    expect(session.id.startsWith('agent_state_')).toBe(false);
    expect(restored?.messages[0].content).toBe('随便吃点');
    expect(restored?.goal?.primaryKeywords).toEqual(['餐厅']);
  });

  it('does not decode client supplied agent_state payloads', () => {
    expect(getAgentSession('agent_state_eyJpZCI6InRhbXBlcmVkIn0')).toBeNull();
  });

  it('allows the session backend to be replaced by a durable store adapter', () => {
    const stored = new Map<string, AgentSession>();
    setAgentSessionStore({
      create: (message, sessionLocation) => {
        const session: AgentSession = {
          id: `durable_${stored.size + 1}`,
          version: 3,
          createdAt: 1,
          updatedAt: 1,
          expiresAt: 999,
          location: sessionLocation,
          messages: [{ role: 'user', content: message, createdAt: 1 }],
          attempts: [],
          candidates: [],
          actions: [],
          observations: [],
        };
        stored.set(session.id, session);
        return session;
      },
      get: (sessionId) => stored.get(sessionId) ?? null,
      save: (session) => {
        stored.set(session.id, session);
        return session;
      },
      delete: (sessionId) => stored.delete(sessionId),
    });

    const session = createAgentSession('随便吃点', location);
    applyRuntimeStateToSession(session, {
      goal,
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
    });

    expect(session.id).toBe('durable_1');
    expect(getAgentSession('durable_1')?.goal?.allowBroaden).toBe(true);
  });
});
