import { logger } from '@/lib/logger';
import {
  type SchedulerAcquireRequest,
  type SchedulerAcquireResponse,
} from './providerSchedulerDurableObject';

export type ProviderKind = 'amap' | 'model' | 'osm' | 'active-runs' | 'session';

export interface ProviderSchedulerConfig {
  maxInFlight: number;
  ratePerSecond: number;
  requestsPerMinute: number;
  tokensPerMinute: number;
  leaseTtlMs: number;
}

interface ProviderSchedulerStub {
  acquire(request: SchedulerAcquireRequest): Promise<SchedulerAcquireResponse>;
  release(leaseId: string): Promise<boolean>;
  renew(request: { leaseId: string; leaseTtlMs: number }): Promise<boolean>;
  reportFailure(request: { category: string; cooldownMs: number }): Promise<void>;
  reportSuccess(request: { leaseId: string }): Promise<boolean>;
}

interface ProviderSchedulerNamespace {
  idFromName(name: string): unknown;
  getByName(name: string): ProviderSchedulerStub;
}

export class ProviderSchedulerError extends Error {
  constructor(
    message: string,
    public readonly kind: 'busy' | 'unavailable' | 'blocked' | 'configuration',
    public readonly retryAfterMs: number,
    public readonly providerCategory?: string
  ) {
    super(message);
    this.name = 'ProviderSchedulerError';
  }
}

export interface ProviderLease {
  readonly leaseId: string;
  readonly probe: boolean;
  release(): Promise<void>;
  renew(): Promise<boolean>;
  startAutoRenew(onFailure?: () => void): void;
  stopAutoRenew(): void;
}

const localSchedulers = new Map<string, LocalProviderScheduler>();

