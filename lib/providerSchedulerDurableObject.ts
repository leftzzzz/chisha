import { DurableObject } from 'cloudflare:workers';
import {
  acquireLease,
  createSchedulerState,
  nextWakeAt,
  pruneExpiredLeases,
  releaseLease,
  renewLease,
  reportFailure,
  reportSuccess,
  type SchedulerConfig,
  type SchedulerState,
} from './providerSchedulerCore';

export interface SchedulerAcquireRequest {
  config: SchedulerConfig;
  tokenCost?: number;
}

export interface SchedulerAcquireResponse {
  granted: boolean;
  leaseId?: string;
  retryAfterMs: number;
  queueDepth: number;
  reason?: 'in_flight' | 'rate' | 'blocked' | 'token_cost';
  blockedCategory?: string;
  probe: boolean;
}

export interface SchedulerRenewRequest {
  leaseId: string;
  leaseTtlMs: number;
}

export interface SchedulerFailureRequest {
  category: string;
  cooldownMs: number;
}

export interface SchedulerSuccessRequest {
  leaseId: string;
}

export class ProviderSchedulerDurableObject extends DurableObject {
  private readonly initialization: Promise<void>;

  constructor(ctx: ChishaDurableObjectState, env: unknown) {
    super(ctx, env);
    this.initialization = ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        'CREATE TABLE IF NOT EXISTS provider_scheduler_state (id INTEGER PRIMARY KEY, state TEXT NOT NULL)'
      );
    });
  }

  async acquire(request: SchedulerAcquireRequest): Promise<SchedulerAcquireResponse> {
    return this.withState((state) => acquireLease(
      state,
      request.config,
      Date.now(),
      request.tokenCost ?? 0
    ));
  }

  async release(leaseId: string): Promise<boolean> {
    return this.withState((state) => releaseLease(state, leaseId));
  }

  async renew(request: SchedulerRenewRequest): Promise<boolean> {
    return this.withState((state) => renewLease(
      state,
      request.leaseId,
      Date.now(),
      request.leaseTtlMs
    ));
  }

  async reportFailure(request: SchedulerFailureRequest): Promise<void> {
    await this.withState((state) => {
      reportFailure(state, Date.now(), request.category, request.cooldownMs);
    });
  }

  async reportSuccess(request: SchedulerSuccessRequest): Promise<boolean> {
    return this.withState((state) => reportSuccess(state, request.leaseId));
  }

  async alarm(): Promise<void> {
    await this.initialization;
    await this.ctx.blockConcurrencyWhile(async () => {
      const state = this.readState();
      pruneExpiredLeases(state, Date.now());
      this.writeState(state);
      await this.scheduleNextAlarm(state);
    });
  }

  private async withState<T>(mutate: (state: SchedulerState) => T | Promise<T>): Promise<T> {
    await this.initialization;
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = this.readState();
      const result = await mutate(state);
      this.writeState(state);
      await this.scheduleNextAlarm(state);
      return result;
    });
  }

  private readState(): SchedulerState {
    const rows = this.ctx.storage.sql
      .exec<{ state: string }>('SELECT state FROM provider_scheduler_state WHERE id = 1')
      .toArray();
    if (rows.length === 0) {
      return createSchedulerState(Date.now());
    }

    try {
      const state: unknown = JSON.parse(rows[0].state);
      if (!isSchedulerState(state)) {
        throw new Error('invalid scheduler state shape');
      }
      return state;
    } catch (error) {
      // Resetting would silently clear active leases and circuits, temporarily
      // exceeding provider capacity. State corruption therefore fails closed.
      throw new Error(
        `Provider scheduler state is corrupted: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private writeState(state: SchedulerState): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO provider_scheduler_state (id, state) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state`,
      JSON.stringify(state)
    );
  }

  private async scheduleNextAlarm(state: SchedulerState): Promise<void> {
    const next = nextWakeAt(state, Date.now());
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(next);
  }
}

function isSchedulerState(value: unknown): value is SchedulerState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as Partial<SchedulerState>;
  return typeof state.leases === 'object'
    && state.leases !== null
    && typeof state.initialized === 'boolean'
    && isFiniteNumber(state.nextLeaseId)
    && isFiniteNumber(state.qpsTokens)
    && isFiniteNumber(state.qpsUpdatedAt)
    && isFiniteNumber(state.rpmTokens)
    && isFiniteNumber(state.rpmUpdatedAt)
    && isFiniteNumber(state.tpmTokens)
    && isFiniteNumber(state.tpmUpdatedAt)
    && isFiniteNumber(state.blockedUntil);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
