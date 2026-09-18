import {
  buildNoPrimaryQuestion,
  buildSearchPlan,
  decideNextAction,
  hasTriedKeyword,
  nextSearchRadius,
  nextUntriedTarget,
  planSearchBatch,
  primaryCandidates,
  primaryTargetLabel,
  resolvePlanPoiType,
  untriedTargets,
  type PolicyContext,
} from '@/lib/agent/orchestrator/policy';
import type {
  Constraint,
  RestaurantCandidate,
  SearchAttempt,
  UserGoal,
} from '@/lib/agent/types';
import { validateSearchPlan } from '@/lib/agent/guards';

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
  it('keeps provider category codes out of search plans', () => {
    expect(resolvePlanPoiType(goal(), '牛排', ['050118'])).toBeUndefined();
    expect(resolvePlanPoiType(goal({ poiType: '050117' }), '未知词')).toBeUndefined();
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

    // effect 按 id 挂载，不按文案——文案匹配正是追问死循环的成因。
    expect(question.options?.map((option) => option.id)).toContain('expand_distance');
    expect(question.optionEffects?.expand_distance?.setDistanceMaxMeters).toBe(5000);
  });

  it('explains insufficient evidence instead of blaming a strict distance limit', () => {
    const strictDistance: Constraint = {
      kind: 'distance',
      label: '步行500米内',
      value: 500,
      maxMeters: 500,
      strict: true,
    };
    const uncertain = candidate('r1', '名称疑似寿司店');
    uncertain.verification.status = 'unverified';
    uncertain.verification.primaryEligible = false;
    uncertain.verification.itemMatches = [];
    uncertain.verification.categoryMatches = [];
    uncertain.verification.warnings = ['没有可追溯菜单证据证明供应寿司。'];

    const question = buildNoPrimaryQuestion(context({
      goal: goal({ hardConstraints: [strictDistance] }),
      attempts: [attempt({ found: 1, accepted: 1 })],
      candidates: [uncertain],
    }));

    expect(question.reason).toContain('证据不足');
    expect(question.question).toContain('证据');
    expect(question.options?.map((option) => option.id)).not.toContain('expand_distance');
  });

  it('offers a broaden authorization when nothing passed admission', () => {
    const question = buildNoPrimaryQuestion(context());

    expect(question.question).toContain('牛排');
    expect(question.optionEffects?.authorize_category_broaden?.allowBroaden).toBe(true);
  });

  it('never keys an option effect by its display label', () => {
    const question = buildNoPrimaryQuestion(context());

    for (const option of question.options ?? []) {
      expect(question.optionEffects?.[option.label]).toBeUndefined();
    }
  });

  it('aborts instead of searching when candidate verification failed', () => {
    const decision = decideNextAction(context({ evaluationFailed: true }));

    expect(decision.kind).toBe('abort');
  });

  it('finishes with the verified subset when verification partially failed', () => {
    const decision = decideNextAction(
      context({
        evaluationFailed: true,
        candidates: [candidate('r1', '牛排家')],
        attempts: [attempt()],
      })
    );

    expect(decision.kind).toBe('finish');
    expect(decision.kind === 'finish' && decision.reason).toBe('PARTIAL_EVALUATION_FAILURE');
  });
});

function candidate(id: string, brand: string, sourceAttempt = 1): RestaurantCandidate {
  return {
    restaurant: {
      id,
      name: brand,
      cuisineType: '牛排',
      address: '测试地址',
      distance: 400,
      location,
      source: 'amap',
    },
    score: 90,
    matched: [],
    warnings: [],
    sourceAttempt,
    verification: {
      restaurantId: id,
      status: 'passed',
      primaryEligible: true,
      hardFailures: [],
      itemMatches: [{ requestedItem: '牛排', matchedBy: 'llm_semantic', confidence: 0.9 }],
      categoryMatches: ['牛排'],
      warnings: [],
      confidence: 0.9,
    },
  };
}

