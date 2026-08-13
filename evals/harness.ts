/**
 * 评测桩与计数器。
 *
 * 三个模型 agent 在 offline 模式下被替换成确定性桩，高德被 fixture 替换，
 * 于是每一轮的差异只来自 loop 本身。桩的输出由 case 声明，计数器由 runner 读取。
 *
 * 桩函数被 jest.mock 工厂通过 requireActual 引用，因此这里不能 import 任何
 * 被 mock 的模块（会形成环）。
 */

import type { Location, Restaurant } from '@/types';
import type {
  AmapFixture,
  FixtureRestaurant,
  StubExpansion,
  StubGoal,
} from './types';

export const EVAL_LOCATION: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

interface EvalCounters {
  plannerModelCalls: number;
  evaluationCalls: number;
  evaluatedIds: string[];
  evaluatedSlots: number;
  searchCalls: number;
  inFlightSearches: number;
  maxConcurrentSearches: number;
}

interface EvalStubs {
  goal?: StubGoal;
  expansion?: StubExpansion;
  message: string;
}

interface EvalHarnessState {
  mode: 'offline' | 'live';
  fixture: AmapFixture;
  stubs: EvalStubs;
  counters: EvalCounters;
}

function emptyCounters(): EvalCounters {
  return {
    plannerModelCalls: 0,
    evaluationCalls: 0,
    evaluatedIds: [],
    evaluatedSlots: 0,
    searchCalls: 0,
    inFlightSearches: 0,
    maxConcurrentSearches: 0,
  };
}

export const harnessState: EvalHarnessState = {
  mode: 'offline',
  fixture: {},
  stubs: { message: '' },
  counters: emptyCounters(),
};

export function beginTurn(stubs: EvalStubs): void {
  harnessState.stubs = stubs;
  harnessState.counters = emptyCounters();
}

export function readCounters(): EvalCounters {
  return { ...harnessState.counters, evaluatedIds: [...harnessState.counters.evaluatedIds] };
}

// ---------------------------------------------------------------------------
// 高德 fixture
// ---------------------------------------------------------------------------

/**
 * fixture 版 searchPlaces。
 *
 * 按关键词命中 fixture，再按 plan 半径过滤——半径过滤是真实存在的行为，
 * 严格距离用例依赖它。同时记录并发峰值，供 fan-out 验收使用。
 */
export function createFixtureSearchPlaces(
  fixture: AmapFixture
): (plan: { keywords: string[]; radiusMeters: number }) => Promise<Restaurant[]> {
  return async (plan) => {
    const counters = harnessState.counters;
    counters.searchCalls += 1;
    counters.inFlightSearches += 1;
    counters.maxConcurrentSearches = Math.max(
      counters.maxConcurrentSearches,
      counters.inFlightSearches
    );

    try {
      // 让并发真的重叠：没有 await 的话所有计划会顺序跑完
      await new Promise((resolve) => setTimeout(resolve, 2));

      const matched = plan.keywords.flatMap((keyword) => fixture[keyword] ?? []);
      const seen = new Set<string>();
      return matched
        .filter((item) => item.distance <= plan.radiusMeters)
        .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
        .map(toRestaurant);
    } finally {
      counters.inFlightSearches -= 1;
    }
  };
}

function toRestaurant(item: FixtureRestaurant): Restaurant {
  return {
    id: item.id,
    name: item.name,
    cuisineType: item.cuisineType,
    address: item.address ?? '上海市黄浦区测试路 1 号',
    distance: item.distance,
    rating: item.rating,
    averagePrice: item.averagePrice,
    businessStatus: item.businessStatus,
    poiTypeCode: item.poiTypeCode,
    location: EVAL_LOCATION,
    source: 'amap',
  };
}

// ---------------------------------------------------------------------------
// Supervisor 桩
// ---------------------------------------------------------------------------

interface SupervisorStubInput {
  message: string;
  goal?: unknown;
  limits?: unknown;
}

/**
 * 路由 runSupervisorPlanner：
 * - action 规划输入交给真实实现（M3 之前是确定性 planner，M3 之后不再被调用）
 * - 目标理解输入用 case 声明的桩目标
 */
export function routeSupervisorPlanner(
  actual: { runSupervisorPlanner: (input: unknown, context?: unknown) => Promise<unknown> },
  input: SupervisorStubInput,
  context?: unknown
): Promise<unknown> {
  if (input.goal && input.limits) {
    harnessState.counters.plannerModelCalls += 1;
    return actual.runSupervisorPlanner(input, context);
  }

  return Promise.resolve({
    goal: buildStubGoal(harnessState.stubs.goal ?? {}, input.message),
    nextAction: harnessState.stubs.goal?.clarifyingQuestion ? 'ask_user' : 'plan',
  });
}

