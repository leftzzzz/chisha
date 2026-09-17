import { applyFinalGuard } from '@/lib/agent/finalGuard';
import { assembleRecommendations } from '@/lib/agent/resultAssembler';
import type { AgentContext, RestaurantCandidate, SearchAttempt, UserGoal } from '@/lib/agent/types';
import { deriveLocationSignature, withUpdatedGoalVersion } from '@/lib/agent/goalVersion';
import type { Location, Restaurant } from '@/types';

const location: Location = { lat: 31.2304, lng: 121.4737 };

function restaurant(id: string, name: string, cuisineType = '餐饮', distance = 500): Restaurant {
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

function candidate(
  id: string,
  name: string,
  score: number,
  sourceAttempt = 1
): RestaurantCandidate {
  return {
    restaurant: restaurant(id, name),
    score,
    matched: [],
    warnings: [],
    verification: {
      restaurantId: id,
      status: 'passed',
      primaryEligible: true,
      hardFailures: [],
      itemMatches: [],
      categoryMatches: [],
      warnings: [],
      confidence: 0.9,
    },
    sourceAttempt,
  };
}

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '没有具体想吃的，你来选',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: true,
    ...overrides,
  };
}

function fallbackAttempt(overrides: Partial<SearchAttempt> = {}): SearchAttempt {
  return {
    keywords: ['餐厅'],
    radius: 1800,
    searchIntent: 'fallback',
    allowedForPrimary: true,
    reason: 'fallback',
    found: 4,
    accepted: 4,
    ...overrides,
  };
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    query: '没有具体想吃的，你来选',
    location,
    sessionId: 'session-b',
    goal: goal(),
    attempts: [fallbackAttempt()],
    candidates: [
      candidate('r1', '高分店', 100),
      candidate('r2', '中分店', 90),
      candidate('r3', '低分店', 80),
      candidate('r4', '远店', 70),
    ],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: 4,
    targetCount: 4,
    ...overrides,
  };
}

