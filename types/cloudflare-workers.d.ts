interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta: {
    changes?: number;
    [key: string]: unknown;
  };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface ChishaDurableObjectSqlCursor<T extends Record<string, unknown>> {
  toArray(): T[];
}

interface ChishaDurableObjectSql {
  exec<T extends Record<string, unknown>>(
    query: string,
    ...bindings: unknown[]
  ): ChishaDurableObjectSqlCursor<T>;
}

interface ChishaDurableObjectStorage {
  sql: ChishaDurableObjectSql;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface ChishaDurableObjectState {
  storage: ChishaDurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject {
    protected ctx: ChishaDurableObjectState;
    protected env: unknown;
    constructor(ctx: ChishaDurableObjectState, env: unknown);
  }
}
