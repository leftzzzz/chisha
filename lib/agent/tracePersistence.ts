/**
 * Trace 持久化裁剪。
 *
 * trace 每轮都追加 tool_start / tool_result / observation / state_update /
 * evaluation 等高频节点，而 session 是整段会话累积保存的（D1 单行），
 * 不裁剪会让行体积随轮次线性膨胀、读写放大。
 *
 * 裁剪只发生在写入 session 的边界：本轮返回给调用方的 runtimeState 仍是完整
 * 时间线，保证当前 turn 可完整回放；跨轮持久化只保留决策类节点。
 * 高频节点的完整信息进日志（Cloudflare observability 已开启）。
 */

import type { AgentTraceItem } from './types';

export const PERSISTED_TRACE_TYPES = new Set<AgentTraceItem['type']>([
  'user_message',
  'model_goal',
  'model_action',
  'model_call',
  'guard_decision',
  'runtime_decision',
  'question',
  'final',
  'error',
]);

export const MAX_PERSISTED_TRACE_ITEMS = 80;

export function persistableTrace(trace: AgentTraceItem[] | undefined): AgentTraceItem[] {
  if (!trace || trace.length === 0) {
    return [];
  }

  return trace
    .filter((item) => PERSISTED_TRACE_TYPES.has(item.type))
    .slice(-MAX_PERSISTED_TRACE_ITEMS);
}
