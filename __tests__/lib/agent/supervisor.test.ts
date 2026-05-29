import {
  applyGoalPatch,
  applySupervisorClarifyingAnswer,
} from '@/lib/agent/supervisor';
import { SearchSupervisorOutputSchema } from '@/lib/agent/schemas/clarification';
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

describe('SearchSupervisorAgent', () => {
  it('requires the model instead of falling back to local parsing', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();

    try {
      const { runSearchSupervisor } = await import('@/lib/agent/supervisor');
      await expect(runSearchSupervisor({ message: '想吃牛排' })).rejects.toThrow('OPENAI_API_KEY');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it('retries once with a larger token budget when function arguments are truncated', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const fetchWithTimeout = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            finish_reason: 'length',
            message: {
              function_call: {
                name: 'superviseRestaurantSearch',
                arguments: '{"goal":{"intent":"find_restaurants","rawQuery":"想吃日料"',
              },
            },
          }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              function_call: {
                name: 'superviseRestaurantSearch',
                arguments: JSON.stringify({
                  goal: {
                    intent: 'find_restaurants',
                    rawQuery: '想吃日料',
                    primaryKeywords: ['日料'],
                  },
                  nextAction: 'plan',
                }),
              },
            },
          }],
        }),
      });
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runSearchSupervisor } = await import('@/lib/agent/supervisor');
      const output = await runSearchSupervisor({ message: '想吃日料' });
      const initialRequest = JSON.parse(fetchWithTimeout.mock.calls[0][1].body as string);
      const retryRequest = JSON.parse(fetchWithTimeout.mock.calls[1][1].body as string);

      expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
      expect(initialRequest.max_tokens).toBe(4096);
      expect(retryRequest.max_tokens).toBe(8192);
      expect(output.goal?.primaryKeywords).toEqual(['日料']);
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      warnSpy.mockRestore();
      jest.dontMock('@/lib/withTimeout');
    }
  });

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
      version: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      goal: goal(),
      pendingQuestion: {
        question: '要允许放宽吗？',
        options: ['允许放宽'],
        optionEffects: {
          '允许放宽': { allowBroaden: true, setDistanceMaxMeters: 5000 },
        },
      },
    };

    applySupervisorClarifyingAnswer(session, '允许放宽');

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
      version: 3,
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
      goal: goal({
        rawQuery: '港奶',
        primaryKeywords: ['港奶'],
      }),
      pendingQuestion: {
        question: '你说的「港奶」是菜品、菜系还是店名？',
        options: ['菜品', '菜系', '店名'],
        allowFreeText: true,
        optionEffects: {
          '菜品': {
            replaceRequestedItems: ['港奶'],
            replacePrimaryKeywords: ['港奶'],
          },
          '菜系': {
            replaceCategories: ['港奶'],
            replacePrimaryKeywords: ['港奶'],
          },
          '店名': {
            replacePrimaryKeywords: ['港奶'],
          },
        },
      },
    };

    applySupervisorClarifyingAnswer(session, '菜品');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.rawQuery).toBe('港奶，菜品');
    expect(session.goal?.primaryKeywords).toEqual(['港奶']);
    expect(session.goal?.requestedItems).toEqual([{ name: '港奶', required: true, aliases: [] }]);
    expect(session.goal?.primaryKeywords).not.toContain('菜品');
  });

  it('does not parse free-text clarification answers without structured option effects', () => {
    const session: AgentSession = {
      id: 's3',
      version: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 1000,
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      goal: goal({ primaryKeywords: [] }),
      pendingQuestion: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      },
    };

    applySupervisorClarifyingAnswer(session, '都行');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.primaryKeywords).toEqual([]);
    expect(session.goal?.requestedItems).toEqual([]);
  });

  it('normalizes category objects in clarification option effects', () => {
    const parsed = SearchSupervisorOutputSchema.parse({
      goal: {
        ...goal({
          rawQuery: '随便推荐',
          primaryKeywords: [],
          clarificationNeeded: [],
        }),
        clarificationNeeded: [{
          reason: '用户需求缺少明确餐饮目标。',
          question: '你想找哪类餐厅？',
          allowFreeText: true,
          options: [{
            label: '川菜',
            value: 'sichuan',
            effect: {
              addCategories: [{ name: '川菜', confidence: 0.8 }],
            },
          }],
        }],
      },
      nextAction: 'ask_user',
    });

    expect(
      parsed.goal?.clarificationNeeded[0].options?.[0].effect?.addCategories
    ).toEqual(['川菜']);
  });

  it('drops malformed clarification entries instead of rejecting supervisor output', () => {
    const parsed = SearchSupervisorOutputSchema.parse({
      goal: {
        ...goal({
          rawQuery: '想吃清淡点',
          primaryKeywords: [],
          clarificationNeeded: [],
        }),
        clarificationNeeded: [
          {
            reason: '用户需求缺少明确餐饮目标。',
            question: '你想找哪类餐厅，或具体想吃什么？',
            allowFreeText: true,
          },
          { label: '正餐', value: 'meal' },
          { label: '小吃', value: 'snack' },
          { reason: '缺少可展示问题。' },
        ],
      },
      nextAction: 'ask_user',
    });

    expect(parsed.goal?.clarificationNeeded).toEqual([{
      reason: '用户需求缺少明确餐饮目标。',
      question: '你想找哪类餐厅，或具体想吃什么？',
      allowFreeText: true,
    }]);
  });

  it('normalizes malformed clarification options without dropping the question', () => {
    const parsed = SearchSupervisorOutputSchema.parse({
      goal: {
        ...goal({
          rawQuery: '附近有什么吃的',
          primaryKeywords: [],
          clarificationNeeded: [],
        }),
        clarificationNeeded: [{
          question: '你想找哪类餐厅？',
          options: [
            '正餐',
            { label: '小吃' },
            { label: '咖啡', value: 'coffee' },
            { value: 'missing-label' },
          ],
        }],
      },
      nextAction: 'ask_user',
    });

    expect(parsed.goal?.clarificationNeeded[0]).toEqual({
      reason: '需要补充信息。',
      question: '你想找哪类餐厅？',
      allowFreeText: true,
      options: [
        { label: '正餐', value: '正餐' },
        { label: '小吃', value: '小吃' },
        { label: '咖啡', value: 'coffee' },
      ],
    });
  });

  it('defaults omitted goal arrays from model output', () => {
    const parsed = SearchSupervisorOutputSchema.parse({
      goal: {
        intent: 'find_restaurants',
        rawQuery: '想吃日料',
      },
      nextAction: 'plan',
    });

    expect(parsed.goal?.alternativeGroups).toEqual([]);
    expect(parsed.goal?.primaryKeywords).toEqual([]);
    expect(parsed.goal?.clarificationNeeded).toEqual([]);
    expect(parsed.goal?.allowBroaden).toBe(false);
  });

  it('defaults omitted patch reason from model output', () => {
    const parsed = SearchSupervisorOutputSchema.parse({
      patch: {
        allowBroaden: true,
      },
      nextAction: 'plan',
    });

    expect(parsed.patch?.reason).toBe('SearchSupervisorAgent 更新目标。');
  });
});