describe('FinalGuard publication boundary', () => {
  it('preserves the proposed primary order', () => {
    const guarded = applyFinalGuard(context(), {
      selectedIds: ['r3', 'r1', 'r4', 'r2'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.9,
    });

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id))
      .toEqual(['r3', 'r1', 'r4', 'r2']);
    expect(guarded.verdict).toBe('accepted');
  });

  it('does not fill primary recommendations from unselected backup ids', () => {
    const guarded = applyFinalGuard(context({
      attempts: [
        fallbackAttempt({ keywords: ['火锅'] }),
        fallbackAttempt({ keywords: ['甜品'] }),
      ],
      candidates: [
        candidate('h1', '火锅一', 100, 1),
        candidate('h2', '火锅二', 99, 1),
        candidate('h3', '火锅三', 98, 1),
        candidate('d1', '甜品一', 60, 2),
      ],
    }), {
      selectedIds: ['h1'],
      candidateIds: ['d1', 'h2', 'h3'],
      explanation: 'proposal',
      confidence: 0.9,
    });

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['h1']);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id))
      .toEqual(['d1', 'h2', 'h3']);
  });

  it('does not promote candidateIds when selectedIds is omitted', () => {
    const guarded = applyFinalGuard(context(), {
      candidateIds: ['r2', 'r1'],
      explanation: 'proposal',
      confidence: 0.9,
    });

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id))
      .toEqual(['r2', 'r1']);
  });

  it('marks selected candidates above targetCount as filtered backups', () => {
    const guarded = applyFinalGuard(context({ targetCount: 2 }), {
      selectedIds: ['r3', 'r1', 'r4'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.9,
    });

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['r3', 'r1']);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['r4']);
    expect(guarded.verdict).toBe('filtered');
    expect(guarded.violations).toContainEqual(expect.objectContaining({
      code: 'PRIMARY_LIMIT_EXCEEDED',
      candidateId: 'r4',
      disposition: 'backup',
    }));
  });

  it('keeps Runtime candidate order when the current workflow omits ids', () => {
    const guarded = applyFinalGuard(context({
      goal: goal({
        rawQuery: '想吃牛排',
        requestedItems: [],
        acceptableCategories: [{ name: '西餐', confidence: 0.9 }],
        primaryKeywords: ['牛排'],
        softPreferences: [],
        allowBroaden: false,
      }),
      attempts: [fallbackAttempt({ searchIntent: 'exact', keywords: ['牛排'] })],
    }));

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id))
      .toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('dedupes the same physical restaurant before filling primary recommendations', () => {
    const guarded = applyFinalGuard(context({
      goal: goal({
        rawQuery: '想吃牛排',
        requestedItems: [],
        acceptableCategories: [{ name: '西餐', confidence: 0.9 }],
        primaryKeywords: ['牛排'],
        softPreferences: [],
        allowBroaden: false,
      }),
      attempts: [fallbackAttempt({ searchIntent: 'exact', keywords: ['牛排'] })],
      candidates: [
        candidate('amap_dup', '同一家店', 120),
        candidate('osm_dup', '同一家店', 110),
        candidate('unique', '另一家店', 100),
      ],
      targetCount: 2,
    }));

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id))
      .toEqual(['amap_dup', 'unique']);
  });

  it('rejects primary candidates verified against an older goal version', () => {
    const versionedGoal = withUpdatedGoalVersion(goal({
      rawQuery: '想吃牛排',
      primaryKeywords: ['牛排'],
      allowBroaden: false,
    }));
    const freshCandidate: RestaurantCandidate = {
      ...candidate('fresh', '当前版本候选', 100),
      goalId: versionedGoal.goalId,
      verifiedAgainstGoalVersion: versionedGoal.goalVersion,
      verifiedAgainstGoalSignature: versionedGoal.goalSignature,
      locationSignature: deriveLocationSignature(location),
    };
    const staleCandidate: RestaurantCandidate = {
      ...candidate('stale', '旧版本候选', 120),
      goalId: versionedGoal.goalId,
      verifiedAgainstGoalVersion: (versionedGoal.goalVersion ?? 1) - 1,
      verifiedAgainstGoalSignature: versionedGoal.goalSignature,
      locationSignature: deriveLocationSignature(location),
    };

    const guarded = applyFinalGuard(context({
      goal: versionedGoal,
      attempts: [fallbackAttempt({ searchIntent: 'exact', keywords: ['牛排'] })],
      candidates: [staleCandidate, freshCandidate],
    }));

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['fresh']);
  });

  it('does not treat distance-only authorization as category or fallback primary authorization', () => {
    const guarded = applyFinalGuard(context({
      goal: goal({
        allowBroaden: true,
        authorizations: [{
          id: 'auth_distance',
          kind: 'distance_expansion',
          createdAt: 1,
          reason: '用户只授权扩大距离。',
          constraints: { maxMeters: 5000 },
        }],
      }),
      attempts: [fallbackAttempt({
        searchIntent: 'fallback',
        allowedForPrimary: true,
      })],
    }));

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id))
      .toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(guarded.unmetConstraints.join('')).toContain('授权 scope');
  });

  it('keeps backup-only authorization out of primary recommendations', () => {
    const guarded = applyFinalGuard(context({
      goal: goal({
        allowBroaden: true,
        authorizations: [{
          id: 'auth_backup',
          kind: 'unverified_backup_only',
          createdAt: 1,
          reason: '用户只想先看看候补。',
        }],
      }),
      attempts: [fallbackAttempt({
        searchIntent: 'fallback',
        allowedForPrimary: true,
      })],
    }));

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toHaveLength(4);
  });

  it('includes scoped authorization reasons in recommendation warnings', () => {
    const assemblyContext = context({
      targetCount: 1,
      goal: goal({
        requestedItems: [{ name: '炸鸡', required: true, aliases: [] }],
        primaryKeywords: ['炸鸡'],
        allowBroaden: true,
        authorizations: [{
          id: 'auth_category',
          kind: 'category_broaden',
          createdAt: 1,
          reason: '用户授权放宽到相邻品类。',
          constraints: { allowedSearchIntents: ['broadened'] },
        }],
      }),
      attempts: [fallbackAttempt({
        searchIntent: 'broadened',
        keywords: ['小吃'],
        allowedForPrimary: true,
      })],
    });
    const proposal = {
      selectedIds: ['r1'],
      candidateIds: ['r2', 'r3', 'r4'],
      explanation: '已根据授权返回结果。',
      confidence: 0.9,
    };
    const guarded = applyFinalGuard(assemblyContext, proposal);
    const final = assembleRecommendations(assemblyContext, guarded, proposal);

    expect(final.restaurants).toHaveLength(1);
    expect(final.restaurants[0].recommendationWarnings?.join('')).toContain(
      '授权来源：用户授权放宽到相邻品类。'
    );
  });
});

