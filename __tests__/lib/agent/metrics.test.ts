import { summarizeTurnMetrics } from '@/lib/agent/metrics';
import type { ModelCallMetrics } from '@/lib/agent/metrics';

function call(overrides: Partial<ModelCallMetrics>): ModelCallMetrics {
  return {
    modelRole: 'TestAgent',
    model: 'test-model',
    startedAt: 0,
    durationMs: 100,
    attempts: 1,
    mode: 'tools',
    truncated: false,
    ok: true,
    ...overrides,
  };
}

describe('summarizeTurnMetrics 串行步数', () => {
  it('counts sequential calls as separate steps', () => {
    const metrics = summarizeTurnMetrics({
      modelCallMetrics: [
        call({ startedAt: 0, durationMs: 100 }),
        call({ startedAt: 100, durationMs: 100 }),
        call({ startedAt: 200, durationMs: 100 }),
      ],
    });

    expect(metrics.modelCalls).toBe(3);
    expect(metrics.serialModelSteps).toBe(3);
  });

  it('merges overlapping calls into one step', () => {
    const metrics = summarizeTurnMetrics({
      modelCallMetrics: [
        call({ startedAt: 0, durationMs: 100 }),
        call({ startedAt: 10, durationMs: 90 }),
        call({ startedAt: 50, durationMs: 120 }),
      ],
    });

    expect(metrics.modelCalls).toBe(3);
    expect(metrics.serialModelSteps).toBe(1);
  });

  it('separates a concurrent batch from a later serial call', () => {
    const metrics = summarizeTurnMetrics({
      modelCallMetrics: [
        call({ startedAt: 0, durationMs: 100 }),
        call({ startedAt: 5, durationMs: 100 }),
        call({ startedAt: 300, durationMs: 50 }),
      ],
    });

    expect(metrics.serialModelSteps).toBe(2);
  });

  it('returns zero steps without any model call', () => {
    expect(summarizeTurnMetrics(undefined).serialModelSteps).toBe(0);
  });
});
