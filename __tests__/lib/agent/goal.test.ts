/**
 * 目标代数：合并、打补丁、追问选项应用。
 *
 * 这些全是纯函数，此前和 GoalUnderstandingModel 混在一个测试文件里。
 */

import {
  applyGoalPatch,
  applyClarificationOptionToGoal,
  applyClarificationOptionToSession,
} from '@/lib/agent/goal';
import type { AgentSession, UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '随便吃点',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['随便吃点'],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: false,
    ...overrides,
  };
}

describe('goal algebra', () => {
  it('applies goal patches without overwriting existing hard constraints', () => {
    const patched = applyGoalPatch(
      goal({
        hardConstraints: [{ kind: 'distance', label: '500米内', value: 500, maxMeters: 500, strict: true }],
      }),
      {
        addRequestedItems: [{ name: '日料', required: true, aliases: [] }],
        reason: '用户补充了想吃日料。',
      },
      '随便吃点，日料'
    );

    expect(patched.requestedItems.map((item) => item.name)).toContain('日料');
    expect(patched.hardConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'distance', maxMeters: 500 })])
    );
  });

  it('replaces stale primary targets when a clarification answer names a new target', () => {
    const patched = applyGoalPatch(
      goal({
        requestedItems: [{ name: '日料', required: true, aliases: [] }],
        primaryKeywords: ['日料'],
        relatedKeywords: ['寿司'],
      }),
      {
        replacePrimaryKeywords: ['火锅'],
        replaceRequestedItems: [{ name: '火锅', required: true, aliases: [] }],
        reason: '用户补充了新的主目标。',
      },
      '火锅'
    );

    expect(patched.primaryKeywords).toEqual(['火锅']);
    expect(patched.requestedItems.map((item) => item.name)).toEqual(['火锅']);
    expect(patched.relatedKeywords).toEqual([]);
    expect(patched.clarificationNeeded).toEqual([]);
  });

  it('preserves existing targets when a clarification effect explicitly adds another target', () => {
    const patched = applyClarificationOptionToGoal(
      goal({
        rawQuery: '想吃火锅',
        requestedItems: [{ name: '火锅', required: true, aliases: [] }],
        primaryKeywords: ['火锅'],
      }),
      {
        question: '还想补充什么？',
        options: [{ id: 'add_sushi', label: '再加寿司' }],
        optionEffects: {
          add_sushi: {
            addRequestedItems: ['寿司'],
          },
        },
      },
      'add_sushi'
    );

    expect(patched?.requestedItems.map((item) => item.name)).toEqual(['火锅', '寿司']);
    expect(patched?.primaryKeywords).toEqual(['火锅', '寿司']);
  });

  it('replaces existing targets only when a clarification effect explicitly requests replacement', () => {
    const patched = applyClarificationOptionToGoal(
      goal({
        rawQuery: '想吃火锅',
        requestedItems: [{ name: '火锅', required: true, aliases: [] }],
        primaryKeywords: ['火锅'],
      }),
      {
        question: '想换成什么？',
        options: [{ id: 'replace_with_sushi', label: '换成寿司' }],
        optionEffects: {
          replace_with_sushi: {
            replaceRequestedItems: ['寿司'],
            replacePrimaryKeywords: ['寿司'],
          },
        },
      },
      'replace_with_sushi'
    );

    expect(patched?.requestedItems.map((item) => item.name)).toEqual(['寿司']);
    expect(patched?.primaryKeywords).toEqual(['寿司']);
  });

  it('applies soft preference patches without turning them into requested items', () => {
    const patched = applyGoalPatch(
      goal({ primaryKeywords: ['火锅'] }),
      {
        addSoftPreferences: [{ name: '人气高', weight: 1, verifiable: false }],
        reason: '用户补充了不可稳定验证的体验偏好。',
      },
      '想吃火锅，人多的地方'
    );

    expect(patched.requestedItems.map((item) => item.name)).not.toContain('人气高');
    expect(patched.softPreferences).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '人气高', verifiable: false })])
    );
  });

  it('applies pending question option effects inside Supervisor ownership', () => {
    const session: AgentSession = {
      id: 's1',
      version: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
      trace: [],
      goal: goal(),
      pendingQuestion: {
        question: '要允许放宽吗？',
        options: [
          { id: 'authorize_category_broaden', label: '允许放宽' },
          { id: 'change_target', label: '换个类型' },
        ],
        optionEffects: {
          authorize_category_broaden: { allowBroaden: true, setDistanceMaxMeters: 5000 },
        },
      },
    };

    applyClarificationOptionToSession(session, 'authorize_category_broaden');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.allowBroaden).toBe(true);
    expect(session.goal?.requestedItems.map((item) => item.name)).not.toContain('允许放宽');
    expect(session.goal?.hardConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'distance', maxMeters: 5000 })])
    );
  });

  it('uses structured option effects to re-summarize clarification answers with previous context', () => {
    const session: AgentSession = {
      id: 's2',
      version: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      location: { lat: 31.2, lng: 121.4 },
      messages: [
        { role: 'user', content: '港奶', createdAt: Date.now() },
        { role: 'assistant', content: '你说的「港奶」是菜品、菜系还是店名？', createdAt: Date.now() },
      ],
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
      trace: [],
      goal: goal({
        rawQuery: '港奶',
        primaryKeywords: ['港奶'],
      }),
      pendingQuestion: {
        question: '你说的「港奶」是菜品、菜系还是店名？',
        options: [
          { id: 'opt_1', label: '菜品' },
          { id: 'opt_2', label: '菜系' },
          { id: 'opt_3', label: '店名' },
        ],
        allowFreeText: true,
        optionEffects: {
          opt_1: {
            replaceRequestedItems: ['港奶'],
            replacePrimaryKeywords: ['港奶'],
          },
          opt_2: {
            replaceCategories: ['港奶'],
            replacePrimaryKeywords: ['港奶'],
          },
          opt_3: {
            replacePrimaryKeywords: ['港奶'],
          },
        },
      },
    };

    applyClarificationOptionToSession(session, 'opt_1');

    expect(session.pendingQuestion).toBeUndefined();
    // 选项文案不是搜索词，不该被拼进 rawQuery。
    expect(session.goal?.rawQuery).toBe('港奶');
    expect(session.goal?.primaryKeywords).toEqual(['港奶']);
    expect(session.goal?.requestedItems).toEqual([{ name: '港奶', required: true, aliases: [] }]);
    expect(session.goal?.primaryKeywords).not.toContain('菜品');
  });

  it('does not parse free-text clarification answers without structured option effects', () => {
    const session: AgentSession = {
      id: 's3',
      version: 4,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
      trace: [],
      goal: goal({ primaryKeywords: [] }),
      pendingQuestion: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      },
    };

    applyClarificationOptionToSession(session, 'authorize_fallback_primary');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.primaryKeywords).toEqual([]);
    expect(session.goal?.requestedItems).toEqual([]);
  });
});
