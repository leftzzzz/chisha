import {
  acquireLease,
  createSchedulerState,
  releaseLease,
  renewLease,
  reportFailure,
  reportSuccess,
  type SchedulerConfig,
} from '@/lib/providerSchedulerCore';

const config: SchedulerConfig = {
  maxInFlight: 1,
  ratePerSecond: 2,
  requestsPerMinute: 0,
  tokensPerMinute: 0,
  leaseTtlMs: 1000,
};

describe('provider scheduler core', () => {
  it('keeps logical fanout separate from in-flight capacity and refills QPS', () => {
    const state = createSchedulerState(0);
    const first = acquireLease(state, config, 0);
    expect(first.granted).toBe(true);

    const blockedByInflight = acquireLease(state, config, 0);
    expect(blockedByInflight.reason).toBe('in_flight');

    expect(releaseLease(state, first.leaseId!)).toBe(true);
    const second = acquireLease(state, config, 0);
    expect(second.granted).toBe(true);
    expect(releaseLease(state, second.leaseId!)).toBe(true);

    const third = acquireLease(state, config, 0);
    expect(third.reason).toBe('rate');
    expect(acquireLease(state, config, 500).granted).toBe(true);
  });

  it('renews leases and makes release idempotent', () => {
    const state = createSchedulerState(0);
    const decision = acquireLease(state, config, 0);
    expect(renewLease(state, decision.leaseId!, 500, 1000)).toBe(true);
    expect(renewLease(state, decision.leaseId!, 1400, 1000)).toBe(true);
    expect(releaseLease(state, decision.leaseId!)).toBe(true);
    expect(releaseLease(state, decision.leaseId!)).toBe(false);
  });

  it('short-circuits exhausted providers and reopens after a successful probe', () => {
    const state = createSchedulerState(0);
    reportFailure(state, 0, 'quota_exhausted', 5000);
    expect(acquireLease(state, config, 1000).reason).toBe('blocked');

    const probe = acquireLease(state, config, 5000);
    expect(probe.granted).toBe(true);
    expect(acquireLease(state, config, 5000).reason).toBe('blocked');
    expect(reportSuccess(state, 'stale-lease')).toBe(false);
    expect(acquireLease(state, config, 5000).reason).toBe('blocked');
    expect(reportSuccess(state, probe.leaseId!)).toBe(true);
    expect(releaseLease(state, probe.leaseId!)).toBe(true);
    expect(acquireLease(state, config, 5000).granted).toBe(true);
  });

  it('paces RPM and reserves TPM before granting a request', () => {
    const rpmState = createSchedulerState(0);
    const rpmConfig = { ...config, maxInFlight: 10, ratePerSecond: 0, requestsPerMinute: 60 };
    const firstRpm = acquireLease(rpmState, rpmConfig, 0);
    expect(firstRpm.granted).toBe(true);
    releaseLease(rpmState, firstRpm.leaseId!);
    expect(acquireLease(rpmState, rpmConfig, 0).reason).toBe('rate');
    expect(acquireLease(rpmState, rpmConfig, 1000).granted).toBe(true);

    const tpmState = createSchedulerState(0);
    const tpmConfig = {
      ...config,
      maxInFlight: 10,
      ratePerSecond: 0,
      tokensPerMinute: 100,
    };
    const firstTpm = acquireLease(tpmState, tpmConfig, 0, 60);
    expect(firstTpm.granted).toBe(true);
    releaseLease(tpmState, firstTpm.leaseId!);
    expect(acquireLease(tpmState, tpmConfig, 0, 60).reason).toBe('rate');
    expect(acquireLease(tpmState, tpmConfig, 12_000, 60).granted).toBe(true);
    expect(acquireLease(tpmState, tpmConfig, 12_000, 101).reason).toBe('token_cost');
  });
});
