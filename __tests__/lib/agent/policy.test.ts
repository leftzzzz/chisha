import {
  buildNoPrimaryQuestion,
  buildSearchPlan,
  hasTriedKeyword,
  nextSearchRadius,
  nextUntriedTarget,
  resolvePlanPoiType,
  resolveSearchActionPoiType,
  untriedTargets,
  type PolicyContext,
} from '@/lib/agent/policy';
import type { Constraint, SearchAttempt, UserGoal } from '@/lib/agent/types';

const location = { lat: 31.2304, lng: 121.4737, address: '上海市黄浦区' };

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃牛排',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['牛排'],
    relatedKeywords: [],
    broadenedKeywords: [],
    relatedTargets: [],
    broadenedTargets: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    authorizations: [],
    allowBroaden: false,
    ...overrides,
  };
}

function attempt(overrides: Partial<SearchAttempt> = {}): SearchAttempt {
  return {
    keywords: ['牛排'],
    radius: 1800,
    searchIntent: 'exact',
    allowedForPrimary: true,
    reason: '测试',
    found: 3,
    accepted: 1,
    ...overrides,
  };
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    goal: goal(),
    attempts: [],
    candidates: [],
    location,
    targetCount: 8,
    maxSearchCalls: 4,
    ...overrides,
  };
}

describe('policy 搜索半径', () => {
  it('starts from the default radius and grows by 1.25 per attempt', () => {
    expect(nextSearchRadius(context())).toBe(2250);
    expect(nextSearchRadius(context({ attempts: [attempt({ radius: 2250 })] }))).toBe(2813);
  });

  it('clamps to the strict distance constraint', () => {
    const strictDistance: Constraint = {
      kind: 'distance',
      label: '步行500米内',
      value: 500,
      maxMeters: 500,
      strict: true,
    };

    expect(nextSearchRadius(context({ goal: goal({ hardConstraints: [strictDistance] }) }))).toBe(500);
  });

  it('does not clamp on a non-strict distance preference', () => {
    const softDistance: Constraint = {
      kind: 'distance',
      label: '2公里内',
      value: 2000,
      maxMeters: 2000,
      strict: false,
    };

    // 非 strict 距离应允许逐轮扩大探索范围。
    expect(nextSearchRadius(context({ goal: goal({ hardConstraints: [softDistance] }) }))).toBe(2250);
  });
});

describe('policy poiType 选择', () => {
  it('prefers the target-provided food poi types', () => {
    expect(resolvePlanPoiType(goal(), '牛排', ['050118'])).toBe('050118');
  });

  it('falls back to keyword taxonomy when the target has no usable codes', () => {
    // 050000 是广义餐饮类，不应作为窄类型使用。
    expect(resolvePlanPoiType(goal(), '火锅', ['050000'])).toBe('050117');
  });

  it('lets keyword taxonomy override a model-provided poi type', () => {
    expect(resolveSearchActionPoiType(goal(), '火锅', '050118')).toBe('050117');
  });
});

describe('policy 关键词队列', () => {
  it('lists untried targets per kind', () => {
    const ctx = context({
      goal: goal({
        relatedKeywords: ['西餐', '铁板烧'],
        broadenedKeywords: ['日料'],
      }),
      attempts: [attempt({ keywords: ['西餐'] })],
    });

    expect(untriedTargets(ctx, 'related').map((target) => target.keyword)).toEqual(['铁板烧']);
    expect(nextUntriedTarget(ctx, 'broadened')?.keyword).toBe('日料');
    expect(hasTriedKeyword(ctx, '西餐')).toBe(true);
    expect(hasTriedKeyword(ctx, '铁板烧')).toBe(false);
  });

  it('treats goal primary targets as the initial queue', () => {
    const ctx = context({
      goal: goal({
        primaryKeywords: [],
        requestedItems: [{ name: '牛排', required: true, aliases: [] }],
        acceptableCategories: [{ name: '西餐', confidence: 0.8 }],
      }),
    });

    expect(untriedTargets(ctx, 'initial').map((target) => target.keyword)).toEqual(['牛排', '西餐']);
  });
});

describe('policy 计划构造', () => {
  it('builds a single-intent plan with a plan id', () => {
    const plan = buildSearchPlan(context(), { keyword: '牛排' }, 'exact', true, '测试');

    expect(plan.keywords).toEqual(['牛排']);
    expect(plan.searchIntent).toBe('exact');
    expect(plan.allowedForPrimary).toBe(true);
    expect(plan.planId).toEqual(expect.stringContaining('plan_'));
  });
});

describe('policy 追问', () => {
  it('asks to expand the radius under a strict distance constraint', () => {
    const strictDistance: Constraint = {
      kind: 'distance',
      label: '步行500米内',
      value: 500,
      maxMeters: 500,
      strict: true,
    };
    const question = buildNoPrimaryQuestion(
      context({ goal: goal({ hardConstraints: [strictDistance] }) })
    );

    expect(question.options).toContain('扩大范围');
    expect(question.optionEffects?.['扩大范围']?.setDistanceMaxMeters).toBe(5000);
  });

  it('offers a broaden authorization when nothing passed admission', () => {
    const question = buildNoPrimaryQuestion(context());

    expect(question.question).toContain('牛排');
    expect(question.optionEffects?.['搜更广的品类']?.allowBroaden).toBe(true);
  });

  it('distinguishes a verification outage from an empty result', () => {
    const question = buildNoPrimaryQuestion(context({ evaluationDegraded: true }));

    expect(question.question).toContain('验证服务暂时不可用');
    expect(question.options).toContain('重试');
  });
});
