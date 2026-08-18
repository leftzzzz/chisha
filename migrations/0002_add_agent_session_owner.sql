-- D1 migration: bind anonymous agent sessions to a signed browser owner.

ALTER TABLE agent_sessions ADD COLUMN owner_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_owner_id
  ON agent_sessions (owner_id);
