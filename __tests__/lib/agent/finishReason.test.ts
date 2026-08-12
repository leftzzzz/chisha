import {
  describeFinish,
  FINISH_REASONS,
  internalFinishNote,
  type FinishReason,
} from '@/lib/agent/finishReason';

/**
 * 内部术语词表。
 *
 * 历史缺陷：用户文案由中文字符串 map 映射，planner 侧的文案没被收录，
 * 于是"已找到通过主推荐准入的候选，停止继续搜索。"这类内部说法直接透给了用户。
 */
const INTERNAL_TERMS = [
  '准入',
  '候选',
  'Guard',
  'Runtime',
  'Agent 动作上限',
  '搜索上限',
  '策略',
];

describe('describeFinish', () => {
  it('gives every reason a user-facing text', () => {
    const userFacing = FINISH_REASONS.filter((reason) => reason !== 'MODEL_DECIDED');

    for (const reason of userFacing) {
      const text = describeFinish(reason);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe(internalFinishNote(reason));
    }
  });

  it('never leaks internal vocabulary to users', () => {
    for (const reason of FINISH_REASONS) {
      const text = describeFinish(reason, '已为您找到合适的餐厅。');
      for (const term of INTERNAL_TERMS) {
        expect(text).not.toContain(term);
      }
    }
  });

  it('uses the model explanation only for model-decided finishes', () => {
    expect(describeFinish('MODEL_DECIDED', '为你挑了 3 家评价不错的川菜馆。'))
      .toBe('为你挑了 3 家评价不错的川菜馆。');
    expect(describeFinish('SEARCH_BUDGET_EXHAUSTED', '为你挑了 3 家评价不错的川菜馆。'))
      .not.toBe('为你挑了 3 家评价不错的川菜馆。');
  });

  it('falls back to a default text when the model explanation is empty', () => {
    expect(describeFinish('MODEL_DECIDED', '   ')).toBe(describeFinish('ENOUGH_PRIMARY'));
    expect(describeFinish(undefined)).toBe(describeFinish('ENOUGH_PRIMARY'));
  });

  it('keeps internal notes out of the user-facing path', () => {
    const note = internalFinishNote('GUARD_REJECTED' satisfies FinishReason);
    expect(note).toMatch(/^[\x20-\x7E]+$/); // 纯 ASCII：只进 trace/日志
  });
});
