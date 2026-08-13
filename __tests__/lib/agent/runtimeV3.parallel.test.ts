/**
 * 一轮内并行搜索。
 *
 * 模型仍只输出一个计划（"下一步做什么"），能不能顺带把已知的未尝试关键词
 * 一起搜（"这一步铺多宽"）由策略决定。关键不变量：
 * 1. attempts 按计划顺序追加，candidate.sourceAttempt 索引保持稳定；
 * 2. 单个计划失败不影响同批其他计划；
 * 3. 开关关闭时行为与串行完全一致。
 */

import type { AgentInput, SearchPlan, UserGoal } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function goal(): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃牛排',
    requestedItems: [{ name: '牛排', required: true, aliases: [] }],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['牛排'],
    relatedKeywords: ['西餐', '铁板烧'],
    broadenedKeywords: [],
    relatedTargets: [{ keyword: '西餐' }, { keyword: '铁板烧' }],
    broadenedTargets: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [],
    allowBroaden: false,
  };
}

function restaurant(id: string, name: string): Restaurant {
  return {
    id,
    name,
    cuisineType: '西餐',
    address: '测试地址',
    location,
    source: 'amap',
    distance: 300,
  };
}

function agentInput(): AgentInput {
  return {
    query: '想吃牛排',
    location,
    runtimeState: {
      goal: goal(),
      attempts: [],
      candidates: [],
      actions: [],
      observations: [],
    },
  };
}

/**
 * 以指定并行开关加载 runtime。
 *
 * 开关在模块加载时读取，因此必须重置模块注册表后再导入。
 */
async function loadRuntime(parallel: boolean) {
  jest.resetModules();
  process.env.AGENT_DETERMINISTIC = '1';
  if (parallel) {
    process.env.AGENT_PARALLEL_SEARCH = 'true';
  } else {
    delete process.env.AGENT_PARALLEL_SEARCH;
  }

  // 每一轮自由文本都要经过 Supervisor：模型不可用时 runtime 直接报错，
  // 不再有"按原文关键词搜索"的降级路径，所以这里必须显式桩掉理解环节。
  jest.doMock('@/lib/agent/supervisorPlanner', () => {
    const actual = jest.requireActual('@/lib/agent/supervisorPlanner');
    return {
      ...actual,
      runSupervisorPlanner: jest.fn(async () => ({ goal: goal() })),
      runSearchReplan: jest.fn(async () => null),
    };
  });

  jest.doMock('@/lib/agent/subagents/evaluationAgent', () => ({
    runEvaluationAgent: jest.fn(async (input: { restaurants: Restaurant[] }) => ({
      verdicts: input.restaurants.map((item) => ({
        restaurantId: item.id,
        status: 'passed' as const,
        primaryEligible: true,
        confidence: 0.9,
        matchedItems: ['牛排'],
        matchedCategories: [],
        conflicts: [],
        evidence: ['测试通过'],
        warnings: [],
      })),
      selectedIds: input.restaurants.map((item) => item.id),
      candidateIds: [],
      explanation: 'ok',
      unmetConstraints: [],
      source: 'model' as const,
    })),
  }));

  const { runSearchAgentV3 } = await import('@/lib/agent/runtimeV3');
  return runSearchAgentV3;
}

describe('并行搜索', () => {
  const originalParallel = process.env.AGENT_PARALLEL_SEARCH;

  afterEach(() => {
    jest.resetModules();
    if (originalParallel === undefined) {
      delete process.env.AGENT_PARALLEL_SEARCH;
    } else {
      process.env.AGENT_PARALLEL_SEARCH = originalParallel;
    }
  });

  it('executes one plan per action when the flag is off', async () => {
    const runSearchAgentV3 = await loadRuntime(false);
    const rounds: SearchPlan[][] = [];
    let current: SearchPlan[] = [];

    await runSearchAgentV3(agentInput(), () => undefined, async (plan) => {
      current.push(plan);
      rounds.push(current);
      current = [];
      return [restaurant(`r-${plan.keywords[0]}`, `${plan.keywords[0]}店`)];
    });

    expect(rounds.every((round) => round.length === 1)).toBe(true);
  });

  it('fans out untried related keywords within one action', async () => {
    const runSearchAgentV3 = await loadRuntime(true);
    const searched: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await runSearchAgentV3(agentInput(), () => undefined, async (plan) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      searched.push(plan.keywords[0]);
      return [restaurant(`r-${plan.keywords[0]}`, `${plan.keywords[0]}店`)];
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(searched).toEqual(expect.arrayContaining(['牛排']));

    // attempts 顺序稳定，且每个候选都能索引回自己的 attempt
    const attempts = result.runtimeState?.attempts ?? [];
    for (const candidate of result.runtimeState?.candidates ?? []) {
      expect(attempts[candidate.sourceAttempt - 1]).toBeDefined();
    }
  });

  it('isolates a failing plan from the rest of the batch', async () => {
    const runSearchAgentV3 = await loadRuntime(true);

    const result = await runSearchAgentV3(agentInput(), () => undefined, async (plan) => {
      if (plan.keywords[0] === '西餐') {
        throw new Error('amap search failed');
      }
      return [restaurant(`r-${plan.keywords[0]}`, `${plan.keywords[0]}店`)];
    });

    // 同批其他计划仍然产出候选，失败计划写入 error trace
    expect((result.runtimeState?.candidates ?? []).length).toBeGreaterThan(0);
    expect(result.runtimeState?.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ code: 'SEARCH_PROVIDER_FAILED' }),
      }),
    ]));
  });

  it('never exceeds the remaining search budget', async () => {
    const runSearchAgentV3 = await loadRuntime(true);
    const searched: string[] = [];

    const result = await runSearchAgentV3(agentInput(), () => undefined, async (plan) => {
      searched.push(plan.keywords[0]);
      return [restaurant(`r-${plan.keywords[0]}`, `${plan.keywords[0]}店`)];
    });

    const maxSearchCalls = 4;
    expect(searched.length).toBeLessThanOrEqual(maxSearchCalls);
    expect(result.runtimeState?.attempts.length).toBeLessThanOrEqual(maxSearchCalls);
  });
});
