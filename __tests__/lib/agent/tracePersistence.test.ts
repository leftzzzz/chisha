import {
  MAX_PERSISTED_TRACE_ITEMS,
  persistableTrace,
  PERSISTED_TRACE_TYPES,
} from '@/lib/agent/tracePersistence';
import type { AgentTraceItem } from '@/lib/agent/types';

function traceItem(type: AgentTraceItem['type'], index = 0): AgentTraceItem {
  return {
    id: `trace_${type}_${index}`,
    sessionId: 'session-1',
    turnId: 'turn-1',
    type,
    createdAt: index,
  };
}

describe('trace 持久化裁剪', () => {
  it('keeps decision nodes and drops high-frequency ones', () => {
    const trace = [
      traceItem('user_message'),
      traceItem('model_action'),
      traceItem('tool_start'),
      traceItem('tool_result'),
      traceItem('observation'),
      traceItem('state_update'),
      traceItem('evaluation'),
      traceItem('guard_decision'),
      traceItem('final'),
    ];

    const persisted = persistableTrace(trace).map((item) => item.type);

    expect(persisted).toEqual([
      'user_message',
      'model_action',
      'guard_decision',
      'final',
    ]);
    expect(PERSISTED_TRACE_TYPES.has('tool_result')).toBe(false);
  });

  it('always keeps error nodes so failed turns stay diagnosable', () => {
    expect(persistableTrace([traceItem('error')])).toHaveLength(1);
  });

  it('caps the persisted trace so long sessions do not grow without bound', () => {
    const trace = Array.from({ length: MAX_PERSISTED_TRACE_ITEMS + 20 }, (_, index) =>
      traceItem('runtime_decision', index)
    );

    const persisted = persistableTrace(trace);

    expect(persisted).toHaveLength(MAX_PERSISTED_TRACE_ITEMS);
    // 保留最近的节点，最早的被丢弃。
    expect(persisted[persisted.length - 1].createdAt).toBe(MAX_PERSISTED_TRACE_ITEMS + 19);
  });

  it('handles empty input', () => {
    expect(persistableTrace(undefined)).toEqual([]);
    expect(persistableTrace([])).toEqual([]);
  });
});
