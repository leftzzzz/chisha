import { D1AgentSessionStore } from '@/lib/agent/d1SessionStore';
import type { AgentSessionD1Row } from '@/lib/agent/d1SessionSchema';
import type { AgentTraceItem } from '@/lib/agent/types';
import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

const traceItem: AgentTraceItem = {
  id: 'trace_1',
  sessionId: 's1',
  turnId: 'turn_1',
  type: 'guard_decision',
  createdAt: 1,
  guardDecision: {
    type: 'allow',
    action: {
      type: 'finish',
      explanation: '测试',
      confidence: 0.8,
    },
  },
};

class FakeD1PreparedStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: FakeD1Database,
    private readonly query: string
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.includes('SELECT * FROM agent_sessions')) {
      const [sessionId, now] = this.values as [string, number];
      const row = this.database.rows.get(sessionId);

      if (!row || row.expires_at <= now) {
        return null;
      }

      return row as T;
    }

    return null;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    this.database.runAttempts += 1;
    const error = this.database.runErrors.shift();
    if (error) {
      throw error;
    }

    if (this.query.includes('INSERT INTO agent_sessions')) {
      const [
        id,
        version,
        locationJson,
        messagesJson,
        runtimeStateJson,
        pendingQuestionJson,
        createdAt,
        updatedAt,
        expiresAt,
      ] = this.values;

      this.database.rows.set(String(id), {
        id: String(id),
        version: Number(version),
        location_json: String(locationJson),
        messages_json: String(messagesJson),
        runtime_state_json: String(runtimeStateJson),
        pending_question_json: pendingQuestionJson === null ? null : String(pendingQuestionJson),
        created_at: Number(createdAt),
        updated_at: Number(updatedAt),
        expires_at: Number(expiresAt),
      });

      return result(1);
    }

    if (this.query.includes('DELETE FROM agent_sessions WHERE id = ?')) {
      const deleted = this.database.rows.delete(String(this.values[0]));
      return result(deleted ? 1 : 0);
    }

    if (this.query.includes('DELETE FROM agent_sessions WHERE expires_at <= ?')) {
      const now = Number(this.values[0]);
      let changes = 0;

      for (const [id, row] of this.database.rows.entries()) {
        if (row.expires_at <= now) {
          this.database.rows.delete(id);
          changes += 1;
        }
      }

      return result(changes);
    }

    return result(0);
  }
}

class FakeD1Database implements D1Database {
  readonly rows = new Map<string, AgentSessionD1Row>();
  readonly runErrors: Error[] = [];
  runAttempts = 0;

  prepare(query: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(this, query);
  }
}

function result<T = unknown>(changes: number): D1Result<T> {
  return {
    success: true,
    meta: { changes },
  };
}

describe('D1AgentSessionStore', () => {
  it('persists, restores, updates, and deletes sessions through D1', async () => {
    const db = new FakeD1Database();
    const store = new D1AgentSessionStore(db);

    const session = await store.createAsync('随便吃点', location);
    session.goal = {
      intent: 'find_restaurants',
      rawQuery: '随便吃点',
      requestedItems: [],
      acceptableCategories: [],
      alternativeGroups: [],
      primaryKeywords: ['餐厅', '美食'],
      relatedKeywords: [],
      broadenedKeywords: [],
      hardConstraints: [],
      softPreferences: [],
      exclusions: [],
      ambiguity: [],
      clarificationNeeded: [],
      allowBroaden: true,
    };
    session.pendingQuestion = {
      question: '要不要扩大范围？',
      options: ['扩大范围'],
      allowFreeText: true,
    };
    session.trace = [traceItem];

    await store.saveAsync(session);

    const restored = await store.getAsync(session.id);

    expect(restored?.messages[0].content).toBe('随便吃点');
    expect(restored?.location.address).toBe('上海市黄浦区');
    expect(restored?.goal?.primaryKeywords).toEqual(['餐厅', '美食']);
    expect(restored?.pendingQuestion?.question).toBe('要不要扩大范围？');
    expect(restored?.trace).toEqual([traceItem]);

    await store.deleteAsync(session.id);

    expect(await store.getAsync(session.id)).toBeNull();
  });

  it('does not restore expired sessions', async () => {
    const db = new FakeD1Database();
    const store = new D1AgentSessionStore(db);
    const expiredSession = await store.createAsync('想吃日料', location);
    const row = db.rows.get(expiredSession.id);

    if (row) {
      row.expires_at = Date.now() - 1;
    }

    expect(await store.getAsync(expiredSession.id)).toBeNull();
    expect(db.rows.has(expiredSession.id)).toBe(true);

    await store.createAsync('创建新会话时清理', location);

    expect(db.rows.has(expiredSession.id)).toBe(false);
  });

  it('retries transient D1 write errors with bounded backoff', async () => {
    const db = new FakeD1Database();
    const initialStore = new D1AgentSessionStore(db);
    const session = await initialStore.createAsync('重试保存', location);
    db.runAttempts = 0;
    db.runErrors.push(
      new Error(
        'D1_ERROR: Internal error while starting up D1 DB storage caused object to be reset; reference = test'
      ),
      new Error('D1_ERROR: Network connection lost')
    );
    const delays: number[] = [];
    const store = new D1AgentSessionStore(db, {
      random: () => 0.5,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await store.saveAsync(session);

    expect(db.runAttempts).toBe(3);
    expect(delays).toEqual([38, 75]);
    expect(db.rows.has(session.id)).toBe(true);
  });

  it('does not retry non-transient D1 errors', async () => {
    const db = new FakeD1Database();
    const initialStore = new D1AgentSessionStore(db);
    const session = await initialStore.createAsync('保存失败', location);
    db.runAttempts = 0;
    db.runErrors.push(new Error('D1_ERROR: no such table: agent_sessions'));
    const store = new D1AgentSessionStore(db, {
      sleep: async () => {
        throw new Error('sleep should not be called');
      },
    });

    await expect(store.saveAsync(session)).rejects.toThrow('no such table');
    expect(db.runAttempts).toBe(1);
  });

  it('stops retrying after the configured attempt limit', async () => {
    const db = new FakeD1Database();
    const initialStore = new D1AgentSessionStore(db);
    const session = await initialStore.createAsync('持续失败', location);
    db.runAttempts = 0;
    const persistentError = new Error('D1_ERROR: Network connection lost');
    db.runErrors.push(persistentError, persistentError, persistentError);
    const delays: number[] = [];
    const store = new D1AgentSessionStore(db, {
      maxAttempts: 3,
      random: () => 0,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await expect(store.saveAsync(session)).rejects.toBe(persistentError);
    expect(db.runAttempts).toBe(3);
    expect(delays).toEqual([25, 50]);
  });
});
