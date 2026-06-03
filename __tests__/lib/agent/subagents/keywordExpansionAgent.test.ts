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
    ]));
    expect(expansion.relatedKeywords).toHaveLength(3);
    expect(expansion.relatedKeywords).not.toContain('日料');
    expect(expansion.broadenedKeywords).toEqual(expect.arrayContaining(['亚洲料理']));
    expect(expansion.relatedTargets?.find((target) => target.keyword === '日本料理')?.poiTypes)
      .toEqual(['050202']);
  });

  it('applies agent-generated keyword expansion without overwriting primary targets', () => {
    const expandedGoal = applyKeywordExpansion(goal(), {
      relatedKeywords: ['寿司', '居酒屋'],
      broadenedKeywords: ['亚洲料理'],
      relatedTargets: [
        { keyword: '寿司', poiTypes: ['050202'], confidence: 0.9 },
        { keyword: '居酒屋', poiTypes: ['050202'], confidence: 0.8 },
      ],
      broadenedTargets: [
        { keyword: '亚洲料理', poiTypes: ['050217'], confidence: 0.7 },
      ],
      rationale: 'Agent 联想到更容易命中 POI 的日料子类。',
    });

    expect(expandedGoal.primaryKeywords).toEqual(['日料']);
    expect(expandedGoal.relatedKeywords).toEqual(['寿司', '居酒屋']);
    expect(expandedGoal.broadenedKeywords).toEqual(['亚洲料理']);
    expect(expandedGoal.relatedTargets?.map((target) => [target.keyword, target.poiTypes])).toEqual([
      ['寿司', ['050202']],
      ['居酒屋', ['050202']],
    ]);
    expect(expandedGoal.broadenedTargets?.map((target) => [target.keyword, target.poiTypes])).toEqual([
      ['亚洲料理', ['050217']],
    ]);
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
      expect(expansion.relatedTargets).toEqual([]);
      expect(expansion.broadenedTargets).toEqual([]);
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
                relatedTargets: [{ keyword: '简餐', poiTypes: ['050300'] }],
                broadenedTargets: [
                  { keyword: '简餐', poiTypes: ['050300'] },
                  { keyword: '面馆', poiTypes: ['050000'] },
                  { keyword: '小吃', poiTypes: ['999999'] },
                  { keyword: '餐厅', poiTypes: ['050000'] },
                ],
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
      expect(requestBody.max_tokens).toBe(4096);
      expect(modelInput.openExplorationAllowed).toBe(true);
      expect(modelInput.goalContext.rawQuery).toBe('随意，你来选择');
      expect(expansion.relatedKeywords).toEqual([]);
      expect(expansion.broadenedKeywords).toEqual(['简餐', '面馆', '小吃']);
      expect(expansion.broadenedTargets?.map((target) => [target.keyword, target.poiTypes])).toEqual([
        ['简餐', ['050300']],
        ['面馆', []],
        ['小吃', ['050310']],
      ]);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it('demotes Japanese-cuisine targets for open recommendations', async () => {
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
                relatedTargets: [],
                broadenedTargets: [
                  { keyword: '日料', poiTypes: ['050202'] },
                  { keyword: '寿司', poiTypes: ['050202'] },
                ],
                rationale: '模型偏向了日料。',
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
          rawQuery: '没有具体想吃的，你来选',
          requestedItems: [],
          acceptableCategories: [],
          primaryKeywords: [],
          allowBroaden: true,
          softPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
        }),
        attempts: [],
      });

      expect(expansion.relatedKeywords).toEqual([]);
      expect(expansion.broadenedKeywords).toEqual(['小吃', '中餐', '快餐']);
      expect(expansion.broadenedKeywords[0]).not.toBe('日料');
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
                relatedTargets: [
                  { keyword: '怀石料理', poiTypes: ['050202'] },
                  { keyword: '荞麦面', poiTypes: ['050202'] },
                ],
                broadenedTargets: [
                  { keyword: '亚洲料理', poiTypes: ['050217'] },
                ],
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
      expect(expansion.relatedTargets?.map((target) => [target.keyword, target.poiTypes])).toEqual([
        ['怀石料理', ['050202']],
        ['荞麦面', ['050202']],
      ]);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.OPENAI_API_KEY = originalApiKey;
    }
  });
});