describe('FinalGuard evidence monotonicity', () => {
  function unverifiedCandidate(
    id: string,
    name: string,
    score: number,
    categoryMatches: string[] = ['冷饮店']
  ): RestaurantCandidate {
    const base = candidate(id, name, score);
    return {
      ...base,
      verification: {
        ...base.verification,
        status: 'unverified',
        primaryEligible: false,
        categoryMatches,
      },
    };
  }

  const lemonTeaGoal = goal({
    rawQuery: '我想喝柠檬茶',
    requestedItems: [{ name: '柠檬茶', required: true, aliases: [] }],
    primaryKeywords: ['柠檬茶'],
  });

  const exactAttempt = fallbackAttempt({
    searchIntent: 'exact',
    keywords: ['柠檬茶'],
    allowedForPrimary: true,
  });

  it('rejects unrelated matches for an ungrouped required item', () => {
    const selected = candidate('ungrouped', '测试店', 100);
    selected.verification.itemMatches = [{
      requestedItem: '奶茶', matchedBy: 'llm_semantic', confidence: 1,
    }];
    const before = JSON.stringify(selected);
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      candidates: [selected],
    }));

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toEqual([selected]);
    expect(guarded.violations[0].code).toBe('REQUIRED_ITEM_UNSUPPORTED');
    expect(JSON.stringify(selected)).toBe(before);
  });

  it.each([
    { matches: ['柠檬茶'], admitted: false },
    { matches: ['柠檬茶', '柠檬茶'], admitted: false },
    { matches: ['柠檬茶', '蛋糕'], admitted: true },
  ])('checks every ungrouped requirement for $matches', ({ matches, admitted }) => {
    const selected = candidate('ungrouped', '测试店', 100);
    selected.verification.itemMatches = matches.map((requestedItem) => ({
      requestedItem, matchedBy: 'llm_semantic', confidence: 1,
    }));
    const guarded = applyFinalGuard(context({
      goal: goal({ requestedItems: [
        { name: '柠檬茶', required: true, aliases: [] },
        { name: '蛋糕', required: true, aliases: [] },
        { name: '咖啡', required: false, aliases: [] },
      ] }),
      attempts: [exactAttempt], candidates: [selected],
    }));
    expect(guarded.primaryCandidates).toEqual(admitted ? [selected] : []);
    expect(guarded.backupCandidates).toEqual(admitted ? [] : [selected]);
  });

  it('does not turn grouped any-of items into ungrouped all-of requirements', () => {
    const selected = candidate('grouped', '测试店', 100);
    selected.verification.itemMatches = [{
      requestedItem: '柠檬茶', matchedBy: 'llm_semantic', confidence: 1,
    }];
    selected.verification.targetEvidence = [{
      target: '柠檬茶', kind: 'item',
      references: [{ restaurantId: 'grouped', field: 'name', value: '测试店' }],
    }];
    const guarded = applyFinalGuard(context({
      goal: goal({
        requestedItems: ['柠檬茶', '奶茶'].map((name) => ({ name, required: true, aliases: [] })),
        alternativeGroups: [{ mode: 'any_of', items: ['柠檬茶', '奶茶'] }],
      }),
      attempts: [exactAttempt], candidates: [selected],
    }));
    expect(guarded.primaryCandidates).toEqual([selected]);
  });

  it.each([
    { mode: 'all_of' as const, matches: ['目标甲'], admitted: false },
    { mode: 'all_of' as const, matches: ['目标甲', '目标甲'], admitted: false },
    { mode: 'all_of' as const, matches: ['目标甲', '无关目标'], admitted: false },
    { mode: 'all_of' as const, matches: ['目标乙', '目标甲'], admitted: true },
    { mode: 'any_of' as const, matches: [], admitted: false },
    { mode: 'any_of' as const, matches: ['无关目标'], admitted: false },
    { mode: 'any_of' as const, matches: ['目标乙'], admitted: true },
  ])('checks $mode coverage for $matches (admitted=$admitted)', ({ mode, matches, admitted }) => {
    const selected = candidate('group', '测试店', 100);
    selected.verification.itemMatches = matches.map((requestedItem) => ({
      requestedItem, matchedBy: 'llm_semantic', confidence: 0.9,
    }));
    selected.verification.targetEvidence = matches.map((target) => ({
      target, kind: 'item',
      references: [{ restaurantId: 'group', field: 'name', value: selected.restaurant.name }],
    }));
    const guarded = applyFinalGuard(context({
      goal: goal({ alternativeGroups: [{ mode, items: ['目标甲', '目标乙'] }] }),
      attempts: [exactAttempt],
      candidates: [selected],
    }));

    expect(guarded.primaryCandidates).toEqual(admitted ? [selected] : []);
    expect(guarded.backupCandidates).toEqual(admitted ? [] : [selected]);
    expect(guarded.violations).toEqual(admitted ? [] : [expect.objectContaining({
      code: 'REQUIRED_ITEM_UNSUPPORTED', disposition: 'backup',
    })]);
    expect(selected.verification.status).toBe('passed');
  });

  it('checks category groups without treating category support as item support', () => {
    const selected = candidate('group', '测试店', 100);
    selected.verification.categoryMatches = ['品类甲'];
    selected.verification.targetEvidence = [{
      target: '品类甲', kind: 'category',
      references: [{ restaurantId: 'group', field: 'cuisineType', value: '餐饮' }],
    }];
    const groupedContext = context({
      goal: goal({ alternativeGroups: [{ mode: 'any_of', items: ['品类甲', '品类乙'] }] }),
      attempts: [exactAttempt],
      candidates: [selected],
    });
    expect(applyFinalGuard(groupedContext).primaryCandidates).toEqual([selected]);

    groupedContext.goal.alternativeGroups = [{ mode: 'all_of', items: ['品类甲', '菜品甲'] }];
    expect(applyFinalGuard(groupedContext).primaryCandidates).toEqual([]);

  });

  it('rejects category-only support for an explicitly requested dish despite unrelated item matches', () => {
    const selected = candidate('dish', '测试店', 100);
    selected.verification.categoryMatches = ['菜品甲'];
    selected.verification.itemMatches = [{
      requestedItem: '无关菜品', matchedBy: 'llm_semantic', confidence: 0.9,
    }];
    const guarded = applyFinalGuard(context({
      goal: goal({
        requestedItems: [{ name: '菜品甲', required: true, aliases: [] }],
        alternativeGroups: [{ mode: 'all_of', items: ['菜品甲'] }],
      }),
      attempts: [exactAttempt],
      candidates: [selected],
    }));

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toEqual([selected]);
    expect(guarded.violations).toEqual([expect.objectContaining({
      code: 'REQUIRED_ITEM_UNSUPPORTED', disposition: 'backup',
    })]);
  });

  it.each(['all_of', 'any_of'] as const)('rejects an empty %s group', (mode) => {
    const guarded = applyFinalGuard(context({
      goal: goal({ alternativeGroups: [{ mode, items: [] }] }),
      attempts: [exactAttempt],
    }));
    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.violations.every((violation) =>
      violation.code === 'REQUIRED_ITEM_UNSUPPORTED'
    )).toBe(true);
  });

  it.each(['name', 'llm_semantic'] as const)(
    'does not trust a %s match without a fact reference', (matchedBy) => {
      const selected = candidate('group', '目标甲专门店', 100);
      selected.verification.itemMatches = [{
        requestedItem: '目标甲', matchedBy, confidence: 1,
      }];
      const guarded = applyFinalGuard(context({
        goal: goal({ alternativeGroups: [{ mode: 'all_of', items: ['目标甲'] }] }),
        attempts: [exactAttempt],
        candidates: [selected],
      }));
      expect(guarded.primaryCandidates).toEqual([]);
      expect(guarded.backupCandidates).toEqual([selected]);
      expect(guarded.violations[0].code).toBe('REQUIRED_ITEM_UNSUPPORTED');
    }
  );

  it('does not let broaden authorization bypass an uncovered group', () => {
    const guarded = applyFinalGuard(context({
      goal: goal({ alternativeGroups: [{ mode: 'all_of', items: ['目标甲', '目标乙'] }] }),
    }));
    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toHaveLength(4);
    expect(guarded.violations[0].code).toBe('REQUIRED_ITEM_UNSUPPORTED');
  });

  it('requires every group and loses admission when matching evidence is deleted', () => {
    const selected = candidate('group', '测试店', 100);
    selected.verification.itemMatches = ['目标甲', '目标乙'].map((requestedItem) => ({
      requestedItem, matchedBy: 'llm_semantic', confidence: 0.9,
    }));
    selected.verification.targetEvidence = ['目标甲', '目标乙'].map((target) => ({
      target, kind: 'item',
      references: [{ restaurantId: 'group', field: 'name', value: selected.restaurant.name }],
    }));
    const groupedContext = context({
      goal: goal({ alternativeGroups: [
        { mode: 'all_of', items: ['目标甲'] },
        { mode: 'any_of', items: ['目标乙', '目标丙'] },
      ] }),
      attempts: [exactAttempt],
      candidates: [selected],
    });
    expect(applyFinalGuard(groupedContext).primaryCandidates).toEqual([selected]);
    selected.verification.itemMatches.pop();
    expect(applyFinalGuard(groupedContext).primaryCandidates).toEqual([]);
  });

  it.each([
    'missing', 'empty', 'foreign', 'changed', 'invalid-field', 'invalid-value', 'wrong-target', 'undeclared', 'category-as-dish',
  ])('rejects %s evidence while preserving the model verdict', (mutation) => {
    const selected = candidate('group', '目标甲专门店', 100);
    selected.verification.itemMatches = [{
      requestedItem: '目标甲', matchedBy: 'llm_semantic', confidence: 0.9,
    }];
    selected.verification.targetEvidence = [{
      target: '目标甲', kind: 'item',
      references: [{ restaurantId: 'group', field: 'name', value: selected.restaurant.name }],
    }];
    const groupedContext = context({
      goal: goal({
        requestedItems: [{ name: '目标甲', required: true, aliases: [] }],
        alternativeGroups: [{ mode: 'all_of', items: ['目标甲'] }],
      }),
      attempts: [exactAttempt], candidates: [selected],
    });
    expect(applyFinalGuard(groupedContext).primaryCandidates).toEqual([selected]);
    const evidence = selected.verification.targetEvidence[0];
    if (mutation === 'missing') delete selected.verification.targetEvidence;
    if (mutation === 'empty') evidence.references = [];
    if (mutation === 'foreign') evidence.references[0].restaurantId = 'other';
    if (mutation === 'changed') selected.restaurant.name = '新店名';
    if (mutation === 'invalid-field') Object.assign(evidence.references[0], { field: 'address' });
    if (mutation === 'invalid-value') Object.assign(evidence.references[0], { value: null });
    if (mutation === 'wrong-target') evidence.target = '目标乙';
    if (mutation === 'undeclared') selected.verification.itemMatches = [];
    if (mutation === 'category-as-dish') {
      evidence.kind = 'category';
      selected.verification.categoryMatches = ['目标甲'];
    }
    const before = JSON.stringify(selected);
    const guarded = applyFinalGuard(groupedContext);
    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toEqual([selected]);
    expect(guarded.violations[0].code).toBe('REQUIRED_ITEM_UNSUPPORTED');
    expect(JSON.stringify(selected)).toBe(before);
  });

  it('keeps category-compatible unverified candidates in backup', () => {
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [
        unverifiedCandidate('c1', '喜茶', 100),
        unverifiedCandidate('c2', '蜜雪冰城', 90),
        unverifiedCandidate('c3', 'CoCo都可', 80),
      ],
    }), {
      selectedIds: ['c1', 'c2', 'c3'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id))
      .toEqual(['c1', 'c2', 'c3']);
    expect(guarded.verdict).toBe('rejected');
    expect(guarded.violations.map((item) => item.code))
      .toEqual(['UNVERIFIED_EVIDENCE', 'UNVERIFIED_EVIDENCE', 'UNVERIFIED_EVIDENCE']);
  });

  it('keeps the unverified backup warning ahead of ordinary warnings', () => {
    const unverified = unverifiedCandidate('c1', '喜茶', 100);
    unverified.verification.warnings = ['w1', 'w2', 'w3', 'w4', 'w5'];
    const assemblyContext = context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 1,
      candidates: [unverified],
    });
    const proposal = {
      selectedIds: ['c1'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    };
    const guarded = applyFinalGuard(assemblyContext, proposal);
    const final = assembleRecommendations(assemblyContext, guarded, proposal);

    expect(final.candidates[0].recommendationWarnings?.[0])
      .toContain('未验证为主推荐');
  });

  it('does not replace a rejected selection with a valid unselected candidate', () => {
    const verified = candidate('v1', '柠季·手打柠檬茶', 100);
    verified.verification.itemMatches = [{
      requestedItem: '柠檬茶',
      matchedBy: 'name',
      confidence: 0.95,
    }];
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 1,
      candidates: [unverifiedCandidate('c1', '喜茶', 90), verified],
    }), {
      selectedIds: ['c1'],
      candidateIds: ['v1'],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['c1', 'v1']);
  });

  it('preserves the relative order of selected candidates that survive filtering', () => {
    const rejected = unverifiedCandidate('c1', '喜茶', 100);
    const first = candidate('v2', '第二个被提议但先展示', 20);
    const second = candidate('v1', '第一个高分候选但后展示', 200);
    first.verification.itemMatches = [{
      requestedItem: '柠檬茶', matchedBy: 'name', confidence: 0.9,
    }];
    second.verification.itemMatches = [{
      requestedItem: '柠檬茶', matchedBy: 'name', confidence: 0.9,
    }];
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [second, rejected, first],
    }), {
      selectedIds: ['v2', 'c1', 'v1'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['v2', 'v1']);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['c1']);
  });

  it('removes candidates carrying hard-constraint failures from both partitions', () => {
    const blocked = unverifiedCandidate('c1', '喜茶', 100);
    blocked.verification.hardFailures = [
      { constraint: '距离', message: '超出步行距离', severity: 'error' },
    ];

    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [blocked],
    }), {
      selectedIds: ['c1'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toHaveLength(0);
    expect(guarded.backupCandidates).toHaveLength(0);
    expect(guarded.violations[0]).toEqual(expect.objectContaining({
      code: 'HARD_CONSTRAINT_FAILED',
      disposition: 'removed',
    }));
  });

  it('rechecks deterministic distance failures at publication time', () => {
    const outside = candidate('far', '范围外餐厅', 100);
    outside.restaurant.distance = 2500;

    const guarded = applyFinalGuard(context({
      goal: goal({
        hardConstraints: [{
          kind: 'distance',
          label: '2 公里内',
          value: 2000,
          maxMeters: 2000,
          strict: true,
        }],
      }),
      candidates: [outside],
    }), {
      selectedIds: ['far'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates).toEqual([]);
    expect(guarded.violations[0]).toEqual(expect.objectContaining({
      code: 'HARD_CONSTRAINT_FAILED',
      disposition: 'removed',
    }));
  });

  it('downgrades a strict deterministic constraint with missing evidence to backup', () => {
    const unknownDistance = candidate('unknown', '距离未知餐厅', 100);
    unknownDistance.restaurant.distance = undefined;

    const guarded = applyFinalGuard(context({
      goal: goal({
        hardConstraints: [{
          kind: 'distance',
          label: '2 公里内',
          value: 2000,
          maxMeters: 2000,
          strict: true,
        }],
      }),
      candidates: [unknownDistance],
    }), {
      selectedIds: ['unknown'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toEqual([]);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['unknown']);
    expect(guarded.violations[0]).toEqual(expect.objectContaining({
      code: 'UNVERIFIED_EVIDENCE',
      disposition: 'backup',
    }));
  });

  it('keeps safe candidates from an unauthorized broadened search in backup', () => {
    const broadened = candidate('c1', '喜茶', 100);
    broadened.verification.primaryEligible = false;
    broadened.verification.itemMatches = [{
      requestedItem: '柠檬茶', matchedBy: 'name', confidence: 0.9,
    }];
    const guarded = applyFinalGuard(context({
      goal: { ...lemonTeaGoal, allowBroaden: false, authorizations: [] },
      attempts: [fallbackAttempt({
        searchIntent: 'broadened',
        keywords: ['冷饮'],
        allowedForPrimary: false,
      })],
      targetCount: 3,
      candidates: [broadened],
    }), {
      selectedIds: ['c1'],
      candidateIds: [],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates).toHaveLength(0);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['c1']);
    expect(guarded.violations[0].code).toBe('UNAUTHORIZED_PRIMARY_SCOPE');
  });

  it('reports unobserved and duplicate ids without selecting replacements', () => {
    const guarded = applyFinalGuard(context(), {
      selectedIds: ['r2', 'missing', 'r2'],
      candidateIds: ['r1'],
      explanation: 'proposal',
      confidence: 0.7,
    });

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['r2']);
    expect(guarded.backupCandidates.map((item) => item.restaurant.id)).toEqual(['r1']);
    expect(guarded.violations.map((item) => item.code)).toEqual(expect.arrayContaining([
      'UNOBSERVED_CANDIDATE_ID',
      'DUPLICATE_CANDIDATE',
    ]));
  });
});
