import { deterministicPlanning } from '@/lib/agent/subagents/planningAgent';
import type { SearchAttempt, UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '日料或韩餐',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['日料', '韩餐'],
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

describe('PlanningAgent', () => {
  it('plans all explicit alternative intents instead of only the first one', () => {
    const output = deterministicPlanning({
      goal: goal({
        acceptableCategories: [
          { name: '日料', confidence: 0.9 },
          { name: '韩餐', confidence: 0.9 },
        ],
        alternativeGroups: [{ mode: 'any_of', items: ['日料', '韩餐'], minPerGroup: 1 }],
      }),
      attempts: [],
      targetCount: 8,
    });

    expect(output.plans[0].targets.map((target) => target.label)).toEqual(['日料', '韩餐']);
    expect(output.plans[0].allowedForPrimary).toBe(true);
  });

  it('does not authorize broadened primary results without user permission', () => {
    const attempts: SearchAttempt[] = [{
      keywords: ['牛排'],
      radius: 1800,
      searchIntent: 'exact',
      allowedForPrimary: true,
      reason: 'already tried',
      found: 0,
      accepted: 0,
    }];

    const output = deterministicPlanning({
      goal: goal({
        rawQuery: '想吃牛排',
        requestedItems: [{ name: '牛排', required: true, aliases: [] }],
        primaryKeywords: ['牛排'],
        broadenedKeywords: ['西餐'],
        allowBroaden: false,
      }),
      attempts,
      targetCount: 8,
    });

    expect(output.plans[0]).toEqual(expect.objectContaining({
      searchIntent: 'broadened',
      allowedForPrimary: false,
    }));
  });

  it('uses the unified token budget when model planning is enabled', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();

    const fetchWithTimeout = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            function_call: {
              name: 'planRestaurantSearchTargets',
              arguments: JSON.stringify({
                plans: [{
                  targets: [{ label: '日料', kind: 'cuisine', strictness: 'exact' }],
                  radiusMeters: 1800,
                  searchIntent: 'exact',
                  allowedForPrimary: true,
                  reason: '按用户明确目标搜索。',
                }],
              }),
            },
          },
        }],
      }),
    }));
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runPlanningAgent } = await import('@/lib/agent/subagents/planningAgent');
      await runPlanningAgent({
        goal: goal(),
        attempts: [],
        targetCount: 8,
      });

      const requestBody = JSON.parse(fetchWithTimeout.mock.calls[0][1].body);
      expect(requestBody.max_completion_tokens).toBe(4096);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
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
