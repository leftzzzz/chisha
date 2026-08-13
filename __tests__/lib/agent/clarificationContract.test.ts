/**
 * 追问契约的回归。
 *
 * 这一组用例锁的是线上死循环的三个成因：
 * 1. 选项语义绑定在中文文案上（前端「你推荐」/后端「随便推荐」对不上）；
 * 2. 模型不可用时用词表抽词冒充理解，抽不出就原样重发同一个问题；
 * 3. 没有任何"同一个问题不能连问两次"的不变量。
 */

import { PendingQuestionSchema, normalizeStoredPendingQuestion } from '@/lib/agent/schemas/clarification';
import { buildQuestionFingerprint, CLARIFICATION_OPTION, clarificationOption } from '@/lib/agent/clarificationOptions';
import { applyClarificationOptionToGoal, hasClarificationOption } from '@/lib/agent/goal';
import type { UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃牛排',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['牛排'],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [],
    allowBroaden: false,
    ...overrides,
  };
}

describe('追问选项协议', () => {
  it('assigns backend-owned ids to model-authored options', () => {
    // 模型只输出文案与 effect；id 由后端分配，避免模型编的 id 跨轮次漂移。
    const question = PendingQuestionSchema.parse({
      question: '你说的「港奶」是菜品还是菜系？',
      options: ['菜品', '菜系'],
      optionEffects: {
        菜品: { replacePrimaryKeywords: ['港奶'] },
        菜系: { replaceCategories: ['港奶'] },
      },
    });

    expect(question.options).toEqual([
      { id: 'opt_1', label: '菜品' },
      { id: 'opt_2', label: '菜系' },
    ]);
    expect(question.optionEffects?.opt_1?.replacePrimaryKeywords).toEqual(['港奶']);
    // 文案不再是 key：这正是前后端措辞不一致时断掉的地方。
    expect(question.optionEffects?.['菜品']).toBeUndefined();
  });

  it('upgrades a legacy session question stored with string options', () => {
    const upgraded = normalizeStoredPendingQuestion({
      question: '要允许放宽吗？',
      options: ['搜更广的品类', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        搜更广的品类: { allowBroaden: true },
      },
    }) as { options?: Array<{ id: string; label: string }>; optionEffects?: Record<string, unknown> };

    expect(upgraded.options?.[0]).toEqual({ id: 'opt_1', label: '搜更广的品类' });
    expect(upgraded.optionEffects?.opt_1).toEqual({ allowBroaden: true });
  });

  it('drops effects that no longer map to an option', () => {
    const question = PendingQuestionSchema.parse({
      question: '要允许放宽吗？',
      options: ['放宽', '换个类型'],
      optionEffects: {
        早就删掉的选项: { allowBroaden: true },
      },
    });

    expect(question.optionEffects).toBeUndefined();
  });

  it('applies an option effect by id without touching rawQuery', () => {
    const question = PendingQuestionSchema.parse({
      question: '要允许放宽吗？',
      options: [
        clarificationOption(CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY),
        clarificationOption(CLARIFICATION_OPTION.CHANGE_TARGET),
      ],
      optionEffects: {
        [CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY]: { allowBroaden: true },
      },
    });

    const patched = applyClarificationOptionToGoal(
      goal(),
      question,
      CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY
    );

    expect(patched?.allowBroaden).toBe(true);
    // 选项文案不是搜索词，不能污染 rawQuery 或关键词。
    expect(patched?.rawQuery).toBe('想吃牛排');
    expect(patched?.primaryKeywords).toEqual(['牛排']);
  });

  it('rejects an option id that is not on the current question', () => {
    const question = PendingQuestionSchema.parse({
      question: '要允许放宽吗？',
      options: [
        clarificationOption(CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY),
        clarificationOption(CLARIFICATION_OPTION.CHANGE_TARGET),
      ],
    });

    expect(hasClarificationOption(question, 'expand_distance')).toBe(false);
    expect(applyClarificationOptionToGoal(goal(), question, 'expand_distance')).toBeNull();
  });
});

describe('追问指纹', () => {
  it('treats a label-only change as the same question', () => {
    const left = buildQuestionFingerprint({
      question: '要允许放宽吗？',
      options: [{ id: 'authorize_category_broaden', label: '搜更广的品类' }],
    });
    const right = buildQuestionFingerprint({
      question: '要允许放宽吗？',
      options: [{ id: 'authorize_category_broaden', label: '放宽一点' }],
    });

    expect(left).toBe(right);
  });

  it('separates questions that offer different transitions', () => {
    const left = buildQuestionFingerprint({
      question: '要允许放宽吗？',
      options: [{ id: 'authorize_category_broaden', label: '搜更广的品类' }],
    });
    const right = buildQuestionFingerprint({
      question: '要允许放宽吗？',
      options: [{ id: 'authorize_fallback_primary', label: '搜更广的品类' }],
    });

    expect(left).not.toBe(right);
  });
});
