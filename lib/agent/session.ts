import type {
  AgentMessage,
  AgentRuntimeState,
  AgentSession,
} from './types';
import type { Location } from '@/types';

const sessions = new Map<string, AgentSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface AgentSessionStore {
  create(message: string, location: Location): AgentSession;
  get(sessionId: string): AgentSession | null;
  save(session: AgentSession): AgentSession;
  delete(sessionId: string): boolean;
}

export const inMemoryAgentSessionStore: AgentSessionStore = {
  create: createAgentSession,
  get: getAgentSession,
  save: saveAgentSession,
  delete: deleteAgentSession,
};

export function createAgentSession(message: string, location: Location): AgentSession {
  cleanupExpiredSessions();

  const now = Date.now();
  const session: AgentSession = {
    id: createSessionId(),
    version: 3,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    location,
    messages: [createUserMessage(message, now)],
    attempts: [],
    candidates: [],
    actions: [],
    observations: [],
  };

  sessions.set(session.id, session);
  return session;
}

export function getAgentSession(sessionId: string): AgentSession | null {
  cleanupExpiredSessions();
  return sessions.get(sessionId) ?? null;
}

export function deleteAgentSession(sessionId: string): boolean {
  cleanupExpiredSessions();
  return sessions.delete(sessionId);
}

export function appendUserMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push(createUserMessage(content));
  return saveAgentSession(session);
}

export function appendAssistantMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push({
    role: 'assistant',
    content,
    createdAt: Date.now(),
  });
  return saveAgentSession(session);
}

export function saveAgentSession(session: AgentSession): AgentSession {
  const now = Date.now();
  session.updatedAt = now;
  session.expiresAt = now + SESSION_TTL_MS;
  sessions.set(session.id, session);
  return session;
}

export function applyRuntimeStateToSession(
  session: AgentSession,
  state: AgentRuntimeState
): AgentSession {
  if (state.goal) {
    session.goal = state.goal;
  }
  session.attempts = state.attempts;
  session.candidates = state.candidates;
  session.actions = state.actions ?? [];
  session.observations = state.observations ?? [];
  session.pendingQuestion = state.pendingQuestion;
  return saveAgentSession(session);
}

function createUserMessage(content: string, createdAt: number = Date.now()): AgentMessage {
  return {
    role: 'user',
    content,
    createdAt,
  };
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

function createSessionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
