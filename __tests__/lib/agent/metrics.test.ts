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
    expect(metrics.modelWallMs).toBe(300);
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
    expect(metrics.modelWallMs).toBe(170);
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
    expect(metrics.modelWallMs).toBe(155);
  });

  it('returns zero steps without any model call', () => {
    expect(summarizeTurnMetrics(undefined)).toEqual(expect.objectContaining({
      serialModelSteps: 0,
      modelWallMs: 0,
      byModel: {},
    }));
  });

  it('groups by the provider response model and reports failures', () => {
    const metrics = summarizeTurnMetrics({
      modelCallMetrics: [
        call({
          model: 'qwen3.7-flash',
          responseModel: 'qwen3.7-flash-2026-07-15',
          promptTokens: 10,
          completionTokens: 5,
        }),
        call({
          model: 'qwen3.7-flash',
          responseModel: 'qwen3.7-flash-2026-07-15',
          ok: false,
          promptTokens: 7,
          completionTokens: 3,
        }),
      ],
    });

    expect(metrics.byModel['qwen3.7-flash-2026-07-15']).toEqual({
      calls: 2,
      ms: 200,
      tokens: 25,
      failures: 1,
    });
  });
});
