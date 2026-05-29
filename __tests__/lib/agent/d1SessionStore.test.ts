import { D1AgentSessionStore } from '@/lib/agent/d1SessionStore';
import type { AgentSessionD1Row } from '@/lib/agent/d1SessionSchema';
import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
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

    await store.saveAsync(session);

    const restored = await store.getAsync(session.id);

    expect(restored?.messages[0].content).toBe('随便吃点');
    expect(restored?.location.address).toBe('上海市黄浦区');
    expect(restored?.goal?.primaryKeywords).toEqual(['餐厅', '美食']);
    expect(restored?.pendingQuestion?.question).toBe('要不要扩大范围？');

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
    expect(db.rows.has(expiredSession.id)).toBe(false);
  });
});
