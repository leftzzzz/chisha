/**
 * @jest-environment node
 */

jest.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected readonly ctx: unknown;

    constructor(ctx: unknown) {
      this.ctx = ctx;
    }
  },
}), { virtual: true });

import { ProviderSchedulerDurableObject } from '@/lib/providerSchedulerDurableObject';
import type { SchedulerConfig } from '@/lib/providerSchedulerCore';

const config: SchedulerConfig = {
  maxInFlight: 1,
  ratePerSecond: 0,
  requestsPerMinute: 0,
  tokensPerMinute: 0,
  leaseTtlMs: 1000,
};

function createContext(initialState?: string) {
  let persistedState = initialState;
  const setAlarm = jest.fn(async () => undefined);
  const deleteAlarm = jest.fn(async () => undefined);
  const sqlExec = jest.fn((query: string, ...bindings: unknown[]) => {
    if (query.startsWith('SELECT')) {
      return {
        toArray: () => persistedState === undefined ? [] : [{ state: persistedState }],
      };
    }
    if (query.startsWith('INSERT')) {
      persistedState = String(bindings[0]);
    }
    return { toArray: () => [] };
  });
  const ctx = {
    storage: {
      sql: { exec: sqlExec },
      setAlarm,
      deleteAlarm,
    },
    blockConcurrencyWhile: async <T>(callback: () => T | Promise<T>): Promise<T> => callback(),
  } as unknown as ChishaDurableObjectState;

  return {
    ctx,
    sqlExec,
    setAlarm,
    deleteAlarm,
    readPersistedState: () => persistedState,
  };
}

describe('ProviderSchedulerDurableObject', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists leases across object instances and clears the alarm after release', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
    const fake = createContext();
    const firstInstance = new ProviderSchedulerDurableObject(fake.ctx, {});

    const first = await firstInstance.acquire({ config });

    expect(first).toMatchObject({ granted: true, leaseId: 'lease_1' });
    expect(fake.sqlExec).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'));
    expect(fake.setAlarm).toHaveBeenLastCalledWith(11_000);

    const restartedInstance = new ProviderSchedulerDurableObject(fake.ctx, {});
    await expect(restartedInstance.acquire({ config })).resolves.toMatchObject({
      granted: false,
      reason: 'in_flight',
    });

    await expect(restartedInstance.release(first.leaseId!)).resolves.toBe(true);
    expect(fake.deleteAlarm).toHaveBeenCalled();
    expect(JSON.parse(fake.readPersistedState() ?? '{}').leases).toEqual({});
  });

  it('prunes expired leases when the alarm fires', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(20_000);
    const fake = createContext();
    const scheduler = new ProviderSchedulerDurableObject(fake.ctx, {});
    await scheduler.acquire({ config });

    now.mockReturnValue(21_001);
    await scheduler.alarm();

    expect(JSON.parse(fake.readPersistedState() ?? '{}').leases).toEqual({});
    expect(fake.deleteAlarm).toHaveBeenCalled();
  });

  it('fails closed instead of erasing corrupted persisted state', async () => {
    const fake = createContext('{not-json');
    const scheduler = new ProviderSchedulerDurableObject(fake.ctx, {});

    await expect(scheduler.acquire({ config })).rejects.toThrow(
      'Provider scheduler state is corrupted'
    );
    expect(fake.readPersistedState()).toBe('{not-json');
  });
});
