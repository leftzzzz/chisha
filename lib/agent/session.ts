import type { AgentMessage, AgentSession } from './types';
import type { Location } from '@/types';

const sessions = new Map<string, AgentSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = 'agent_state_';

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
  return sessions.get(sessionId) ?? decodeSessionToken(sessionId);
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

export function createAgentSessionToken(session: AgentSession): string {
  return `${TOKEN_PREFIX}${toBase64Url(JSON.stringify(session))}`;
}

function decodeSessionToken(sessionId: string): AgentSession | null {
  if (!sessionId.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  try {
    const decoded = JSON.parse(fromBase64Url(sessionId.slice(TOKEN_PREFIX.length))) as AgentSession;
    if (!decoded.id || !decoded.messages || decoded.updatedAt < Date.now() - SESSION_TTL_MS) {
      return null;
    }
    sessions.set(decoded.id, decoded);
    return decoded;
  } catch {
    return null;
  }
}

function toBase64Url(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
