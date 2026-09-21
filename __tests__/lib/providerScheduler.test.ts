/**
 * @jest-environment node
 */

const mockGetCloudflareContext = jest.fn();

jest.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: Parameters<typeof mockGetCloudflareContext>) => mockGetCloudflareContext(...args),
}));

import {
  acquireProviderLease,
  getProviderSchedulerConfig,
  ProviderSchedulerError,
  providerSchedulerName,
  releaseProviderLease,
  reportProviderFailure,
  reportProviderSuccess,
  runWithProviderLease,
  type ProviderSchedulerConfig,
} from '@/lib/providerScheduler';

const config: ProviderSchedulerConfig = {
  maxInFlight: 1,
  ratePerSecond: 0,
  requestsPerMinute: 0,
  tokensPerMinute: 0,
  leaseTtlMs: 30_000,
};

describe('provider scheduler client', () => {
  const managedEnvironment = [
    'NODE_ENV',
    'PROVIDER_SCHEDULER_MODE',
    'PROVIDER_MAX_WAIT_MS',
    'PROVIDER_LEASE_TTL_MS',
    'AMAP_MAX_INFLIGHT',
    'AMAP_SAFE_QPS',
    'AMAP_MAX_QPS',
    'MODEL_MAX_INFLIGHT',
    'MODEL_RPM_LIMIT',
    'MODEL_TPM_LIMIT',
    'OSM_MAX_INFLIGHT',
    'OSM_SAFE_QPS',
    'AGENT_MAX_ACTIVE_RUNS',
  ] as const;
  const originalEnvironment = Object.fromEntries(
    managedEnvironment.map((name) => [name, process.env[name]])
  );

  function configureRemoteScheduler() {
    process.env.NODE_ENV = 'production';
    delete process.env.PROVIDER_SCHEDULER_MODE;
    const scheduler = {
      acquire: jest.fn(async () => ({
        granted: true,
        leaseId: 'remote-lease',
        probe: true,
        queueDepth: 0,
        retryAfterMs: 0,
      })),
      release: jest.fn(async () => true),
      renew: jest.fn(async () => true),
      reportFailure: jest.fn(async () => undefined),
      reportSuccess: jest.fn(async () => true),
    };
    const namespace = {
      idFromName: jest.fn(),
      getByName: jest.fn(() => scheduler),
    };
    mockGetCloudflareContext.mockResolvedValue({
      env: { PROVIDER_SCHEDULER: namespace },
    });
    return { scheduler, namespace };
  }

  afterEach(() => {
    jest.useRealTimers();
    mockGetCloudflareContext.mockReset();
    for (const name of managedEnvironment) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('enforces a single session lease and permits the next turn after release', async () => {
    process.env.PROVIDER_MAX_WAIT_MS = '0';
    const name = `session:test-${Date.now()}-${Math.random()}`;
    const first = await acquireProviderLease(name, config);

    await expect(acquireProviderLease(name, config)).rejects.toMatchObject({
      kind: 'busy',
    } satisfies Partial<ProviderSchedulerError>);

    await first.release();
    const next = await acquireProviderLease(name, config);
    await next.release();
  });

  it('builds bounded provider configs and stable scheduler names', () => {
    process.env.PROVIDER_LEASE_TTL_MS = '1';
    process.env.AMAP_MAX_INFLIGHT = '999';
    process.env.AMAP_SAFE_QPS = 'invalid';
    expect(getProviderSchedulerConfig('amap')).toEqual({
      maxInFlight: 100,
      ratePerSecond: 4,
      requestsPerMinute: 0,
      tokensPerMinute: 0,
      leaseTtlMs: 30_000,
    });

    delete process.env.AMAP_SAFE_QPS;
    process.env.AMAP_MAX_QPS = '0.01';
    expect(getProviderSchedulerConfig('amap').ratePerSecond).toBe(0.1);

    process.env.MODEL_MAX_INFLIGHT = '-1';
    process.env.MODEL_RPM_LIMIT = '200000';
    process.env.MODEL_TPM_LIMIT = 'invalid';
    expect(getProviderSchedulerConfig('model')).toMatchObject({
      maxInFlight: 1,
      requestsPerMinute: 100_000,
      tokensPerMinute: 0,
    });

    process.env.OSM_MAX_INFLIGHT = '99';
    delete process.env.OSM_SAFE_QPS;
    expect(getProviderSchedulerConfig('osm')).toMatchObject({ maxInFlight: 20, ratePerSecond: 1 });

    process.env.AGENT_MAX_ACTIVE_RUNS = '0';
    expect(getProviderSchedulerConfig('active-runs').maxInFlight).toBe(1);
    expect(getProviderSchedulerConfig('session').maxInFlight).toBe(1);
    expect(providerSchedulerName('session', 'abc')).toBe('session:abc');
    expect(providerSchedulerName('model')).toMatch(/^model:[0-9a-f]+$/);
    expect(providerSchedulerName('osm')).toBe('osm');
  });

  it('uses a remote scheduler for lease lifecycle and provider reports', async () => {
    const { scheduler, namespace } = configureRemoteScheduler();
    await releaseProviderLease(undefined);

    const lease = await acquireProviderLease('remote-provider', config, { tokenCost: 12 });
    expect(namespace.getByName).toHaveBeenCalledWith('remote-provider');
    expect(scheduler.acquire).toHaveBeenCalledWith({ config, tokenCost: 12 });
    expect(lease.probe).toBe(true);
    await expect(lease.renew()).resolves.toBe(true);

    lease.startAutoRenew();
    lease.startAutoRenew();
    lease.stopAutoRenew();
    await releaseProviderLease(lease);
    await expect(lease.renew()).resolves.toBe(false);
    await lease.release();
    lease.startAutoRenew();

    await reportProviderFailure('remote-provider', 'quota', 5000);
    await expect(reportProviderSuccess('remote-provider', 'remote-lease')).resolves.toBe(true);
    expect(scheduler.reportFailure).toHaveBeenCalledWith({ category: 'quota', cooldownMs: 5000 });
    expect(scheduler.reportSuccess).toHaveBeenCalledWith({ leaseId: 'remote-lease' });
  });

  it('preserves scheduler errors and normalizes other remote failures', async () => {
    const { scheduler } = configureRemoteScheduler();
    const expected = new ProviderSchedulerError('blocked upstream', 'blocked', 7000, 'quota');
    scheduler.acquire.mockRejectedValueOnce(expected);
    await expect(acquireProviderLease('remote-error-1', config)).rejects.toBe(expected);

    scheduler.acquire.mockRejectedValueOnce(new Error('offline'));
    await expect(acquireProviderLease('remote-error-2', config)).rejects.toMatchObject({
      kind: 'unavailable',
      retryAfterMs: 30_000,
    });

    scheduler.acquire.mockRejectedValueOnce('offline');
    await expect(acquireProviderLease('remote-error-3', config)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('fails closed when the remote binding cannot be resolved', async () => {
    configureRemoteScheduler();
    mockGetCloudflareContext.mockRejectedValueOnce(new Error('context failed'));
    await expect(acquireProviderLease('missing-1', config)).rejects.toMatchObject({ kind: 'unavailable' });

    mockGetCloudflareContext.mockRejectedValueOnce('context failed');
    await expect(acquireProviderLease('missing-2', config)).rejects.toMatchObject({ kind: 'unavailable' });

    mockGetCloudflareContext.mockResolvedValueOnce({
      env: { PROVIDER_SCHEDULER: { getByName: jest.fn() } },
    });
    await expect(acquireProviderLease('invalid-binding', config)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('maps blocked decisions and rounds retry delays up to whole seconds', async () => {
    process.env.PROVIDER_MAX_WAIT_MS = '0';
    const { scheduler } = configureRemoteScheduler();
    scheduler.acquire.mockResolvedValueOnce({
      granted: false,
      reason: 'blocked',
      blockedCategory: 'quota',
      queueDepth: 2,
      retryAfterMs: 1001,
    });

    await expect(acquireProviderLease('blocked-provider', config)).rejects.toMatchObject({
      kind: 'blocked',
      retryAfterMs: 2000,
      providerCategory: 'quota',
    });
  });

  it('uses default run options and tolerates release failures', async () => {
    for (const reason of [new Error('release failed'), 'release failed']) {
      const { scheduler } = configureRemoteScheduler();
      scheduler.release.mockRejectedValueOnce(reason);
      const result = await runWithProviderLease(
        `release-failure-${String(reason)}-${Math.random()}`,
        config,
        async () => 'completed'
      );
      expect(result).toBe('completed');
    }
  });

  it('aborts an operation when automatic lease renewal reports expiry', async () => {
    jest.useFakeTimers();
    const { scheduler } = configureRemoteScheduler();
    scheduler.renew.mockResolvedValueOnce(false);
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    const running = runWithProviderLease(
      'expiring-provider',
      { ...config, leaseTtlMs: 1 },
      async (_lease, signal) => new Promise<never>((_resolve, reject) => {
        markStarted();
        signal.addEventListener('abort', () => reject(new Error('lease expired')), { once: true });
      })
    );
    const assertion = expect(running).rejects.toMatchObject({ kind: 'unavailable' });

    await started;
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(scheduler.release).toHaveBeenCalledWith('remote-lease');
  });
});
