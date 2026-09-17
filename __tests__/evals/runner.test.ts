import { resolveEvalMode } from '@/evals/config';
import { runSuite } from '@/evals/runner';

describe('eval execution mode', () => {
  it('rejects a live label instead of running fixture map data', async () => {
    await expect(runSuite('live')).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });

  it('rejects an unknown mode before constructing fixture providers', async () => {
    expect(() => resolveEvalMode({ EVAL_MODE: 'fixture' })).toThrow(
      'unsupported eval mode: fixture'
    );
    await expect(runSuite('live')).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });
});
