import { D1AgentSessionStore } from './d1SessionStore';
import { setAgentSessionStore } from './session';

let configuredD1Database: D1Database | null = null;

export async function configureCloudflareAgentSessionStore(): Promise<boolean> {
  const db = await getD1DatabaseBinding();
  if (!db) {
    return false;
  }

  if (db !== configuredD1Database) {
    setAgentSessionStore(new D1AgentSessionStore(db));
    configuredD1Database = db;
  }

  return true;
}

async function getD1DatabaseBinding(): Promise<D1Database | null> {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const env = context.env as {
      CHISHA_DB?: unknown;
      chisha?: unknown;
    };

    if (isD1Database(env.CHISHA_DB)) {
      return env.CHISHA_DB;
    }

    if (isD1Database(env.chisha)) {
      return env.chisha;
    }

    return null;
  } catch {
    return null;
  }
}

function isD1Database(value: unknown): value is D1Database {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { prepare?: unknown }).prepare === 'function';
}
