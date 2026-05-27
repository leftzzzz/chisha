import { runSearchAgent } from '@/lib/agent/runtime';
import { parseUserGoal, type AgentGoalDraft } from '@/lib/agent/planner';
import type {
  AgentDecision,
  AgentDecisionMaker,
  AgentEvent,
  AgentInput,
  SearchPlan,
  UserGoal,
} from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function restaurant(
  id: string,
  name: string,
  cuisineType: string,
  distance: number = 600
): Restaurant {
  return {
    id,
    name,
    cuisineType,
    distance,
    address: '测试地址',
    location,
    source: 'amap',
  };
}

function goalParser(draft: AgentGoalDraft): (input: AgentInput) => Promise<UserGoal> {
  return async (input) => parseUserGoal(input.query, input.preferenceSummary, draft);
}

function decisionSequence(decisions: AgentDecision[]): AgentDecisionMaker {
  let index = 0;
  return async () => decisions[index++] ?? { type: 'finish' };
}

describe('runSearchAgent', () => {
  it('expands specific hotpot queries and reports unmet exact matches', async () => {
    const events: AgentEvent[] = [];
    const result = await runSearchAgent(
      { query: '想吃潮汕牛肉火锅', location },
      (event) => events.push(event),
      async (plan: SearchPlan) => {
        if (plan.keywords.includes('潮汕牛肉火锅')) {
          return [restaurant('r1', '潮汕牛肉火锅', '火锅', 500)];
        }

        if (plan.keywords.includes('牛肉火锅')) {
          return [restaurant('r2', '牛肉火锅店', '火锅', 700)];
        }

        if (plan.keywords.includes('火锅')) {
          return [
            restaurant('r3', '社区火锅', '火锅', 900),
            restaurant('r4', '老街火锅', '火锅', 1000),
            restaurant('r5', '鲜味火锅', '火锅', 1200),
          ];
        }

        return [];
      },
      goalParser({
        requestedItems: [{ name: '潮汕牛肉火锅', required: true, aliases: ['牛肉火锅'] }],
        acceptableCategories: [{ name: '火锅', confidence: 0.9 }],
        primaryKeywords: ['潮汕牛肉火锅'],
        relatedKeywords: ['牛肉火锅'],
        broadenedKeywords: ['火锅'],
        allowBroaden: true,
      }),
      decisionSequence([
        {
          type: 'search',
          plan: {
            keywords: ['牛肉火锅'],
            radiusMeters: 1800,
            searchIntent: 'synonym',
            allowedForPrimary: true,
            reason: 'Agent 决定先尝试同义表达。',
          },
        },
        {
          type: 'search',
          plan: {
            keywords: ['火锅'],
            radiusMeters: 1800,
            searchIntent: 'broadened',
            allowedForPrimary: true,
            reason: '用户允许放宽后，Agent 决定扩展到上位品类。',
          },
        },
      ])
    );

    expect(result.restaurants.length).toBeGreaterThan(1);
    expect(result.unmetConstraints.join('')).toContain('潮汕牛肉火锅');
    expect(events.some((event) => event.type === 'strategy_change')).toBe(true);
    expect(events.some((event) => event.type === 'final')).toBe(true);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });

  it('does not return spicy-risk restaurants when user avoids spicy food', async () => {
    const result = await runSearchAgent(
      { query: '今天想吃清淡的，不吃辣', location },
      () => undefined,
      async () => [
        restaurant('r1', '川味小馆', '川菜', 300),
        restaurant('r2', '清粥小菜', '粥', 400),
        restaurant('r3', '粤式茶餐厅', '粤菜', 500),
        restaurant('r4', '寿司店', '日本料理', 600),
      ],
      goalParser({
        acceptableCategories: [
          { name: '粥', confidence: 0.8 },
          { name: '粤菜', confidence: 0.8 },
          { name: '日料', confidence: 0.6 },
        ],
        primaryKeywords: ['粥', '粤菜', '日料'],
        allowBroaden: false,
      })
    );

    const names = result.restaurants.map((item) => item.name).join('、');
    expect(names).not.toContain('川味小馆');
    expect(result.restaurants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '清粥小菜' }),
        expect.objectContaining({ name: '粤式茶餐厅' }),
      ])
    );
  });

  it('returns fewer than target without random fill when candidates are insufficient', async () => {
    const result = await runSearchAgent(
      { query: '想吃素食', location },
      () => undefined,
      async () => [
        restaurant('r1', '素食餐厅', '素食', 300),
      ],
      goalParser({
        acceptableCategories: [{ name: '素食', confidence: 0.9 }],
        primaryKeywords: ['素食'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants).toHaveLength(1);
    expect(result.unmetConstraints.join('')).toContain('只找到 1 家');
  });

  it('uses history preferences without overriding explicit current intent', async () => {
    const result = await runSearchAgent(
      {
        query: '想吃日料',
        location,
        preferenceSummary: {
          avoidedCuisines: [{ name: '日本料理', weight: 5 }],
          favoriteCuisines: [{ name: '粤菜', weight: 5 }],
        },
      },
      () => undefined,
      async () => [
        restaurant('r1', '寿司店', '日本料理', 500),
        restaurant('r2', '粤菜餐厅', '粤菜', 300),
      ],
      goalParser({
        acceptableCategories: [{ name: '日料', confidence: 0.9 }],
        primaryKeywords: ['日料', '日本料理'],
        relatedKeywords: ['寿司'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants[0].name).toBe('寿司店');
  });

  it('does not treat generic provider category text as a verified specific cuisine', async () => {
    const result = await runSearchAgent(
      { query: '想吃日料', location },
      () => undefined,
      async () => [
        restaurant('r1', '附近好店', '餐饮服务', 350),
      ],
      goalParser({
        acceptableCategories: [{ name: '日料', confidence: 0.9 }],
        primaryKeywords: ['日料'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants).toEqual([]);
    expect(result.candidates.map((item) => item.name)).not.toContain('附近好店');
  });

  it('extracts common cuisine keywords without an LLM draft', async () => {
    const searchedKeywords: string[][] = [];
    const result = await runSearchAgent(
      { query: '想吃日料', location },
      () => undefined,
      async (plan) => {
        searchedKeywords.push(plan.keywords);
        return [restaurant('r1', '寿司店', '日本料理', 300)];
      },
      async (input) => parseUserGoal(input.query, input.preferenceSummary)
    );

    expect(searchedKeywords[0]).toContain('日料');
    expect(result.restaurants.map((item) => item.name)).toEqual(['寿司店']);
  });

  it('filters restaurants explicitly marked closed when user asks for open places', async () => {
    const result = await runSearchAgent(
      { query: '附近营业中的餐厅', location },
      () => undefined,
      async () => [
        { ...restaurant('r1', '已打烊餐厅', '餐厅', 300), businessStatus: 'closed' },
        { ...restaurant('r2', '营业中餐厅', '餐厅', 500), businessStatus: 'open' },
      ],
      goalParser({
        acceptableCategories: [{ name: '餐厅', confidence: 0.6 }],
        primaryKeywords: ['餐厅'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['营业中餐厅']);
    expect(result.unmetConstraints.join('')).toContain('营业状态');
  });

  it('keeps explicit dish requests out of generic fallback primary recommendations', async () => {
    const result = await runSearchAgent(
      { query: '炸鸡薯条', location },
      () => undefined,
      async () => [
        restaurant('r1', '沙县小吃', '小吃', 200),
        restaurant('r2', '炸鸡汉堡店', '快餐', 260),
        restaurant('r3', '麦当劳', '快餐', 320),
      ],
      goalParser({
        requestedItems: [
          { name: '炸鸡', required: true, aliases: ['鸡排', '炸物', '炸鸡汉堡'] },
          { name: '薯条', required: true, aliases: ['汉堡', '麦当劳', '肯德基'] },
        ],
        acceptableCategories: [{ name: '快餐', confidence: 0.8 }],
        primaryKeywords: ['炸鸡', '薯条'],
        relatedKeywords: ['炸鸡汉堡', '快餐'],
        broadenedKeywords: ['小吃'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['炸鸡汉堡店', '麦当劳']);
    expect(result.candidates.map((item) => item.name)).toContain('沙县小吃');
  });

  it('does not expand strict downstairs distance constraints', async () => {
    const searchedRadii: number[] = [];
    const result = await runSearchAgent(
      { query: '下楼就能吃的', location },
      () => undefined,
      async (plan) => {
        searchedRadii.push(plan.radiusMeters);
        return [
          restaurant('r1', '楼下简餐', '餐厅', 300),
          restaurant('r2', '远处餐厅', '餐厅', 1200),
        ];
      },
      goalParser({
        acceptableCategories: [{ name: '餐厅', confidence: 0.6 }],
        primaryKeywords: ['餐厅'],
        allowBroaden: false,
      }),
      decisionSequence([
        {
          type: 'search',
          plan: {
            keywords: ['餐厅'],
            radiusMeters: 3000,
            searchIntent: 'synonym',
            allowedForPrimary: true,
            reason: 'Agent 尝试重搜，但 Runtime 必须保留严格距离约束。',
          },
        },
      ])
    );

    expect(searchedRadii.every((radius) => radius <= 500)).toBe(true);
    expect(result.restaurants.map((item) => item.name)).toEqual(['楼下简餐']);
  });

  it('lets the Agent pause and ask the user instead of using workflow fallback', async () => {
    const question = {
      reason: '候选不足以满足原始目标，需要用户选择是否放宽。',
      question: '没有找到完全匹配的餐厅，要先看看候补吗？',
      options: ['查看候补', '继续调整需求'],
      allowFreeText: true,
    };

    const result = await runSearchAgent(
      { query: '想吃非常具体的菜', location },
      () => undefined,
      async () => [],
      goalParser({
        requestedItems: [{ name: '非常具体的菜', required: true, aliases: [] }],
        primaryKeywords: ['非常具体的菜'],
        allowBroaden: false,
      }),
      decisionSequence([{ type: 'ask_user', question }])
    );

    expect(result.paused).toBe(true);
    expect(result.question).toEqual(question);
    expect(result.restaurants).toEqual([]);
  });

  it('pauses instead of emitting an empty final result when no primary recommendations pass', async () => {
    const events: AgentEvent[] = [];

    const result = await runSearchAgent(
      { query: '想吃非常具体的菜', location },
      (event) => events.push(event),
      async () => [],
      goalParser({
        requestedItems: [{ name: '非常具体的菜', required: true, aliases: [] }],
        primaryKeywords: ['非常具体的菜'],
        allowBroaden: false,
      })
    );

    expect(result.paused).toBe(true);
    expect(result.question?.question).toContain('非常具体的菜');
    expect(result.restaurants).toEqual([]);
    expect(events.some((event) => event.type === 'final')).toBe(false);
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  it('pauses before searching when the Agent goal parser asks for clarification', async () => {
    const searchPlaces = jest.fn(async () => [restaurant('r1', '默认餐厅', '餐厅', 300)]);

    const result = await runSearchAgent(
      { query: '随便吃点', location },
      () => undefined,
      searchPlaces,
      goalParser({
        clarificationNeeded: [{
          reason: '用户需求较开放，缺少可验证目标。',
          question: '想吃正餐、小吃，还是喝点东西？',
          options: [
            { label: '正餐', value: '正餐' },
            { label: '小吃', value: '小吃' },
          ],
          allowFreeText: true,
        }],
        allowBroaden: true,
      })
    );

    expect(searchPlaces).not.toHaveBeenCalled();
    expect(result.paused).toBe(true);
    expect(result.question?.options).toEqual(['正餐', '小吃']);
  });

  it('keeps runtime state when paused so a later answer can continue from previous attempts', async () => {
    const question = {
      question: '要扩大范围吗？',
      options: ['扩大范围'],
      allowFreeText: true,
      optionEffects: { '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 } },
    };

    const first = await runSearchAgent(
      { query: '下楼就能吃的日料', location },
      () => undefined,
      async () => [],
      goalParser({
        acceptableCategories: [{ name: '日料', confidence: 0.9 }],
        primaryKeywords: ['日料'],
        relatedKeywords: ['日本料理'],
        allowBroaden: false,
      }),
      decisionSequence([{ type: 'ask_user', question }])
    );

    expect(first.paused).toBe(true);
    expect(first.runtimeState?.attempts).toHaveLength(1);

    const second = await runSearchAgent(
      {
        query: '下楼就能吃的日料，扩大范围',
        location,
        runtimeState: first.runtimeState,
      },
      () => undefined,
      async (plan) => plan.keywords.includes('日本料理')
        ? [restaurant('r1', '寿司店', '日本料理', 1600)]
        : [],
      async () => ({
        ...first.runtimeState!.goal!,
        allowBroaden: true,
        hardConstraints: [
          {
            kind: 'distance',
            label: '5000米内',
            value: 5000,
            maxMeters: 5000,
            strict: false,
          },
        ],
      }),
      decisionSequence([
        {
          type: 'search',
          plan: {
            keywords: ['日本料理'],
            radiusMeters: 5000,
            searchIntent: 'synonym',
            allowedForPrimary: true,
            reason: '继续上一轮后尝试同义词。',
          },
        },
      ])
    );

    expect(second.restaurants.map((item) => item.name)).toEqual(['寿司店']);
    expect(second.runtimeState?.attempts.length).toBeGreaterThan(1);
  });

  it('does not ask the initial clarification again after a resumed answer adds a search target', async () => {
    const previousGoal = parseUserGoal('随便吃点');
    previousGoal.primaryKeywords = ['中餐', '餐厅'];
    previousGoal.acceptableCategories = [{ name: '中餐', confidence: 0.8 }];
    previousGoal.clarificationNeeded = [];

    const searchPlaces = jest.fn(async () => [
      restaurant('r1', '家常菜馆', '中餐', 300),
    ]);

    const result = await runSearchAgent(
      {
        query: '随便吃点，正餐',
        location,
        runtimeState: {
          goal: previousGoal,
          attempts: [],
          candidates: [],
        },
      },
      () => undefined,
      searchPlaces,
      goalParser({
        clarificationNeeded: [{
          reason: '用户需求较开放，缺少可验证目标。',
          question: '想吃正餐、小吃，还是喝点东西？',
          options: [
            { label: '正餐', value: '正餐' },
            { label: '小吃', value: '小吃' },
          ],
          allowFreeText: true,
        }],
        allowBroaden: true,
      })
    );

    expect(searchPlaces).toHaveBeenCalled();
    expect(result.paused).not.toBe(true);
    expect(result.restaurants.map((item) => item.name)).toEqual(['家常菜馆']);
  });

  it('keeps alternative intents from the Agent goal', async () => {
    const result = await runSearchAgent(
      { query: '日料或韩餐', location },
      () => undefined,
      async () => [
        restaurant('r1', '寿司店', '日本料理', 400),
        restaurant('r2', '韩式烤肉', '韩国料理', 450),
      ],
      goalParser({
        acceptableCategories: [
          { name: '日料', confidence: 0.9 },
          { name: '韩餐', confidence: 0.9 },
        ],
        alternativeGroups: [{ mode: 'any_of', items: ['日料', '韩餐'], minPerGroup: 1 }],
        primaryKeywords: ['日料', '韩餐'],
        allowBroaden: false,
      })
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['寿司店', '韩式烤肉']);
  });
});
