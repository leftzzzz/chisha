export interface SchedulerConfig {
  maxInFlight: number;
  ratePerSecond: number;
  requestsPerMinute: number;
  tokensPerMinute: number;
  leaseTtlMs: number;
}

export interface SchedulerLeaseRecord {
  expiresAt: number;
  tokenCost: number;
}

export interface SchedulerState {
  leases: Record<string, SchedulerLeaseRecord>;
  initialized: boolean;
  nextLeaseId: number;
  qpsTokens: number;
  qpsUpdatedAt: number;
  rpmTokens: number;
  rpmUpdatedAt: number;
  tpmTokens: number;
  tpmUpdatedAt: number;
  blockedUntil: number;
  blockedCategory?: string;
  probeLeaseId?: string;
}

export interface AcquireDecision {
  granted: boolean;
  leaseId?: string;
  retryAfterMs: number;
  queueDepth: number;
  reason?: 'in_flight' | 'rate' | 'blocked' | 'token_cost';
  blockedCategory?: string;
  probe: boolean;
}

export function createSchedulerState(now: number): SchedulerState {
  return {
    leases: {},
    initialized: false,
    nextLeaseId: 1,
    qpsTokens: 0,
    qpsUpdatedAt: now,
    rpmTokens: 0,
    rpmUpdatedAt: now,
    tpmTokens: 0,
    tpmUpdatedAt: now,
    blockedUntil: 0,
  };
}

export function pruneExpiredLeases(state: SchedulerState, now: number): void {
  for (const [leaseId, lease] of Object.entries(state.leases)) {
    if (lease.expiresAt <= now) {
      delete state.leases[leaseId];
      if (state.probeLeaseId === leaseId) {
        state.probeLeaseId = undefined;
      }
    }
  }
}

export function acquireLease(
  state: SchedulerState,
  config: SchedulerConfig,
  now: number,
  tokenCost = 0
): AcquireDecision {
  pruneExpiredLeases(state, now);
  refillBuckets(state, config, now);

  const queueDepth = Object.keys(state.leases).length;
  const probe = state.blockedUntil > 0 && state.blockedUntil <= now;

  if (state.blockedUntil > now) {
    return {
      granted: false,
      retryAfterMs: Math.max(100, state.blockedUntil - now),
      queueDepth,
      reason: 'blocked',
      blockedCategory: state.blockedCategory,
      probe: false,
    };
  }

  if (probe && state.probeLeaseId) {
    return {
      granted: false,
      retryAfterMs: 1000,
      queueDepth,
      reason: 'blocked',
      blockedCategory: state.blockedCategory,
      probe: false,
    };
  }

  if (config.tokensPerMinute > 0 && tokenCost > config.tokensPerMinute) {
    return {
      granted: false,
      retryAfterMs: 60_000,
      queueDepth,
      reason: 'token_cost',
      probe: false,
    };
  }

  if (queueDepth >= config.maxInFlight) {
    return {
      granted: false,
      retryAfterMs: 250,
      queueDepth,
      reason: 'in_flight',
      probe: false,
    };
  }

  const retryAfterMs = Math.max(
    bucketWaitMs(state.qpsTokens, 1, config.ratePerSecond, 1000),
    bucketWaitMs(state.rpmTokens, 1, config.requestsPerMinute, 60_000),
    bucketWaitMs(state.tpmTokens, tokenCost, config.tokensPerMinute, 60_000)
  );

  if (retryAfterMs > 0) {
    return {
      granted: false,
      retryAfterMs,
      queueDepth,
      reason: 'rate',
      probe: false,
    };
  }

  const leaseId = `lease_${state.nextLeaseId++}`;
  state.leases[leaseId] = {
    expiresAt: now + config.leaseTtlMs,
    tokenCost,
  };
  consumeBucket(state, config, tokenCost);
  if (probe) {
    state.probeLeaseId = leaseId;
  }

  return {
    granted: true,
    leaseId,
    retryAfterMs: 0,
    queueDepth,
    probe,
  };
}

export function releaseLease(state: SchedulerState, leaseId: string): boolean {
  const existed = Boolean(state.leases[leaseId]);
  delete state.leases[leaseId];
  if (state.probeLeaseId === leaseId) {
    state.probeLeaseId = undefined;
  }
  return existed;
}

