import { GoalUnderstandingOutputSchema } from '@/lib/agent/schemas/clarification';
import type { UserGoal } from '@/lib/agent/types';

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

describe('GoalUnderstandingAgent', () => {
  it('requires the model instead of falling back to local parsing', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();

    try {
      const { runGoalUnderstandingAgent } = await import('@/lib/agent/subagents/goalUnderstandingAgent');
      await expect(runGoalUnderstandingAgent({ message: '想吃牛排' })).rejects.toThrow('OPENAI_API_KEY');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it('does not interpret open pending answers without the model', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();

    try {
      const { runGoalUnderstandingAgent } = await import('@/lib/agent/subagents/goalUnderstandingAgent');
      await expect(runGoalUnderstandingAgent({
        message: '你看着办',
        previousGoal: goal({
          requestedItems: [],
          acceptableCategories: [],
          primaryKeywords: [],
        }),
        pendingQuestion: {
          question: '你想找哪类餐厅，或具体想吃什么？',
          allowFreeText: true,
        },
      })).rejects.toThrow('OPENAI_API_KEY');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it('does not interpret broaden pending answers without the model', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    jest.resetModules();

    try {
      const { runGoalUnderstandingAgent } = await import('@/lib/agent/subagents/goalUnderstandingAgent');
      await expect(runGoalUnderstandingAgent({
        message: '扩大范围',
        previousGoal: goal({
          hardConstraints: [{
            kind: 'distance',
            label: '300米内',
            value: 300,
            maxMeters: 300,
            strict: true,
          }],
        }),
        pendingQuestion: {
          question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
          allowFreeText: true,
        },
      })).rejects.toThrow('OPENAI_API_KEY');
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
                name: 'understandRestaurantGoal',
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
                name: 'understandRestaurantGoal',
                arguments: JSON.stringify({
                  goal: {
                    intent: 'find_restaurants',
                    rawQuery: '想吃日料',
                    primaryKeywords: ['日料'],
                  },
                }),
              },
            },
          }],
        }),
      });
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runGoalUnderstandingAgent } = await import('@/lib/agent/subagents/goalUnderstandingAgent');
      const output = await runGoalUnderstandingAgent({ message: '想吃日料' });
      const initialRequest = JSON.parse(fetchWithTimeout.mock.calls[0][1].body as string);
      const retryRequest = JSON.parse(fetchWithTimeout.mock.calls[1][1].body as string);

      expect(fetchWithTimeout).toHaveBeenCalledTimes(2);
      expect(initialRequest.max_completion_tokens).toBe(4096);
      expect(retryRequest.max_completion_tokens).toBe(8192);
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
});

describe('GoalUnderstandingAgent output schema', () => {
  it('normalizes category objects in clarification option effects', () => {
    const parsed = GoalUnderstandingOutputSchema.parse({
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
    const parsed = GoalUnderstandingOutputSchema.parse({
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
    const parsed = GoalUnderstandingOutputSchema.parse({
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
    const parsed = GoalUnderstandingOutputSchema.parse({
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

  it('accepts boolean hard constraint values from model output', () => {
    const parsed = GoalUnderstandingOutputSchema.parse({
      goal: {
        intent: 'find_restaurants',
        rawQuery: '找现在营业的餐厅',
        hardConstraints: [{
          kind: 'open_now',
          label: '当前营业',
          value: true,
          strict: true,
        }],
      },
      nextAction: 'plan',
    });

    expect(parsed.goal?.hardConstraints[0]).toEqual({
      kind: 'open_now',
      label: '当前营业',
      value: true,
      strict: true,
    });
  });

  it('defaults omitted patch reason from model output', () => {
    const parsed = GoalUnderstandingOutputSchema.parse({
      patch: {
        allowBroaden: true,
      },
      nextAction: 'plan',
    });

    expect(parsed.patch?.reason).toBe('GoalUnderstandingAgent 更新目标。');
  });

  it('accepts conversation mode from model output', () => {
    const parsed = GoalUnderstandingOutputSchema.parse({
      goal: goal({ primaryKeywords: ['火锅'] }),
      conversationMode: 'start_new_goal',
      nextAction: 'plan',
    });

    expect(parsed.conversationMode).toBe('start_new_goal');
  });
});
