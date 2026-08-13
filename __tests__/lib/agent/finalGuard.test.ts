import { applyFinalGuard } from '@/lib/agent/finalGuard';
import { finalizeRecommendations } from '@/lib/agent/resultAssembler';
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

describe('FinalGuard random recommendations', () => {
  it('shuffles eligible primary candidates for open fallback recommendations', () => {
    const first = applyFinalGuard(context()).primaryCandidates.map((item) => item.restaurant.id);
    const second = applyFinalGuard(context()).primaryCandidates.map((item) => item.restaurant.id);

    expect(first).toEqual(second);
    expect(first).toEqual(['r2', 'r3', 'r1', 'r4']);
    expect(first).not.toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  // 开放推荐并发搜多个方向时，候选多的方向不能吃满转盘。
  it('interleaves open recommendations across search directions', () => {
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
    }));

    const sources = guarded.primaryCandidates.map((item) => item.sourceAttempt);
    // 第二个方向必须在第二位就出场，而不是被三家火锅挤到最后。
    expect(sources.slice(0, 2).sort()).toEqual([1, 2]);
  });

  it('keeps score ordering for explicit primary targets', () => {
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
    const final = finalizeRecommendations(context({
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
    }));

    expect(final.restaurants).toHaveLength(1);
    expect(final.restaurants[0].recommendationWarnings?.join('')).toContain(
      '授权来源：用户授权放宽到相邻品类。'
    );
  });
});

/**
 * POI 事实字段里没有菜单，所以「这家有柠檬茶」这种菜品级断言除非店名写着，
 * 否则永远验证不出来。严格准入在这类目标上构造性不可达——线上表现是广东出
 * 结果、成都武汉全军覆没。这里锁的就是那条补位路径。
 */
describe('FinalGuard category-compatible backfill', () => {
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

  it('promotes category-compatible candidates when strict admission finds nothing', () => {
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [
        unverifiedCandidate('c1', '喜茶', 100),
        unverifiedCandidate('c2', '蜜雪冰城', 90),
        unverifiedCandidate('c3', 'CoCo都可', 80),
      ],
    }));

    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['c1', 'c2', 'c3']);
    expect(guarded.unmetConstraints.join('')).toContain('按品类匹配推荐');
  });

  it('prefers strictly verified candidates and only backfills the shortfall', () => {
    const verified = candidate('v1', '柠季·手打柠檬茶', 50);
    verified.verification.itemMatches = [
      { requestedItem: '柠檬茶', matchedBy: 'name', confidence: 0.95 },
    ];

    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 2,
      candidates: [verified, unverifiedCandidate('c1', '喜茶', 100)],
    }));

    // 严格通过的排在前面，即便分数更低。
    expect(guarded.primaryCandidates.map((item) => item.restaurant.id)).toEqual(['v1', 'c1']);
  });

  it('does not promote candidates without any category match', () => {
    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [unverifiedCandidate('c1', '某川菜馆', 100, [])],
    }));

    expect(guarded.primaryCandidates).toHaveLength(0);
  });

  it('never promotes candidates carrying hard-constraint failures', () => {
    const blocked = unverifiedCandidate('c1', '喜茶', 100);
    blocked.verification.hardFailures = [
      { constraint: '距离', message: '超出步行距离', severity: 'error' },
    ];

    const guarded = applyFinalGuard(context({
      goal: lemonTeaGoal,
      attempts: [exactAttempt],
      targetCount: 3,
      candidates: [blocked],
    }));

    expect(guarded.primaryCandidates).toHaveLength(0);
  });

  it('never promotes candidates from an unauthorized broadened search', () => {
    const guarded = applyFinalGuard(context({
      goal: { ...lemonTeaGoal, allowBroaden: false, authorizations: [] },
      attempts: [fallbackAttempt({
        searchIntent: 'broadened',
        keywords: ['冷饮'],
        allowedForPrimary: false,
      })],
      targetCount: 3,
      candidates: [unverifiedCandidate('c1', '喜茶', 100)],
    }));

    expect(guarded.primaryCandidates).toHaveLength(0);
  });
});