export async function acquireProviderLease(
  name: string,
  config: ProviderSchedulerConfig,
  options: { signal?: AbortSignal; tokenCost?: number } = {}
): Promise<ProviderLease> {
  const maxWaitMs = boundedInt(process.env.PROVIDER_MAX_WAIT_MS, 3000, 0, 5000);
  const startedAt = Date.now();
  const scheduler = await resolveScheduler(name);
  const request: SchedulerAcquireRequest = {
    config,
    tokenCost: options.tokenCost ?? 0,
  };

  while (true) {
    throwIfAborted(options.signal);
    let decision: SchedulerAcquireResponse;
    try {
      decision = await scheduler.acquire(request);
    } catch (error) {
      throw schedulerUnavailable(name, error);
    }
    if (decision.granted && decision.leaseId) {
      const lease = createLease(
        name,
        scheduler,
        decision.leaseId,
        config.leaseTtlMs,
        decision.probe
      );
      if (options.signal?.aborted) {
        await lease.release().catch(() => undefined);
        throwIfAborted(options.signal);
      }
      const waitMs = Date.now() - startedAt;
      if (waitMs > 0) {
        logger.info('Provider scheduler lease acquired', {
          provider: providerLogName(name),
          waitMs,
          queueDepth: decision.queueDepth,
          probe: decision.probe,
        });
      }
      return lease;
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = maxWaitMs - elapsedMs;
    if (remainingMs <= 0) {
      logger.warn('Provider scheduler lease rejected', {
        provider: providerLogName(name),
        reason: decision.reason,
        providerCategory: decision.blockedCategory,
        waitMs: elapsedMs,
        queueDepth: decision.queueDepth,
        retryAfterMs: decision.retryAfterMs,
      });
      throw new ProviderSchedulerError(
        `Provider capacity is busy: ${providerLogName(name)}`,
        decision.reason === 'blocked' ? 'blocked' : decision.reason === 'token_cost' ? 'configuration' : 'busy',
        Math.max(1, Math.ceil(decision.retryAfterMs / 1000) * 1000),
        decision.blockedCategory
      );
    }

    const jitterMs = Math.floor(Math.random() * 50);
    await sleepWithSignal(Math.min(remainingMs, Math.max(25, decision.retryAfterMs) + jitterMs), options.signal);
  }
}

export async function releaseProviderLease(lease: ProviderLease | undefined): Promise<void> {
  if (!lease) {
    return;
  }
  await lease.release();
}

export async function reportProviderFailure(
  name: string,
  category: string,
  cooldownMs: number
): Promise<void> {
  const scheduler = await resolveScheduler(name);
  try {
    await scheduler.reportFailure({ category, cooldownMs });
  } catch (error) {
    throw schedulerUnavailable(name, error);
  }
}

export async function reportProviderSuccess(name: string, leaseId: string): Promise<boolean> {
  const scheduler = await resolveScheduler(name);
  try {
    return await scheduler.reportSuccess({ leaseId });
  } catch (error) {
    throw schedulerUnavailable(name, error);
  }
}

export async function runWithProviderLease<T>(
  name: string,
  config: ProviderSchedulerConfig,
  operation: (lease: ProviderLease, signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; tokenCost?: number } = {}
): Promise<T> {
  const lease = await acquireProviderLease(name, config, options);
  const operationAbort = new AbortController();
  let leaseLost = false;
  const abortFromCaller = (): void => operationAbort.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  lease.startAutoRenew(() => {
    leaseLost = true;
    operationAbort.abort();
  });
  try {
    return await operation(lease, operationAbort.signal);
  } catch (error) {
    if (leaseLost) {
      throw new ProviderSchedulerError(
        `Provider scheduler lease was lost: ${providerLogName(name)}`,
        'unavailable',
        30_000
      );
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abortFromCaller);
    lease.stopAutoRenew();
    try {
      await lease.release();
    } catch (error) {
      logger.warn('Provider scheduler lease release failed; expiry will reclaim it', {
        provider: providerLogName(name),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function providerSchedulerName(kind: ProviderKind, discriminator = ''): string {
  if (kind === 'session') {
    return `session:${discriminator}`;
  }
  if (kind === 'model') {
    return `model:${stableHash(discriminator)}`;
  }
  return kind;
}

export function getProviderSchedulerConfig(kind: ProviderKind): ProviderSchedulerConfig {
  const leaseTtlMs = boundedInt(process.env.PROVIDER_LEASE_TTL_MS, 120_000, 30_000, 300_000);
  if (kind === 'amap') {
    return {
      maxInFlight: boundedInt(process.env.AMAP_MAX_INFLIGHT, 6, 1, 100),
      ratePerSecond: boundedNumber(process.env.AMAP_SAFE_QPS ?? process.env.AMAP_MAX_QPS, 4, 0.1, 1000),
      requestsPerMinute: 0,
      tokensPerMinute: 0,
      leaseTtlMs,
    };
  }
  if (kind === 'model') {
    return {
      maxInFlight: boundedInt(process.env.MODEL_MAX_INFLIGHT, 4, 1, 100),
      ratePerSecond: 0,
      requestsPerMinute: boundedInt(process.env.MODEL_RPM_LIMIT, 0, 0, 100_000),
      tokensPerMinute: boundedInt(process.env.MODEL_TPM_LIMIT, 0, 0, 10_000_000),
      leaseTtlMs,
    };
  }
  if (kind === 'osm') {
    return {
      maxInFlight: boundedInt(process.env.OSM_MAX_INFLIGHT, 1, 1, 20),
      ratePerSecond: boundedNumber(process.env.OSM_SAFE_QPS, 1, 0.1, 100),
      requestsPerMinute: 0,
      tokensPerMinute: 0,
      leaseTtlMs,
    };
  }
  if (kind === 'active-runs') {
    return {
      maxInFlight: boundedInt(process.env.AGENT_MAX_ACTIVE_RUNS, 3, 1, 100),
      ratePerSecond: 0,
      requestsPerMinute: 0,
      tokensPerMinute: 0,
      leaseTtlMs,
    };
  }
  return {
    maxInFlight: 1,
    ratePerSecond: 0,
    requestsPerMinute: 0,
    tokensPerMinute: 0,
    leaseTtlMs,
  };
}

async function resolveScheduler(name: string): Promise<ProviderSchedulerStub> {
  if (process.env.PROVIDER_SCHEDULER_MODE === 'local' || process.env.NODE_ENV === 'test') {
    let scheduler = localSchedulers.get(name);
    if (!scheduler) {
      scheduler = new LocalProviderScheduler();
      localSchedulers.set(name, scheduler);
    }
    return scheduler;
  }

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    const candidate = (context.env as Record<string, unknown>).PROVIDER_SCHEDULER;
    if (isProviderSchedulerNamespace(candidate)) {
      return candidate.getByName(name);
    }
  } catch (error) {
    logger.error('Unable to resolve ProviderScheduler Durable Object', {
      provider: providerLogName(name),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  throw new ProviderSchedulerError(
    'Provider scheduler binding is not configured',
    'unavailable',
    30_000
  );
}

function createLease(
  providerName: string,
  scheduler: ProviderSchedulerStub,
  leaseId: string,
  leaseTtlMs: number,
  probe: boolean
): ProviderLease {
  let released = false;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  const acquiredAt = Date.now();

  const stopAutoRenew = (): void => {
    if (renewTimer) {
      clearInterval(renewTimer);
      renewTimer = undefined;
    }
  };

  return {
    leaseId,
    probe,
    async release() {
      if (released) {
        return;
      }
      released = true;
      stopAutoRenew();
      const removed = await scheduler.release(leaseId);
      logger.info('Provider scheduler lease released', {
        provider: providerLogName(providerName),
        leaseAgeMs: Date.now() - acquiredAt,
        removed,
      });
    },
    async renew() {
      if (released) {
        return false;
      }
      return scheduler.renew({ leaseId, leaseTtlMs });
    },
    startAutoRenew(onFailure) {
      if (renewTimer || released) {
        return;
      }
      renewTimer = setInterval(() => {
        void scheduler.renew({ leaseId, leaseTtlMs })
          .then((renewed) => {
            if (released) {
              return;
            }
            if (!renewed) {
              logger.warn('Provider scheduler lease expired before renewal', {
                provider: providerLogName(providerName),
                leaseId,
              });
              stopAutoRenew();
              onFailure?.();
            }
          })
          .catch((error) => {
            if (released) {
              return;
            }
            logger.warn('Provider scheduler lease renewal failed', {
              provider: providerLogName(providerName),
              leaseId,
              error: error instanceof Error ? error.message : String(error),
            });
            stopAutoRenew();
            onFailure?.();
          });
      }, Math.max(5_000, Math.floor(leaseTtlMs / 3)));
      if (typeof (renewTimer as { unref?: () => void }).unref === 'function') {
        (renewTimer as { unref: () => void }).unref();
      }
    },
    stopAutoRenew,
  };
}

class LocalProviderScheduler implements ProviderSchedulerStub {
  private state = createLocalState();

  async acquire(request: SchedulerAcquireRequest): Promise<SchedulerAcquireResponse> {
    const { acquireLease } = await import('./providerSchedulerCore');
    return acquireLease(this.state, request.config, Date.now(), request.tokenCost ?? 0);
  }

  async release(leaseId: string): Promise<boolean> {
    const { releaseLease } = await import('./providerSchedulerCore');
    return releaseLease(this.state, leaseId);
  }

  async renew(request: { leaseId: string; leaseTtlMs: number }): Promise<boolean> {
    const { renewLease } = await import('./providerSchedulerCore');
    return renewLease(this.state, request.leaseId, Date.now(), request.leaseTtlMs);
  }

  async reportFailure(request: { category: string; cooldownMs: number }): Promise<void> {
    const { reportFailure } = await import('./providerSchedulerCore');
    reportFailure(this.state, Date.now(), request.category, request.cooldownMs);
  }

  async reportSuccess(request: { leaseId: string }): Promise<boolean> {
    const { reportSuccess } = await import('./providerSchedulerCore');
    return reportSuccess(this.state, request.leaseId);
  }
}

function createLocalState() {
  return {
    ...({
      leases: {},
      initialized: false,
      nextLeaseId: 1,
      qpsTokens: 0,
      qpsUpdatedAt: Date.now(),
      rpmTokens: 0,
      rpmUpdatedAt: Date.now(),
      tpmTokens: 0,
      tpmUpdatedAt: Date.now(),
      blockedUntil: 0,
    }),
  } as import('./providerSchedulerCore').SchedulerState;
}

function isProviderSchedulerNamespace(value: unknown): value is ProviderSchedulerNamespace {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { getByName?: unknown }).getByName === 'function'
    && typeof (value as { idFromName?: unknown }).idFromName === 'function';
}

function schedulerUnavailable(name: string, error: unknown): ProviderSchedulerError {
  if (error instanceof ProviderSchedulerError) {
    return error;
  }
  logger.error('Provider scheduler RPC failed', {
    provider: providerLogName(name),
    error: error instanceof Error ? error.message : String(error),
  });
  return new ProviderSchedulerError('Provider scheduler is unavailable', 'unavailable', 30_000);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  throw error;
}

function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) {
      onAbort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function providerLogName(name: string): string {
  return name.startsWith('session:') ? `session:${stableHash(name)}` : name;
}