export function renewLease(
  state: SchedulerState,
  leaseId: string,
  now: number,
  leaseTtlMs: number
): boolean {
  const lease = state.leases[leaseId];
  if (!lease || lease.expiresAt <= now) {
    if (lease) {
      delete state.leases[leaseId];
    }
    return false;
  }

  lease.expiresAt = now + leaseTtlMs;
  return true;
}

export function reportFailure(
  state: SchedulerState,
  now: number,
  category: string,
  cooldownMs: number
): void {
  state.blockedCategory = category;
  state.blockedUntil = Math.max(state.blockedUntil, now + Math.max(1000, cooldownMs));
}

export function reportSuccess(state: SchedulerState, leaseId: string): boolean {
  // Only the single half-open probe may close a circuit. A request acquired
  // before a later failure must not erase that failure when it eventually wins.
  if (!state.probeLeaseId || state.probeLeaseId !== leaseId) {
    return false;
  }
  state.blockedUntil = 0;
  state.blockedCategory = undefined;
  state.probeLeaseId = undefined;
  return true;
}

export function nextWakeAt(state: SchedulerState, now: number): number | null {
  const leaseExpiry = Object.values(state.leases)
    .map((lease) => lease.expiresAt)
    .filter((value) => value > now)
    .sort((a, b) => a - b)[0];
  const blockedExpiry = state.blockedUntil > now ? state.blockedUntil : undefined;
  const next = [leaseExpiry, blockedExpiry].filter((value): value is number => value !== undefined);
  return next.length > 0 ? Math.min(...next) : null;
}

function refillBuckets(state: SchedulerState, config: SchedulerConfig, now: number): void {
  const qpsCapacity = shortBurstCapacity(config.ratePerSecond, 1000);
  const rpmCapacity = shortBurstCapacity(config.requestsPerMinute, 60_000);
  // A model request can legitimately exceed one second of TPM. Keep a full
  // minute of token capacity while still reserving every request before send.
  const tpmCapacity = config.tokensPerMinute > 0 ? config.tokensPerMinute : 0;

  if (!state.initialized) {
    state.qpsTokens = qpsCapacity;
    state.rpmTokens = rpmCapacity;
    state.tpmTokens = tpmCapacity;
    state.qpsUpdatedAt = now;
    state.rpmUpdatedAt = now;
    state.tpmUpdatedAt = now;
    state.initialized = true;
    return;
  }

  state.qpsTokens = refill(state.qpsTokens, state.qpsUpdatedAt, now, config.ratePerSecond, 1000, qpsCapacity);
  state.qpsUpdatedAt = now;
  state.rpmTokens = refill(state.rpmTokens, state.rpmUpdatedAt, now, config.requestsPerMinute, 60_000, rpmCapacity);
  state.rpmUpdatedAt = now;
  state.tpmTokens = refill(state.tpmTokens, state.tpmUpdatedAt, now, config.tokensPerMinute, 60_000, tpmCapacity);
  state.tpmUpdatedAt = now;

}

function refill(
  tokens: number,
  updatedAt: number,
  now: number,
  rate: number,
  periodMs: number,
  capacity: number
): number {
  if (rate <= 0) {
    return 0;
  }

  const elapsedMs = Math.max(0, now - updatedAt);
  return Math.min(capacity, tokens + elapsedMs * rate / periodMs);
}

function consumeBucket(state: SchedulerState, config: SchedulerConfig, tokenCost: number): void {
  if (config.ratePerSecond > 0) {
    state.qpsTokens = Math.max(0, state.qpsTokens - 1);
  }
  if (config.requestsPerMinute > 0) {
    state.rpmTokens = Math.max(0, state.rpmTokens - 1);
  }
  if (config.tokensPerMinute > 0) {
    state.tpmTokens = Math.max(0, state.tpmTokens - tokenCost);
  }
}

function bucketWaitMs(tokens: number, required: number, rate: number, periodMs: number): number {
  if (rate <= 0 || required <= tokens) {
    return 0;
  }

  return Math.max(25, Math.ceil((required - tokens) * periodMs / rate));
}

function shortBurstCapacity(rate: number, periodMs: number): number {
  return rate > 0 ? Math.max(1, rate * 1000 / periodMs) : 0;
}