export function buildStubGoal(stub: StubGoal, rawQuery: string) {
  return {
    intent: 'find_restaurants' as const,
    rawQuery,
    requestedItems: (stub.requestedItems ?? []).map((name) => ({
      name,
      required: true,
      aliases: [],
    })),
    acceptableCategories: (stub.acceptableCategories ?? []).map((name) => ({
      name,
      confidence: 0.85,
    })),
    alternativeGroups: [],
    primaryKeywords: stub.primaryKeywords ?? [],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: stub.strictDistanceMeters !== undefined
      ? [{
          kind: 'distance' as const,
          label: `${stub.strictDistanceMeters}米内`,
          value: stub.strictDistanceMeters,
          maxMeters: stub.strictDistanceMeters,
          strict: true,
        }]
      : [],
    softPreferences: stub.allowBroaden ? [{ name: '默认多样性', weight: 1, verifiable: true }] : [],
    exclusions: stub.exclusions ?? [],
    ambiguity: [],
    clarificationNeeded: stub.clarifyingQuestion
      ? [{
          reason: '需求缺少可验证的餐饮目标。',
          question: stub.clarifyingQuestion,
          allowFreeText: true,
        }]
      : [],
    authorizations: [],
    allowBroaden: stub.allowBroaden ?? false,
  };
}

// ---------------------------------------------------------------------------
// KeywordExpansion 桩
// ---------------------------------------------------------------------------

export function keywordExpansionStub() {
  const expansion = harnessState.stubs.expansion ?? {};
  const related = expansion.related ?? [];
  const broadened = expansion.broadened ?? [];

  return Promise.resolve({
    relatedKeywords: related,
    broadenedKeywords: broadened,
    relatedTargets: related.map((keyword) => ({ keyword })),
    broadenedTargets: broadened.map((keyword) => ({ keyword })),
    rationale: 'eval stub',
  });
}

// ---------------------------------------------------------------------------
// Evaluation 桩
// ---------------------------------------------------------------------------

interface EvaluationStubInput {
  goal: {
    requestedItems: Array<{ name: string }>;
    acceptableCategories: Array<{ name: string }>;
    primaryKeywords: string[];
  };
  plan: { keywords: string[]; searchIntent: string; allowedForPrimary: boolean };
  restaurants: Restaurant[];
  targetCount: number;
}

/**
 * 确定性候选验证：名称或菜系命中目标词即通过；放宽/兜底意图一律通过。
 *
 * 这不是在模拟模型的判断力，而是在固定它——评测关心的是 loop 调了几次评估、
 * 有没有重复评估，而不是模型判得准不准。
 */
export function evaluationStub(input: EvaluationStubInput) {
  const counters = harnessState.counters;
  counters.evaluationCalls += 1;
  counters.evaluatedSlots += input.restaurants.length;
  counters.evaluatedIds.push(...input.restaurants.map((item) => item.id));

  const targets = Array.from(new Set([
    ...input.plan.keywords,
    ...input.goal.requestedItems.map((item) => item.name),
    ...input.goal.acceptableCategories.map((category) => category.name),
    ...input.goal.primaryKeywords,
  ].filter(Boolean)));
  const broadIntent = input.plan.searchIntent === 'fallback'
    || input.plan.searchIntent === 'broadened';

  const verdicts = input.restaurants.map((item) => {
    const matched = targets.filter(
      (target) => item.name.includes(target) || item.cuisineType.includes(target)
    );
    const accepted = matched.length > 0 || broadIntent;

    return {
      restaurantId: item.id,
      status: (accepted ? 'passed' : 'failed') as 'passed' | 'failed' | 'unverified',
      primaryEligible: accepted && input.plan.allowedForPrimary,
      confidence: accepted ? 0.9 : 0.2,
      matchedItems: matched,
      matchedCategories: matched.length > 0 ? [item.cuisineType] : [],
      conflicts: accepted ? [] : ['候选与目标不匹配。'],
      evidence: accepted ? [`「${item.name}」符合搜索意图。`] : [],
      warnings: [],
    };
  });

  const selectedIds = verdicts
    .filter((verdict) => verdict.status === 'passed' && verdict.primaryEligible)
    .slice(0, input.targetCount)
    .map((verdict) => verdict.restaurantId);
  const selectedIdSet = new Set(selectedIds);

  return Promise.resolve({
    verdicts,
    selectedIds,
    candidateIds: verdicts
      .filter((verdict) => !selectedIdSet.has(verdict.restaurantId) && verdict.status !== 'failed')
      .map((verdict) => verdict.restaurantId),
    explanation: 'eval stub evaluation',
    unmetConstraints: verdicts.flatMap((verdict) => verdict.conflicts),
    source: 'model' as const,
  });
}
