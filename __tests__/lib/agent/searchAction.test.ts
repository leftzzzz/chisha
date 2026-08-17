import {
  authorizationCovers,
  primaryAuthorizationRef,
} from '@/lib/agent/authorization';
import { buildSearchPlan, type PolicyContext } from '@/lib/agent/orchestrator/policy';
import { SearchActionInputSchema } from '@/lib/agent/schemas/searchAction';
import {
  createSearchAction,
  isPrimaryScopeAuthorized,
  searchRelationFromIntent,
} from '@/lib/agent/searchAction';
import type { SearchActionInput, UserGoal } from '@/lib/agent/types';

const location = { lat: 31.2304, lng: 121.4737, address: '上海市黄浦区' };

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    goalId: 'goal_1',
    rawQuery: '想吃寿司',
    requestedItems: [{ name: '寿司', required: true, aliases: [] }],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['寿司'],
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

function context(goalValue: UserGoal): PolicyContext {
  return {
    goal: goalValue,
    attempts: [],
    candidates: [],
    location,
    targetCount: 8,
    maxSearchCalls: 4,
  };
}

function actionInput(overrides: Partial<SearchActionInput> = {}): SearchActionInput {
  return {
    query: '日本料理',
    supportsGoalIds: ['goal_1'],
    relation: 'broader',
    rationale: '寿司没有结果，尝试更宽的类别。',
    ...overrides,
  };
}

describe('SearchAction Runtime 契约', () => {
  it('由 Runtime 分配 id，并从输入 schema 中移除派生授权字段', () => {
    const parsed = SearchActionInputSchema.parse({
      ...actionInput(),
      primaryScopeAuthorized: true,
    });
    const action = createSearchAction(parsed);

    expect(action.id).toMatch(/^action_/);
    expect(action).not.toHaveProperty('primaryScopeAuthorized');
  });

  it.each([
    ['exact', 'exact'],
    ['synonym', 'equivalent'],
    ['broadened', 'broader'],
    ['fallback', 'alternative'],
  ] as const)('maps legacy intent %s to relation %s', (intent, relation) => {
    expect(searchRelationFromIntent(intent)).toBe(relation);
  });

  it.each(['exact', 'equivalent'] as const)(
    'authorizes %s actions without a separate authorization',
    (relation) => {
      const action = createSearchAction(actionInput({ relation }));
      expect(isPrimaryScopeAuthorized(goal(), action)).toBe(true);
    }
  );

  it('fails closed for broader actions without an authorizationRef', () => {
    const action = createSearchAction(actionInput());

    expect(isPrimaryScopeAuthorized(goal({ allowBroaden: true }), action)).toBe(false);
  });

  it('accepts a broader action only when the referenced authorization covers goal, relation, and query', () => {
    const authorizedGoal = goal({
      authorizations: [{
        id: 'auth_broader_japanese',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '用户同意扩大到日本料理。',
        constraints: {
          allowedSearchIntents: ['broadened'],
          allowedKeywords: ['日本料理'],
        },
      }],
    });
    const action = createSearchAction(actionInput({
      authorizationRef: 'auth_broader_japanese',
    }));

    expect(authorizationCovers(authorizedGoal, action.authorizationRef, action)).toBe(true);
    expect(isPrimaryScopeAuthorized(authorizedGoal, action)).toBe(true);
    expect(primaryAuthorizationRef(authorizedGoal, 'broadened', ['日本料理']))
      .toBe('auth_broader_japanese');
  });

  it('fails closed when an authorization reference has no goal scope', () => {
    const authorizedGoal = goal({
      authorizations: [{
        id: 'auth_broader_japanese',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '用户同意扩大到日本料理。',
        constraints: { allowedKeywords: ['日本料理'] },
      }],
    });
    const action = createSearchAction(actionInput({
      supportsGoalIds: [],
      authorizationRef: 'auth_broader_japanese',
    }));

    expect(isPrimaryScopeAuthorized(authorizedGoal, action)).toBe(false);
  });

  it.each([
    ['missing reference', undefined, 'goal_1', '日本料理'],
    ['unknown reference', 'auth_unknown', 'goal_1', '日本料理'],
    ['wrong goal', 'auth_broader_japanese', 'goal_other', '日本料理'],
    ['wrong query', 'auth_broader_japanese', 'goal_1', '西餐'],
  ])('rejects a broader action with %s', (_case, authorizationRef, goalId, query) => {
    const authorizedGoal = goal({
      authorizations: [{
        id: 'auth_broader_japanese',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '用户同意扩大到日本料理。',
        constraints: { allowedKeywords: ['日本料理'] },
      }],
    });
    const action = createSearchAction(actionInput({
      query,
      supportsGoalIds: [goalId],
      authorizationRef,
    }));

    expect(isPrimaryScopeAuthorized(authorizedGoal, action)).toBe(false);
  });

  it('does not reuse a category authorization for an alternative action', () => {
    const authorizedGoal = goal({
      authorizations: [{
        id: 'auth_category',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '只允许扩大品类。',
      }],
    });
    const action = createSearchAction(actionInput({
      relation: 'alternative',
      authorizationRef: 'auth_category',
    }));

    expect(isPrimaryScopeAuthorized(authorizedGoal, action)).toBe(false);
  });

  it('derives the legacy SearchPlan flag instead of trusting the caller for exact search', () => {
    const plan = buildSearchPlan(
      context(goal()),
      '寿司',
      'exact',
      false,
      '搜索用户明确目标。'
    );

    expect(plan.allowedForPrimary).toBe(true);
  });

  it('derives the legacy SearchPlan flag from an explicit scoped authorization', () => {
    const authorizedGoal = goal({
      authorizations: [{
        id: 'auth_broader_japanese',
        kind: 'category_broaden',
        createdAt: 1,
        reason: '用户同意扩大到日本料理。',
        constraints: { allowedKeywords: ['日本料理'] },
      }],
    });
    const plan = buildSearchPlan(
      context(authorizedGoal),
      '日本料理',
      'broadened',
      false,
      '扩大到日本料理。'
    );

    expect(plan.allowedForPrimary).toBe(true);
    expect(plan.searchAction).toMatchObject({
      query: '日本料理',
      supportsGoalIds: ['goal_1'],
      relation: 'broader',
      authorizationRef: 'auth_broader_japanese',
    });
  });

  it('does not let legacy allowBroaden authorize a versioned SearchAction', () => {
    const plan = buildSearchPlan(
      context(goal({ allowBroaden: true })),
      '日本料理',
      'broadened',
      true,
      '兼容旧会话。'
    );

    expect(plan.allowedForPrimary).toBe(false);
    expect(plan.searchAction).toBeDefined();
  });

  it('keeps the old allowBroaden path only for an unversioned SearchPlan', () => {
    const plan = buildSearchPlan(
      context(goal({ goalId: undefined, allowBroaden: true })),
      '日本料理',
      'broadened',
      true,
      '兼容旧会话。'
    );

    expect(plan.allowedForPrimary).toBe(true);
    expect(plan.searchAction).toBeUndefined();
  });
});
