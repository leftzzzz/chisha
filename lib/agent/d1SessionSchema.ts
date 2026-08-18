import { normalizeStoredPendingQuestion } from './schemas/clarification';
import type { AgentRuntimeState, AgentSession } from './types';
import type { Location } from '@/types';

export interface AgentSessionD1Row {
  id: string;
  version: number;
  owner_id: string | null;
  location_json: string;
  messages_json: string;
  runtime_state_json: string;
  pending_question_json: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

export function agentSessionToD1Row(session: AgentSession): AgentSessionD1Row {
  return {
    id: session.id,
    version: session.version,
    owner_id: session.ownerId ?? null,
    location_json: JSON.stringify(session.location),
    messages_json: JSON.stringify(session.messages),
    runtime_state_json: JSON.stringify({
      goal: session.goal,
      attempts: session.attempts,
      candidates: session.candidates,
      actions: session.actions,
      observations: session.observations,
      trace: session.trace,
      lastQuestionFingerprint: session.lastQuestionFingerprint,
      consecutiveAskTurns: session.consecutiveAskTurns,
    } satisfies AgentRuntimeState),
    pending_question_json: session.pendingQuestion
      ? JSON.stringify(session.pendingQuestion)
      : null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    expires_at: session.expiresAt,
  };
}

export function agentSessionFromD1Row(row: AgentSessionD1Row): AgentSession {
  const runtimeState = JSON.parse(row.runtime_state_json) as Partial<AgentRuntimeState>;

  return {
    id: row.id,
    version: 4,
    ownerId: row.owner_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    location: JSON.parse(row.location_json) as Location,
    messages: JSON.parse(row.messages_json) as AgentSession['messages'],
    goal: runtimeState.goal,
    attempts: runtimeState.attempts ?? [],
    candidates: runtimeState.candidates ?? [],
    actions: runtimeState.actions ?? [],
    observations: runtimeState.observations ?? [],
    trace: runtimeState.trace ?? [],
    // 旧会话（version 3）存的是 `options: string[]` 与以文案为 key 的
    // optionEffects，读出来先升级成 id 协议再用。
    pendingQuestion: row.pending_question_json
      ? normalizeStoredPendingQuestion(JSON.parse(row.pending_question_json)) as AgentSession['pendingQuestion']
      : undefined,
    lastQuestionFingerprint: runtimeState.lastQuestionFingerprint,
    consecutiveAskTurns: runtimeState.consecutiveAskTurns ?? 0,
  };
}