describe('policy 计划批次', () => {
  it.each(['餐厅', '羊肉火锅', '未知餐饮目标'])(
    'does not attach provider category codes to the query %s', (keyword) => {
      const plan = buildSearchPlan(context({ goal: goal({
        goalId: 'goal_1',
        poiType: '050117',
        acceptableCategories: [{ name: '火锅', confidence: 0.9 }],
      }) }), { keyword, poiTypes: ['050102'] }, 'exact', true, '测试');
      expect(plan.keywords).toEqual([keyword]);
      expect(plan.searchAction?.query).toBe(keyword);
      expect(plan.poiType).toBeUndefined();
    }
  );

  it('searches every explicit target in one batch', () => {
    const plans = planSearchBatch(context({
      goal: goal({ primaryKeywords: ['牛排', '意面'] }),
    }));

    expect(plans.map((plan) => plan.keywords[0])).toEqual(['牛排', '意面']);
    expect(plans.every((plan) => plan.searchIntent === 'exact')).toBe(true);
  });

  it.each([
    ['羊肉火锅', '广式羊肉火锅'],
    ['无糖柠檬茶', '鲜榨柠檬茶'],
  ])('keeps both modifier targets %s and %s', (first, second) => {
    const plans = planSearchBatch(context({
      goal: goal({ primaryKeywords: [first, second] }),
    }));

    expect(plans.map((plan) => plan.keywords[0])).toEqual([first, second]);
  });

  it('keeps explicit provider codes out of planning for a malformed target', () => {
    const malformedTarget = '羊肉火锅';
    const plan = buildSearchPlan(
      context({ goal: goal({ primaryKeywords: [malformedTarget], goalId: 'goal_1' }) }),
      malformedTarget,
      'exact',
      true,
      '测试'
    );
    const violations = validateSearchPlan(plan, context({ goal: goal({ primaryKeywords: [malformedTarget], goalId: 'goal_1' }) }));

    expect(malformedTarget).toBe('羊肉火锅');
    expect(plan.keywords).toEqual(['羊肉火锅']);
    expect(plan.searchIntent).toBe('exact');
    expect(plan.searchAction?.query).toBe('羊肉火锅');
    expect(plan.searchAction?.relation).toBe('exact');
    expect(violations).toEqual([]);
  });

  it('never exceeds the remaining search budget', () => {
    const plans = planSearchBatch(
      context({ goal: goal({ primaryKeywords: ['牛排', '意面', '披萨'] }) }),
      1
    );

    expect(plans).toHaveLength(1);
  });

  it('collapses to a single plan when fan-out is disabled', () => {
    const original = process.env.AGENT_PARALLEL_SEARCH;
    process.env.AGENT_PARALLEL_SEARCH = 'false';

    try {
      const plans = planSearchBatch(context({
        goal: goal({ primaryKeywords: ['牛排', '意面'] }),
      }));

      expect(plans).toHaveLength(1);
    } finally {
      if (original === undefined) {
        delete process.env.AGENT_PARALLEL_SEARCH;
      } else {
        process.env.AGENT_PARALLEL_SEARCH = original;
      }
    }
  });

  it('mixes one synonym with adjacent categories when nothing was found', () => {
    const plans = planSearchBatch(context({
      goal: goal({
        relatedTargets: [{ keyword: '西餐' }, { keyword: '铁板烧' }],
        broadenedTargets: [{ keyword: '快餐' }],
        allowBroaden: true,
      }),
      attempts: [attempt({ found: 0, accepted: 0 })],
    }));

    // 一个结果都没有时优先换镜头：不能把预算全花在同义词上
    expect(plans.map((plan) => plan.keywords[0])).toEqual(['西餐', '快餐']);
    expect(plans.map((plan) => plan.searchIntent)).toEqual(['synonym', 'broadened']);
  });

  it('goes deep on synonyms once there are candidates', () => {
    const plans = planSearchBatch(context({
      goal: goal({
        relatedTargets: [{ keyword: '西餐' }, { keyword: '铁板烧' }],
        broadenedTargets: [{ keyword: '快餐' }],
      }),
      attempts: [attempt()],
      candidates: [candidate('r1', '王品牛排')],
    }));

    expect(plans.map((plan) => plan.keywords[0])).toEqual(['西餐', '铁板烧']);
  });

  it('marks unauthorized broadened plans as backup only', () => {
    const plans = planSearchBatch(context({
      goal: goal({ broadenedTargets: [{ keyword: '快餐' }], allowBroaden: false }),
      attempts: [attempt({ found: 0, accepted: 0 })],
    }));

    expect(plans).toHaveLength(1);
    expect(plans[0].allowedForPrimary).toBe(false);
  });

  it('skips keywords that hit an exclusion', () => {
    const plans = planSearchBatch(context({
      goal: goal({ primaryKeywords: ['牛排', '川菜'], exclusions: ['川菜'] }),
    }));

    expect(plans.map((plan) => plan.keywords[0])).toEqual(['牛排']);
  });
});

