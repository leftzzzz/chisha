/**
 * Agent 调用指标。
 *
 * 此前模型调用完全没有指标：usage 被丢弃，耗时/重试/降级都不记录，
 * 于是 token 成本、模型 P95、fallback 率一个都算不出来，也就无法度量
 * prompt 与并行改造的收益。这里把每次模型调用汇总到 turn 级别。
 */

export interface ModelCallMetrics {
  modelRole: string;
  model: string;
  /** 调用发起时刻；用于把并发调用合并成"串行步数" */
  startedAt: number;
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
  /**
   * 串行模型步数：把重叠的调用区间合并后剩下的段数。
   *
   * 并发发起的多次调用只算一步——用户感知的是墙钟时间，不是调用次数。
   * 这是衡量 loop 形态的核心指标：调用总数可以增加，串行步数必须下降。
   */
  serialModelSteps: number;
  modelMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  failedModelCalls: number;
  legacyModeCalls: number;
  truncatedCalls: number;
  byModelRole: Record<string, { calls: number; ms: number; tokens: number }>;
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
  const byModelRole: TurnMetrics['byModelRole'] = {};

  for (const call of calls) {
    const bucket = byModelRole[call.modelRole] ?? { calls: 0, ms: 0, tokens: 0 };
    bucket.calls += 1;
    bucket.ms += call.durationMs;
    bucket.tokens += (call.promptTokens ?? 0) + (call.completionTokens ?? 0);
    byModelRole[call.modelRole] = bucket;
  }

  const promptTokens = sum(calls.map((call) => call.promptTokens ?? 0));
  const completionTokens = sum(calls.map((call) => call.completionTokens ?? 0));

  return {
    modelCalls: calls.length,
    serialModelSteps: countSerialSteps(calls),
    modelMs: sum(calls.map((call) => call.durationMs)),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    retries: sum(calls.map((call) => Math.max(0, call.attempts - 1))),
    failedModelCalls: calls.filter((call) => !call.ok).length,
    legacyModeCalls: calls.filter((call) => call.mode === 'functions').length,
    truncatedCalls: calls.filter((call) => call.truncated).length,
    byModelRole,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * 把调用区间按重叠合并，返回剩余段数。
 *
 * 同一批并发发起的调用区间互相重叠，合并成一段；串行链上的调用不重叠，
 * 各算一段。缺少 startedAt 的历史记录按各自独立一段处理。
 */
function countSerialSteps(calls: ModelCallMetrics[]): number {
  const intervals = calls
    .map((call) => ({
      start: call.startedAt ?? 0,
      end: (call.startedAt ?? 0) + Math.max(0, call.durationMs),
    }))
    .sort((left, right) => left.start - right.start);

  let steps = 0;
  let currentEnd = -Infinity;

  for (const interval of intervals) {
    if (interval.start >= currentEnd) {
      steps += 1;
      currentEnd = interval.end;
    } else {
      currentEnd = Math.max(currentEnd, interval.end);
    }
  }

  return steps;
}
