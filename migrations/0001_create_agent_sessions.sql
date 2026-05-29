-- D1 migration: Agent session persistence.
-- Apply with:
--   npx wrangler d1 migrations apply <database_name> --local
--   npx wrangler d1 migrations apply <database_name> --remote

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 3,
  location_json TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  runtime_state_json TEXT NOT NULL DEFAULT '{}',
  pending_question_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_expires_at
  ON agent_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated_at
  ON agent_sessions (updated_at);
