import type { Location } from '@/types';
import type { AgentSession } from './types';
import type { AgentSessionStore } from './session';
import {
  agentSessionFromD1Row,
  agentSessionToD1Row,
  type AgentSessionD1Row,
} from './d1SessionSchema';
import { withD1Retry, type D1RetryOptions } from './d1Retry';

const SESSION_TTL_MS = 30 * 60 * 1000;

export class D1AgentSessionStore implements AgentSessionStore {
  constructor(
    private readonly db: D1Database,
    private readonly retryOptions: D1RetryOptions = {}
  ) {}

  create(): AgentSession {
    throw new Error('D1AgentSessionStore requires async session methods');
  }

  get(): AgentSession | null {
    throw new Error('D1AgentSessionStore requires async session methods');
  }

  save(): AgentSession {
    throw new Error('D1AgentSessionStore requires async session methods');
  }

  delete(): boolean {
    throw new Error('D1AgentSessionStore requires async session methods');
  }

  async createAsync(message: string, location: Location): Promise<AgentSession> {
    const now = Date.now();
    // Keep cleanup off the read path; D1 can automatically retry the SELECT in getAsync.
    await this.cleanupExpiredSessions(now);

    const session: AgentSession = {
      id: createSessionId(),
      version: 4,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      location,
      messages: [{
        role: 'user',
        content: message,
        createdAt: now,
      }],
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
      trace: [],
    };

    await this.saveAsync(session);
    return session;
  }

  async getAsync(sessionId: string): Promise<AgentSession | null> {
    const row = await this.db
      .prepare('SELECT * FROM agent_sessions WHERE id = ? AND expires_at > ?')
      .bind(sessionId, Date.now())
      .first<AgentSessionD1Row>();

    return row ? agentSessionFromD1Row(row) : null;
  }

  async saveAsync(session: AgentSession): Promise<AgentSession> {
    const now = Date.now();
    const updatedSession: AgentSession = {
      ...session,
      updatedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    const row = agentSessionToD1Row(updatedSession);

    await withD1Retry(
      () => this.db
        .prepare(`
          INSERT INTO agent_sessions (
            id,
            version,
            location_json,
            messages_json,
            runtime_state_json,
            pending_question_json,
            created_at,
            updated_at,
            expires_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            version = excluded.version,
            location_json = excluded.location_json,
            messages_json = excluded.messages_json,
            runtime_state_json = excluded.runtime_state_json,
            pending_question_json = excluded.pending_question_json,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        `)
        .bind(
          row.id,
          row.version,
          row.location_json,
          row.messages_json,
          row.runtime_state_json,
          row.pending_question_json,
          row.created_at,
          row.updated_at,
          row.expires_at
        )
        .run(),
      this.retryOptions
    );

    Object.assign(session, updatedSession);
    return session;
  }

  async deleteAsync(sessionId: string): Promise<boolean> {
    const result = await withD1Retry(
      () => this.db
        .prepare('DELETE FROM agent_sessions WHERE id = ?')
        .bind(sessionId)
        .run(),
      this.retryOptions
    );

    return (result.meta.changes ?? 0) > 0;
  }

  private async cleanupExpiredSessions(now: number): Promise<void> {
    await withD1Retry(
      () => this.db
        .prepare('DELETE FROM agent_sessions WHERE expires_at <= ?')
        .bind(now)
        .run(),
      this.retryOptions
    );
  }
}

function createSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
