/**
 * 模型角色的输入契约。
 *
 * 判据：一个模型角色的输入应该能用一句话描述**而不提到 loop**。
 * 「给定目标和这批餐厅事实，逐家判定是否满足」合格；
 * 「给定 authorizations 和 attempts，注意开放推荐时要多样」不合格——
 * 那是在请模型角色参与编排。
 *
 * 这组用例拦的就是后者：只要有人把编排状态塞回模型角色的输入，这里就红。
 */

import type { SearchAttempt, SearchPlan, UserGoal } from '@/lib/agent/types';
import type { Restaurant } from '@/types';

/** 绝不能出现在任何模型角色输入里的编排层状态。 */
const ORCHESTRATION_STATE_KEYS = [
  'authorizations',
  'allowBroaden',
  'goalVersion',
  'relatedTargets',
  'broadenedTargets',
  'relatedKeywords',
  'broadenedKeywords',
  'clarificationNeeded',
  'allowedForPrimary',
  'sourceAttempt',
  'maxSearchCalls',
];

function collectKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, found));
    return found;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      collectKeys(child, found);
    }
  }

  return found;
}

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃火锅',
    requestedItems: [{ name: '火锅', required: true, aliases: [] }],
    acceptableCategories: [{ name: '川菜', confidence: 0.8 }],
    alternativeGroups: [],
    primaryKeywords: ['火锅'],
    relatedKeywords: ['涮锅'],
    broadenedKeywords: ['中餐'],
    relatedTargets: [{ keyword: '涮锅', poiTypes: ['050117'] }],
    broadenedTargets: [{ keyword: '中餐', poiTypes: ['050100'] }],
    hardConstraints: [],
    softPreferences: [{ name: '人气高', weight: 1, verifiable: false }],
    exclusions: ['日料'],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [
      {
        id: 'auth_1',
        kind: 'category_broaden',
        createdAt: 0,
        reason: '用户授权放宽。',
        constraints: { allowedSearchIntents: ['broadened'] },
      },
    ],
    allowBroaden: true,
    goalVersion: 3,
    ...overrides,
  } as UserGoal;
}

const plan: SearchPlan = {
  keywords: ['火锅'],
  radiusMeters: 1800,
  poiType: '050117',
  searchIntent: 'exact',
  allowedForPrimary: true,
  reason: '先搜索用户明确表达的餐饮目标。',
  planId: 'plan_1',
};

const attempts: SearchAttempt[] = [{
  keywords: ['火锅'],
  radius: 1800,
  poiType: '050117',
  searchIntent: 'exact',
  allowedForPrimary: true,
  reason: '先搜索用户明确表达的餐饮目标。',
  found: 10,
  accepted: 3,
}];

const restaurants: Restaurant[] = [{
  id: 'r1',
  name: '某火锅店',
  cuisineType: '火锅',
  address: '测试地址',
  distance: 300,
  location: { lat: 30.2794, lng: 120.1305 },
  source: 'amap',
}];

/**
 * 通过一次真实模型调用把 modelInput 抓出来。
 *
 * 直接测 buildXModelInput 需要导出内部函数；抓请求体更贴近真相——
 * 它验证的是"实际发出去的 JSON 里有什么"。
 */
async function captureModelInput(
  load: () => Promise<(input: never) => Promise<unknown>>,
  input: unknown,
  functionName: string
): Promise<Record<string, unknown>> {
  const fetchWithTimeout = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          function_call: {
            name: functionName,
            arguments: JSON.stringify({
              verdicts: [],
              selectedIds: [],
              candidateIds: [],
              explanation: '',
              unmetConstraints: [],
              relatedTargets: [],
              broadenedTargets: [],
              rationale: '',
            }),
          },
        },
      }],
    }),
  });
  jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

  const run = await load();
  await run(input as never).catch(() => undefined);

  const body = JSON.parse(fetchWithTimeout.mock.calls[0][1].body as string);
  return JSON.parse(body.messages[1].content) as Record<string, unknown>;
}

describe('模型角色输入契约', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.AGENT_DETERMINISTIC;
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    jest.dontMock('@/lib/withTimeout');
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    process.env.AGENT_DETERMINISTIC = '1';
  });

  it('EvaluationModel 只看到可验证的目标与餐厅事实', async () => {
    const modelInput = await captureModelInput(
      async () => (await import('@/lib/agent/models/evaluationModel')).runEvaluationModel,
      { goal: goal(), plan, restaurants, targetCount: 8 },
      'evaluateRestaurantCandidates'
    );

    const keys = collectKeys(modelInput);
    for (const forbidden of ORCHESTRATION_STATE_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }

    // 该看到的还得在：判定要靠这些。
    expect(keys.has('requestedItems')).toBe(true);
    expect(keys.has('hardConstraints')).toBe(true);
    expect(keys.has('searchedKeywords')).toBe(true);
  });

  it('KeywordExpansionModel 拿到的是编排层算好的 mode，不用自己推断阶段', async () => {
    const modelInput = await captureModelInput(
      async () => (await import('@/lib/agent/models/keywordExpansionModel')).runKeywordExpansionModel,
      { goal: goal(), attempts },
      'expandRestaurantSearchKeywords'
    );

    const keys = collectKeys(modelInput);
    for (const forbidden of ORCHESTRATION_STATE_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }

    const trusted = modelInput.trustedContext as Record<string, unknown>;
    expect(trusted.mode).toBe('expand_targets');
    expect(trusted.targets).toEqual(expect.arrayContaining(['火锅']));
  });

  it('GoalUnderstandingModel 不需要搜索历史', async () => {
    const modelInput = await captureModelInput(
      async () => (await import('@/lib/agent/models/goalUnderstandingModel')).runGoalUnderstandingModel,
      { message: '想吃火锅' },
      'understandRestaurantGoal'
    );

    const keys = collectKeys(modelInput);
    // 先确认真的抓到了输入，否则下面几条"不存在"断言等于什么都没测。
    expect(keys.has('userMessage')).toBe(true);
    // 理解一句话不需要知道搜了几轮、搜出了什么。
    expect(keys.has('attempts')).toBe(false);
    expect(keys.has('verdictSummary')).toBe(false);
    expect(keys.has('toolObservations')).toBe(false);
  });
});