describe('policy 决策', () => {
  it('finishes once enough distinct brands passed and nothing is left to try', () => {
    const decision = decideNextAction(context({
      attempts: [attempt()],
      candidates: [
        candidate('r1', '王品牛排'),
        candidate('r2', '豪客来'),
        candidate('r3', '牛排家'),
      ],
    }));

    expect(decision.kind).toBe('finish');
    if (decision.kind === 'finish') {
      expect(decision.reason).toBe('ENOUGH_PRIMARY');
      expect(decision.selectedIds).toEqual(['r1', 'r2', 'r3']);
    }
  });

  it('keeps expanding for variety while related keywords remain', () => {
    const decision = decideNextAction(context({
      goal: goal({ relatedTargets: [{ keyword: '西餐' }] }),
      attempts: [attempt()],
      candidates: [
        candidate('r1', '王品牛排'),
        candidate('r2', '豪客来'),
        candidate('r3', '牛排家'),
      ],
    }));

    expect(decision.kind).toBe('search');
  });

  it('finishes on an exhausted search budget when there is something to show', () => {
    const decision = decideNextAction(context({
      goal: goal({ relatedTargets: [{ keyword: '西餐' }] }),
      attempts: [attempt(), attempt(), attempt(), attempt()],
      candidates: [candidate('r1', '王品牛排')],
    }));

    expect(decision.kind).toBe('finish');
    if (decision.kind === 'finish') {
      expect(decision.reason).toBe('SEARCH_BUDGET_EXHAUSTED');
    }
  });

  it('asks on an exhausted search budget when nothing passed admission', () => {
    const decision = decideNextAction(context({
      attempts: [attempt(), attempt(), attempt(), attempt()],
    }));

    expect(decision.kind).toBe('ask');
  });

  it('asks for authorization instead of searching when verified backups are blocked', () => {
    const decision = decideNextAction(context({
      goal: goal({ broadenedTargets: [{ keyword: '快餐' }], allowBroaden: false }),
      attempts: [attempt({ searchIntent: 'broadened', allowedForPrimary: false, keywords: ['快餐'] })],
      candidates: [candidate('r1', '老乡鸡')],
    }));

    expect(decision.kind).toBe('ask');
  });

  it('requests a replan when every deterministic keyword is exhausted', () => {
    const decision = decideNextAction(context({
      attempts: [attempt({ found: 0, accepted: 0 })],
    }));

    expect(decision.kind).toBe('replan');
    if (decision.kind === 'replan') {
      expect(decision.exhausted.triedKeywords).toEqual(['牛排']);
    }
  });

  it('falls back to a question after the replan chance is used', () => {
    const decision = decideNextAction(
      context({ attempts: [attempt({ found: 0, accepted: 0 })] }),
      { replanUsed: true }
    );

    expect(decision.kind).toBe('ask');
  });

  // 开放推荐要铺开具体的探索方向。只搜一个通用词等于把品类分布交给
  // 高德排序，转盘多样性全靠运气。
  it('fans out concrete exploration targets for an open-recommendation goal', () => {
    const decision = decideNextAction(context({
      goal: goal({
        rawQuery: '你看着办',
        primaryKeywords: [],
        broadenedTargets: [{ keyword: '日料' }, { keyword: '火锅' }, { keyword: '烧烤' }],
        allowBroaden: true,
      }),
    }));

    expect(decision.kind).toBe('search');
    if (decision.kind === 'search') {
      expect(decision.plans.map((plan) => plan.keywords[0])).toEqual(['日料', '火锅', '烧烤']);
      // 开放授权覆盖 fallback 意图，这些结果可以直接进主推荐
      expect(decision.plans.every((plan) => plan.searchIntent === 'fallback')).toBe(true);
      expect(decision.plans.every((plan) => plan.allowedForPrimary)).toBe(true);
    }
  });

  it('falls back to a generic search when there is no exploration target', () => {
    const decision = decideNextAction(context({
      goal: goal({
        rawQuery: '你看着办',
        primaryKeywords: [],
        broadenedTargets: [],
        allowBroaden: true,
      }),
    }));

    expect(decision.kind).toBe('search');
    if (decision.kind === 'search') {
      expect(decision.plans.map((plan) => plan.keywords[0])).toEqual(['餐厅']);
      expect(decision.plans[0].allowedForPrimary).toBe(true);
    }
  });
});

