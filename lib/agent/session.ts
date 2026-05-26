import type { AgentMessage, AgentSession } from './types';
import type { Location } from '@/types';

const sessions = new Map<string, AgentSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export function createAgentSession(message: string, location: Location): AgentSession {
  cleanupExpiredSessions();

  const now = Date.now();
  const session: AgentSession = {
    id: createSessionId(),
    createdAt: now,
    updatedAt: now,
    location,
    messages: [createUserMessage(message, now)],
    attempts: [],
    candidates: [],
  };

  sessions.set(session.id, session);
  return session;
}

export function getAgentSession(sessionId: string): AgentSession | null {
  cleanupExpiredSessions();
  return sessions.get(sessionId) ?? null;
}

export function appendUserMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push(createUserMessage(content));
  session.updatedAt = Date.now();
  sessions.set(session.id, session);
  return session;
}

export function appendAssistantMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push({
    role: 'assistant',
    content,
    createdAt: Date.now(),
  });
  session.updatedAt = Date.now();
  sessions.set(session.id, session);
  return session;
}

export function saveAgentSession(session: AgentSession): AgentSession {
  session.updatedAt = Date.now();
  sessions.set(session.id, session);
  return session;
}

export function getSessionQuery(session: AgentSession): string {
  return session.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('，');
}

function createUserMessage(content: string, createdAt: number = Date.now()): AgentMessage {
  return {
    role: 'user',
    content,
    createdAt,
  };
}

function cleanupExpiredSessions(): void {
  const expiresBefore = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.updatedAt < expiresBefore) {
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
