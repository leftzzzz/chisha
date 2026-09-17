import { runSuite } from '@/evals/runner';

describe('eval execution mode', () => {
  it('rejects a live label instead of running fixture map data', async () => {
    await expect(runSuite('live')).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });
});
