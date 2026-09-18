import type { AgentEvent, UserGoal } from '@/lib/agent/types';
import type { Restaurant } from '@/types';

const location = { lat: 31.23, lng: 121.47 };
const place: Restaurant = {
  id: 'fixture', name: '测试寿司店', cuisineType: '寿司', address: '测试地址',
  location, source: 'amap', distance: 100,
};

async function setup(options: { open?: boolean; missingEvidence?: boolean } = {}) {
  jest.resetModules();
  process.env.AGENT_CONCURRENT_FIRST_SEARCH = 'true';
  const goal: UserGoal = {
    intent: 'find_restaurants', rawQuery: options.open ? '随便吃' : '寿司',
    requestedItems: options.open ? [] : [{ name: '寿司', required: true, aliases: [] }],
    acceptableCategories: [], alternativeGroups: [],
    primaryKeywords: options.open ? [] : ['寿司'],
    relatedKeywords: [], broadenedKeywords: [], hardConstraints: [],
    softPreferences: [], exclusions: [], ambiguity: [], clarificationNeeded: [],
    allowBroaden: Boolean(options.open),
  };
  jest.doMock('@/lib/agent/models/goalUnderstandingModel', () => ({
    runGoalUnderstandingModel: jest.fn(async () => ({ goal })),
  }));
  jest.doMock('@/lib/agent/models/keywordExpansionModel', () => ({
    runKeywordExpansionModel: jest.fn(async () => { throw new Error('expansion unavailable'); }),
  }));
  jest.doMock('@/lib/agent/models/evaluationModel', () => ({
    runEvaluationModel: jest.fn(async (input: { restaurants: Restaurant[] }) => ({
      verdicts: input.restaurants.map((item) => ({
        restaurantId: item.id, status: 'passed', primaryEligible: true, confidence: 1,
        matchedItems: ['寿司'], matchedCategories: [], evidence: [], warnings: [], conflicts: [],
        targetEvidence: options.missingEvidence ? [] : [{
          target: '寿司', kind: 'item', verdict: 'supported',
          references: [{ restaurantId: item.id, field: 'name', value: item.name }],
        }],
      })),
      selectedIds: [], candidateIds: [], explanation: 'fixture', unmetConstraints: [],
    })),
  }));
  return (await import('@/lib/agent/orchestrator/runtime')).runSearchAgentV3;
}

describe('partial keyword expansion failure', () => {
  const originalConcurrent = process.env.AGENT_CONCURRENT_FIRST_SEARCH;
  afterEach(() => {
    if (originalConcurrent === undefined) delete process.env.AGENT_CONCURRENT_FIRST_SEARCH;
    else process.env.AGENT_CONCURRENT_FIRST_SEARCH = originalConcurrent;
  });

  it('drains a slower first search, then publishes only verified explicit-target results', async () => {
    const run = await setup();
    let release!: (value: Restaurant[]) => void;
    const search = jest.fn(() => new Promise<Restaurant[]>((resolve) => { release = resolve; }));
    const events: AgentEvent[] = [];
    const pending = run({ query: '寿司', location }, (event) => events.push(event), search);
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(settled).toBe(false);
    expect(release).toBeDefined();
    release([place]);
    const result = await pending;
    expect(result.restaurants.map((item) => item.id)).toEqual(['fixture']);
    expect(result.warnings).toContain('相关搜索暂时不可用，结果仅来自原需求的已验证搜索。');
    expect(search).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'final')).toHaveLength(1);
    const eventCount = events.length;
    await Promise.resolve();
    expect(events).toHaveLength(eventCount);
  });

  it.each([
    { open: true, missingEvidence: false },
    { open: false, missingEvidence: true },
  ])('fails when expansion is required or no primary is qualified: %j', async (options) => {
    const run = await setup(options);
    const events: AgentEvent[] = [];
    const search = jest.fn(async () => [place]);
    await expect(run({ query: 'test', location }, (event) => events.push(event), search))
      .rejects.toThrow('expansion unavailable');
    expect(events.some((event) => event.type === 'final')).toBe(false);
    if (options.open) expect(search).not.toHaveBeenCalled();
  });
});
