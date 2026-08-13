/**
 * 常规轮次的动作决策已经从 SupervisorPlanner 移到 policy.decideNextAction，
 * 这里只覆盖模型侧仅存的入口：策略枯竭后的 replan。
 *
 * 开放探索的兜底顺序等确定性行为的用例见 __tests__/lib/agent/policy.test.ts。
 */

import type { SearchReplanInput } from '@/lib/agent/supervisorPlanner';
import type { UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃素食',
    requestedItems: [{ name: '素食', required: true, aliases: [] }],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['素食'],
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

function replanInput(overrides: Partial<SearchReplanInput> = {}): SearchReplanInput {
  return {
    message: '想吃素食',
    goal: goal(),
    messages: [],
    attempts: [],
    observations: [],
    exhausted: { triedKeywords: ['素食'], triedIntents: ['exact'] },
    ...overrides,
  };
}

async function withModel(
  respond: (body: unknown) => unknown,
  run: (module: typeof import('@/lib/agent/supervisorPlanner')) => Promise<void>
): Promise<void> {
  const originalDeterministic = process.env.AGENT_DETERMINISTIC;
  const originalApiKey = process.env.OPENAI_API_KEY;
  const fetchWithTimeout = jest.fn(async (_url: string, init: { body: string }) => ({
    ok: true,
    json: async () => respond(JSON.parse(init.body)),
  }));

  delete process.env.AGENT_DETERMINISTIC;
  process.env.OPENAI_API_KEY = 'test-key';
  jest.resetModules();
  jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

  try {
    await run(await import('@/lib/agent/supervisorPlanner'));
  } finally {
    if (originalDeterministic === undefined) {
      delete process.env.AGENT_DETERMINISTIC;
    } else {
      process.env.AGENT_DETERMINISTIC = originalDeterministic;
    }
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    jest.dontMock('@/lib/withTimeout');
    jest.resetModules();
  }
}

function toolCallResponse(args: unknown) {
  return {
    choices: [{
      message: {
        tool_calls: [{
          type: 'function',
          function: {
            name: 'replanRestaurantSearch',
            arguments: JSON.stringify(args),
          },
        }],
      },
      finish_reason: 'stop',
    }],
  };
}

describe('SearchReplanAgent', () => {
  it('never calls the model in deterministic mode', async () => {
    const { runSearchReplan } = await import('@/lib/agent/supervisorPlanner');
    process.env.AGENT_DETERMINISTIC = '1';

    await expect(runSearchReplan(replanInput())).resolves.toBeNull();
  });

  it('returns fresh keywords the loop has not tried yet', async () => {
    await withModel(
      () => toolCallResponse({
        targets: [{ keyword: '轻食' }, { keyword: '沙拉' }],
        rationale: '素食可以换成轻食或沙拉。',
      }),
      async ({ runSearchReplan }) => {
        const output = await runSearchReplan(replanInput());

        expect(output?.targets?.map((target) => target.keyword)).toEqual(['轻食', '沙拉']);
        expect(output?.question).toBeUndefined();
      }
    );
  });

  it('drops keywords that were already tried or are excluded', async () => {
    await withModel(
      () => toolCallResponse({
        targets: [{ keyword: '素食' }, { keyword: '川菜' }, { keyword: '轻食' }],
      }),
      async ({ runSearchReplan }) => {
        const output = await runSearchReplan(replanInput({
          goal: goal({ exclusions: ['川菜'] }),
        }));

        expect(output?.targets?.map((target) => target.keyword)).toEqual(['轻食']);
      }
    );
  });

  it('falls back to the model question when it has no keywords left', async () => {
    await withModel(
      () => toolCallResponse({
        targets: [{ keyword: '素食' }],
        question: { question: '附近素食很少，换成清淡一点的中餐可以吗？' },
      }),
      async ({ runSearchReplan }) => {
        const output = await runSearchReplan(replanInput());

        expect(output?.targets).toBeUndefined();
        expect(output?.question?.question).toBe('附近素食很少，换成清淡一点的中餐可以吗？');
      }
    );
  });

  it('returns null when the model produces neither keywords nor a question', async () => {
    await withModel(
      () => toolCallResponse({ targets: [], rationale: '想不出来' }),
      async ({ runSearchReplan }) => {
        await expect(runSearchReplan(replanInput())).resolves.toBeNull();
      }
    );
  });

  it('returns null instead of throwing when the model call fails', async () => {
    const originalDeterministic = process.env.AGENT_DETERMINISTIC;
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.AGENT_DETERMINISTIC;
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();
    jest.doMock('@/lib/withTimeout', () => ({
      fetchWithTimeout: jest.fn(async () => {
        throw new Error('network down');
      }),
    }));

    try {
      const { runSearchReplan } = await import('@/lib/agent/supervisorPlanner');
      await expect(runSearchReplan(replanInput())).resolves.toBeNull();
    } finally {
      if (originalDeterministic === undefined) {
        delete process.env.AGENT_DETERMINISTIC;
      } else {
        process.env.AGENT_DETERMINISTIC = originalDeterministic;
      }
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      jest.dontMock('@/lib/withTimeout');
      jest.resetModules();
    }
  });
});
