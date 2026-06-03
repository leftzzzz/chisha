import { applyFinalGuard } from '@/lib/agent/finalGuard';
import type { AgentContext, RestaurantCandidate, SearchAttempt, UserGoal } from '@/lib/agent/types';
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
});
