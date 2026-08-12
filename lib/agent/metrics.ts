/**
 * Agent 调用指标。
 *
 * 此前模型调用完全没有指标：usage 被丢弃，耗时/重试/降级都不记录，
 * 于是 token 成本、模型 P95、fallback 率一个都算不出来，也就无法度量
 * prompt 与并行改造的收益。这里把每次模型调用汇总到 turn 级别。
 */

export interface ModelCallMetrics {
  agentName: string;
  model: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  /** 含截断重试与 schema 修复重试的总请求次数 */
  attempts: number;
  /** 是否降级到 legacy function_call 协议 */
  mode: 'tools' | 'functions';
  truncated: boolean;
  ok: boolean;
}

export interface TurnMetrics {
  modelCalls: number;
  modelMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  failedModelCalls: number;
  legacyModeCalls: number;
  truncatedCalls: number;
  byAgent: Record<string, { calls: number; ms: number; tokens: number }>;
}

/** 指标容器；AgentContext 结构性满足。 */
export interface MetricsSink {
  modelCallMetrics?: ModelCallMetrics[];
}

export function recordModelCall(sink: MetricsSink | undefined, metrics: ModelCallMetrics): void {
  if (!sink) {
    return;
  }

  if (!sink.modelCallMetrics) {
    sink.modelCallMetrics = [];
  }

  sink.modelCallMetrics.push(metrics);
}

export function summarizeTurnMetrics(sink: MetricsSink | undefined): TurnMetrics {
  const calls = sink?.modelCallMetrics ?? [];
  const byAgent: TurnMetrics['byAgent'] = {};

  for (const call of calls) {
    const bucket = byAgent[call.agentName] ?? { calls: 0, ms: 0, tokens: 0 };
    bucket.calls += 1;
    bucket.ms += call.durationMs;
    bucket.tokens += (call.promptTokens ?? 0) + (call.completionTokens ?? 0);
    byAgent[call.agentName] = bucket;
  }

  const promptTokens = sum(calls.map((call) => call.promptTokens ?? 0));
  const completionTokens = sum(calls.map((call) => call.completionTokens ?? 0));

  return {
    modelCalls: calls.length,
    modelMs: sum(calls.map((call) => call.durationMs)),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    retries: sum(calls.map((call) => Math.max(0, call.attempts - 1))),
    failedModelCalls: calls.filter((call) => !call.ok).length,
    legacyModeCalls: calls.filter((call) => call.mode === 'functions').length,
    truncatedCalls: calls.filter((call) => call.truncated).length,
    byAgent,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
