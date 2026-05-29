import {
  applyKeywordExpansion,
  deterministicKeywordExpansion,
} from '@/lib/agent/subagents/keywordExpansionAgent';
import type { UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃日料',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['日料'],
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

describe('KeywordExpansionAgent', () => {
  afterEach(() => {
    jest.dontMock('@/lib/withTimeout');
    jest.resetModules();
  });

  it('uses taxonomy only as a deterministic fallback for search keyword expansion', () => {
    const expansion = deterministicKeywordExpansion(goal());

    expect(expansion.relatedKeywords).toEqual(expect.arrayContaining([
      '日本料理',
      '寿司',
      '刺身',
      '拉面',
    ]));
    expect(expansion.relatedKeywords).not.toContain('日料');
    expect(expansion.broadenedKeywords).toEqual(expect.arrayContaining(['亚洲料理']));
  });

  it('applies agent-generated keyword expansion without overwriting primary targets', () => {
    const expandedGoal = applyKeywordExpansion(goal(), {
      relatedKeywords: ['寿司', '居酒屋'],
      broadenedKeywords: ['亚洲料理'],
      rationale: 'Agent 联想到更容易命中 POI 的日料子类。',
    });

    expect(expandedGoal.primaryKeywords).toEqual(['日料']);
    expect(expandedGoal.relatedKeywords).toEqual(['寿司', '居酒屋']);
    expect(expandedGoal.broadenedKeywords).toEqual(['亚洲料理']);
  });

  it('does not generate expansions when there is no positive food target or open authorization', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();

    const fetchWithTimeout = jest.fn();
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runKeywordExpansionAgent } = await import('@/lib/agent/subagents/keywordExpansionAgent');
      const expansion = await runKeywordExpansionAgent({
        goal: goal({
          rawQuery: '不要辣的',
          primaryKeywords: [],
          hardConstraints: [{ kind: 'avoid_spicy', label: '不要辣', strict: true }],
          allowBroaden: false,
        }),
        attempts: [],
      });

      expect(fetchWithTimeout).not.toHaveBeenCalled();
      expect(expansion.relatedKeywords).toEqual([]);
      expect(expansion.broadenedKeywords).toEqual([]);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it('uses model-generated broadened keywords for open recommendations without primary targets', async () => {
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
              name: 'expandRestaurantSearchKeywords',
              arguments: JSON.stringify({
                relatedKeywords: ['寿司'],
                broadenedKeywords: ['简餐', '面馆', '餐厅'],
                rationale: '用户授权开放推荐，生成多样的餐饮探索词。',
              }),
            },
          },
        }],
      }),
    }));
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runKeywordExpansionAgent } = await import('@/lib/agent/subagents/keywordExpansionAgent');
      const expansion = await runKeywordExpansionAgent({
        goal: goal({
          rawQuery: '随意，你来选择',
          requestedItems: [],
          acceptableCategories: [],
          primaryKeywords: [],
          allowBroaden: true,
          softPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
        }),
        attempts: [],
      });
      const requestInit = fetchWithTimeout.mock.calls[0][1];
      const requestBody = JSON.parse(requestInit.body as string);
      const content = requestBody.messages[0].content as string;
      const modelInput = JSON.parse(content.slice(content.lastIndexOf('\n\n') + 2));

      expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
      expect(modelInput.openExplorationAllowed).toBe(true);
      expect(modelInput.goalContext.rawQuery).toBe('随意，你来选择');
      expect(expansion.relatedKeywords).toEqual([]);
      expect(expansion.broadenedKeywords).toEqual(['简餐', '面馆']);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it('uses model-generated expansions when the Agent is available', async () => {
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
              name: 'expandRestaurantSearchKeywords',
              arguments: JSON.stringify({
                relatedKeywords: ['怀石料理', '荞麦面'],
                broadenedKeywords: ['亚洲料理'],
                rationale: '根据日料目标动态联想到更细分的 POI 搜索词。',
              }),
            },
          },
        }],
      }),
    }));
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { runKeywordExpansionAgent } = await import('@/lib/agent/subagents/keywordExpansionAgent');
      const expansion = await runKeywordExpansionAgent({
        goal: goal(),
        attempts: [],
      });

      expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
      expect(expansion.relatedKeywords).toEqual(['怀石料理', '荞麦面']);
      expect(expansion.broadenedKeywords).toEqual(['亚洲料理']);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });
});
