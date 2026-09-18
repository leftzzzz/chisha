import {
  prepareEvalProcess,
  resolveEvalExecution,
  resolveEvalMode,
  validateEvalConfiguration,
} from '@/evals/config';
import {
  configureHarness,
  routeEvaluation,
  routeGoalUnderstanding,
  routeKeywordExpansion,
} from '@/evals/harness';
import { runSuite } from '@/evals/runner';

const ENV_KEYS = [
  'AGENT_DETERMINISTIC',
  'AMAP_API_KEY',
  'EVAL_ALLOW_LIVE_PROVIDER',
  'EVAL_UPDATE_BASELINE',
  'OPENAI_API_KEY',
] as const;

describe('eval execution mode', () => {
  const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    configureHarness('offline');
  });

  it('maps the three exact modes to different model and map providers', () => {
    expect(resolveEvalExecution('offline')).toMatchObject({
      model: 'stub',
      map: 'fixture',
      baseline: 'enabled',
    });
    expect(resolveEvalExecution('live-model-fixture-map')).toMatchObject({
      model: 'live',
      map: 'fixture',
      baseline: 'disabled',
    });
    expect(resolveEvalExecution('live-model-live-map')).toMatchObject({
      model: 'live',
      map: 'live',
      baseline: 'disabled',
    });
  });

  it('rejects ambiguous and unknown mode labels', () => {
    expect(() => resolveEvalMode({ EVAL_MODE: 'live' })).toThrow(
      'unsupported eval mode: live'
    );
    expect(() => resolveEvalMode({ EVAL_MODE: 'fixture' })).toThrow(
      'unsupported eval mode: fixture'
    );
  });

  it('allows offline mode without external credentials', () => {
    expect(validateEvalConfiguration('offline', {})).toEqual(
      resolveEvalExecution('offline')
    );
  });

  it('rejects live model mode before runtime import when the model key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.AGENT_DETERMINISTIC = '1';

    await expect(runSuite('live-model-fixture-map')).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
    expect(process.env.AGENT_DETERMINISTIC).toBe('1');
  });

  it('requires model, map, and explicit provider approval for live map mode', () => {
    expect(() => validateEvalConfiguration('live-model-live-map', {
      OPENAI_API_KEY: 'model-key',
    })).toThrow('AMAP_API_KEY, EVAL_ALLOW_LIVE_PROVIDER=1');

    expect(validateEvalConfiguration('live-model-live-map', {
      OPENAI_API_KEY: 'model-key',
      AMAP_API_KEY: 'map-key',
      EVAL_ALLOW_LIVE_PROVIDER: '1',
    })).toEqual(resolveEvalExecution('live-model-live-map'));
  });

  it('rejects baseline updates for either live mode', () => {
    expect(() => validateEvalConfiguration('live-model-fixture-map', {
      OPENAI_API_KEY: 'model-key',
      EVAL_UPDATE_BASELINE: '1',
    })).toThrow('EVAL_UPDATE_BASELINE must be unset outside offline mode');
  });

  it('removes the deterministic switch for live models', () => {
    const env: NodeJS.ProcessEnv = { AGENT_DETERMINISTIC: '1' };

    prepareEvalProcess(resolveEvalExecution('live-model-fixture-map'), env);

    expect(env.AGENT_DETERMINISTIC).toBeUndefined();
  });

  it('routes every mocked model role to the real implementation in live modes', async () => {
    configureHarness('live-model-fixture-map');
    const goalActual = { runGoalUnderstandingModel: jest.fn(async () => ({ source: 'live-goal' })) };
    const keywordActual = { runKeywordExpansionModel: jest.fn(async () => ({ source: 'live-keyword' })) };
    const evaluationActual = { runEvaluationModel: jest.fn(async () => ({ source: 'live-evaluation' })) };
    const evaluationInput = {
      goal: {
        requestedItems: [],
        acceptableCategories: [],
        primaryKeywords: [],
      },
      plan: {
        keywords: [],
        searchIntent: 'exact',
        allowedForPrimary: true,
      },
      restaurants: [],
      targetCount: 3,
    };

    await expect(routeGoalUnderstanding(goalActual, { message: '火锅' }))
      .resolves.toEqual({ source: 'live-goal' });
    await expect(routeKeywordExpansion(keywordActual, {}))
      .resolves.toEqual({ source: 'live-keyword' });
    await expect(routeEvaluation(evaluationActual, evaluationInput))
      .resolves.toEqual({ source: 'live-evaluation' });

    expect(goalActual.runGoalUnderstandingModel).toHaveBeenCalledTimes(1);
    expect(keywordActual.runKeywordExpansionModel).toHaveBeenCalledTimes(1);
    expect(evaluationActual.runEvaluationModel).toHaveBeenCalledTimes(1);
  });
});
