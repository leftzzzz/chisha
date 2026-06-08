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

function candidate(id: string, name: string, score: number): RestaurantCandidate {
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
    sourceAttempt: 1,
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
