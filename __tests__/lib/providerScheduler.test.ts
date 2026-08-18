/**
 * @jest-environment node
 */

import {
  acquireProviderLease,
  ProviderSchedulerError,
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
  const originalMaxWaitMs = process.env.PROVIDER_MAX_WAIT_MS;

  afterEach(() => {
    if (originalMaxWaitMs === undefined) {
      delete process.env.PROVIDER_MAX_WAIT_MS;
    } else {
      process.env.PROVIDER_MAX_WAIT_MS = originalMaxWaitMs;
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
});