describe('policy 合格候选排序', () => {
  it('按确定性推荐效用排序，不使用模型置信度作为质量分', () => {
    const far = candidate('far', '远店');
    far.score = 8;
    far.verification.confidence = 1;
    const near = candidate('near', '近店');
    near.score = 30;
    near.verification.confidence = 0.5;

    const ranked = primaryCandidates(context({
      attempts: [attempt()],
      candidates: [far, near],
    }));

    expect(ranked.map((item) => item.restaurant.id)).toEqual(['near', 'far']);
  });

  it('只在同一 Provider 的候选内归一化评分', () => {
    const lowerRated = candidate('low-rating', '低评分店');
    lowerRated.score = 20;
    lowerRated.restaurant.rating = 3.8;
    const higherRated = candidate('high-rating', '高评分店');
    higherRated.score = 20;
    higherRated.restaurant.rating = 4.8;

    const sameProvider = primaryCandidates(context({
      attempts: [attempt()],
      candidates: [lowerRated, higherRated],
    }));
    expect(sameProvider.map((item) => item.restaurant.id))
      .toEqual(['high-rating', 'low-rating']);

    higherRated.restaurant.source = 'osm';
    const differentProviders = primaryCandidates(context({
      attempts: [attempt()],
      candidates: [lowerRated, higherRated],
    }));
    expect(differentProviders.map((item) => item.restaurant.id))
      .toEqual(['low-rating', 'high-rating']);
  });

  it('保留同品牌不同门店，并把品牌多样性放在重复品牌之前', () => {
    const firstBranch = candidate('brand-1', '同品牌（人民广场店）');
    firstBranch.score = 30;
    const secondBranch = candidate('brand-2', '同品牌（陆家嘴店）');
    secondBranch.score = 28;
    const otherBrand = candidate('other', '另一品牌');
    otherBrand.score = 10;

    const ranked = primaryCandidates(context({
      attempts: [attempt()],
      candidates: [firstBranch, secondBranch, otherBrand],
    }));

    expect(ranked.map((item) => item.restaurant.id))
      .toEqual(['brand-1', 'other', 'brand-2']);
  });
});

describe('policy 目标文案', () => {
  // requestedItems / primaryKeywords / acceptableCategories 本来就会指向同一个
  // 东西，直接拼接会得到「柠檬茶、柠檬茶」。
  it('collapses the same term repeated across goal fields', () => {
    expect(primaryTargetLabel(goal({
      rawQuery: '我想喝柠檬茶',
      requestedItems: [{ name: '柠檬茶', required: true, aliases: [] }],
      primaryKeywords: ['柠檬茶'],
    }))).toBe('柠檬茶');
  });

  // 去重键走 canonicalizePoiTerm：词表认为同一的才合并。
  it('collapses taxonomy synonyms but keeps the wording the user used', () => {
    expect(primaryTargetLabel(goal({
      requestedItems: [{ name: '柠檬茶', required: true, aliases: [] }],
      primaryKeywords: ['果茶'],
      acceptableCategories: [{ name: '奶茶', confidence: 0.9 }],
    }))).toBe('柠檬茶');
  });

  // 刻意不做「柠檬茶≈柠檬水」这种近义合并——那是语义推断，不属于规则库。
  it('keeps terms the taxonomy treats as distinct', () => {
    expect(primaryTargetLabel(goal({
      requestedItems: [{ name: '柠檬茶', required: true, aliases: [] }],
      primaryKeywords: ['柠檬水'],
    }))).toBe('柠檬茶、柠檬水');
  });

  it('caps the label at three terms', () => {
    expect(primaryTargetLabel(goal({
      primaryKeywords: ['火锅', '日料', '西餐', '烧烤'],
    }))).toBe('火锅、日料、西餐');
  });
});
