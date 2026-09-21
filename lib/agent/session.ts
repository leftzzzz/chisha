import { persistableTrace } from './tracePersistence';
import { AgentError } from './types';
import type {
  AgentMessage,
  AgentRuntimeState,
  AgentSession,
} from './types';
import type { Location } from '@/types';

const sessions = new Map<string, AgentSession>();
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface AgentSessionStore {
  create(message: string, location: Location, ownerId?: string): AgentSession;
  get(sessionId: string): AgentSession | null;
  save(session: AgentSession): AgentSession;
  delete(sessionId: string): boolean;
  createAsync?: (message: string, location: Location, ownerId?: string) => Promise<AgentSession>;
  getAsync?: (sessionId: string) => Promise<AgentSession | null>;
  saveAsync?: (session: AgentSession) => Promise<AgentSession>;
  deleteAsync?: (sessionId: string) => Promise<boolean>;
}

export const inMemoryAgentSessionStore: AgentSessionStore = {
  create: createInMemoryAgentSession,
  get: getInMemoryAgentSession,
  save: saveInMemoryAgentSession,
  delete: deleteInMemoryAgentSession,
};

let activeAgentSessionStore: AgentSessionStore = inMemoryAgentSessionStore;

export function setAgentSessionStore(store: AgentSessionStore): void {
  activeAgentSessionStore = store;
}

export function resetAgentSessionStore(): void {
  activeAgentSessionStore = inMemoryAgentSessionStore;
}

export function createAgentSession(message: string, location: Location, ownerId?: string): AgentSession {
  return activeAgentSessionStore.create(message, location, ownerId);
}

export async function createAgentSessionAsync(
  message: string,
  location: Location,
  ownerId?: string
): Promise<AgentSession> {
  return activeAgentSessionStore.createAsync
    ? activeAgentSessionStore.createAsync(message, location, ownerId)
    : activeAgentSessionStore.create(message, location, ownerId);
}

export function getAgentSession(sessionId: string): AgentSession | null {
  return activeAgentSessionStore.get(sessionId);
}

export async function getAgentSessionAsync(sessionId: string): Promise<AgentSession | null> {
  return activeAgentSessionStore.getAsync
    ? activeAgentSessionStore.getAsync(sessionId)
    : activeAgentSessionStore.get(sessionId);
}

export function deleteAgentSession(sessionId: string): boolean {
  return activeAgentSessionStore.delete(sessionId);
}

export async function deleteAgentSessionAsync(sessionId: string): Promise<boolean> {
  return activeAgentSessionStore.deleteAsync
    ? activeAgentSessionStore.deleteAsync(sessionId)
    : activeAgentSessionStore.delete(sessionId);
}

export function saveAgentSession(session: AgentSession): AgentSession {
  return activeAgentSessionStore.save(session);
}

export async function saveAgentSessionAsync(session: AgentSession): Promise<AgentSession> {
  try {
    return await (activeAgentSessionStore.saveAsync
      ? activeAgentSessionStore.saveAsync(session)
      : activeAgentSessionStore.save(session));
  } catch (cause) {
    throw new AgentError('会话保存失败，请稍后重试。', 'SESSION_PERSIST_FAILED', true, { cause });
  }
}

function createInMemoryAgentSession(message: string, location: Location, ownerId?: string): AgentSession {
  cleanupExpiredSessions();

  const now = Date.now();
  const session: AgentSession = {
    id: createSessionId(),
    version: 4,
    ownerId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    location,
    messages: [createUserMessage(message, now)],
    attempts: [],
    candidates: [],
    actions: [],
    observations: [],
    trace: [],
  };

  sessions.set(session.id, session);
  return session;
}

function getInMemoryAgentSession(sessionId: string): AgentSession | null {
  cleanupExpiredSessions();
  return sessions.get(sessionId) ?? null;
}

function deleteInMemoryAgentSession(sessionId: string): boolean {
  cleanupExpiredSessions();
  return sessions.delete(sessionId);
}

export function appendUserMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push(createUserMessage(content));
  return saveAgentSession(session);
}

export async function appendUserMessageAsync(session: AgentSession, content: string): Promise<AgentSession> {
  session.messages.push(createUserMessage(content));
  return saveAgentSessionAsync(session);
}

export function appendAssistantMessage(session: AgentSession, content: string): AgentSession {
  session.messages.push({
    role: 'assistant',
    content,
    createdAt: Date.now(),
  });
  return saveAgentSession(session);
}

export async function appendAssistantMessageAsync(session: AgentSession, content: string): Promise<AgentSession> {
  session.messages.push({
    role: 'assistant',
    content,
    createdAt: Date.now(),
  });
  return saveAgentSessionAsync(session);
}

function saveInMemoryAgentSession(session: AgentSession): AgentSession {
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
  session.trace = persistableTrace(state.trace ?? session.trace);
  session.pendingQuestion = state.pendingQuestion;
  session.lastQuestionFingerprint = state.lastQuestionFingerprint;
  session.consecutiveAskTurns = state.consecutiveAskTurns ?? 0;
  return saveAgentSession(session);
}

export async function applyRuntimeStateToSessionAsync(
  session: AgentSession,
  state: AgentRuntimeState
): Promise<AgentSession> {
  if (state.goal) {
    session.goal = state.goal;
  }
  session.attempts = state.attempts;
  session.candidates = state.candidates;
  session.actions = state.actions ?? [];
  session.observations = state.observations ?? [];
  session.trace = persistableTrace(state.trace ?? session.trace);
  session.pendingQuestion = state.pendingQuestion;
  session.lastQuestionFingerprint = state.lastQuestionFingerprint;
  session.consecutiveAskTurns = state.consecutiveAskTurns ?? 0;
  return saveAgentSessionAsync(session);
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
