describe('PoiTypeSelectionAgent', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.OPENAI_API_KEY = originalApiKey;
    jest.dontMock('@/lib/withTimeout');
    jest.resetModules();
  });

  it('selects only official food POI typecodes returned by the model', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';

    const fetchWithTimeout = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            function_call: {
              name: 'selectAmapPoiTypes',
              arguments: JSON.stringify({
                typeCodes: ['050700', '999999', '050000'],
                confidence: 0.88,
                rationale: '港式奶茶属于饮品，优先用冷饮店约束。',
              }),
            },
          },
        }],
      }),
    }));
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    const { runPoiTypeSelectionAgent } = await import('@/lib/agent/subagents/poiTypeSelectionAgent');
    const result = await runPoiTypeSelectionAgent({
      goal: {
        intent: 'find_restaurants',
        rawQuery: '港奶',
        requestedItems: [{ name: '港式奶茶', required: true, aliases: ['港奶', '奶茶'] }],
        acceptableCategories: [{ name: '奶茶', confidence: 0.9 }],
        alternativeGroups: [],
        primaryKeywords: ['港奶'],
        relatedKeywords: [],
        broadenedKeywords: [],
        hardConstraints: [],
        softPreferences: [],
        exclusions: [],
        ambiguity: [],
        clarificationNeeded: [],
        allowBroaden: false,
      },
      plan: {
        keywords: ['港奶'],
        radiusMeters: 1800,
        searchIntent: 'exact',
        allowedForPrimary: true,
        reason: '搜索用户明确表达的饮品。',
      },
    });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(result.typeCodes).toEqual(['050700']);
  });
});
