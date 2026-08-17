import type {
  AgentAuthorization,
  SearchAction,
  SearchIntent,
  SearchRelation,
  UserGoal,
} from './types';

export function hasStructuredAuthorizations(goal: UserGoal): boolean {
  return (goal.authorizations?.length ?? 0) > 0;
}

export function isBroadSearchIntent(searchIntent: SearchIntent): boolean {
  return searchIntent === 'broadened' || searchIntent === 'fallback';
}

export function isSearchIntentAuthorizedForPrimary(
  goal: UserGoal,
  searchIntent: SearchIntent,
  keywords: string[] = []
): boolean {
  if (!isBroadSearchIntent(searchIntent)) {
    return true;
  }

  const authorizations = goal.authorizations ?? [];
  if (authorizations.length === 0) {
    return goal.allowBroaden === true;
  }

  return authorizations.some((authorization) =>
    authorizationAllowsPrimary(authorization, searchIntent, keywords)
  );
}

export function isOpenExplorationAuthorized(goal: UserGoal): boolean {
  const authorizations = goal.authorizations ?? [];
  if (authorizations.length === 0) {
    return goal.allowBroaden === true;
  }

  return authorizations.some((authorization) =>
    authorization.kind === 'fallback_primary'
    && constraintsAllowIntent(authorization, 'fallback')
  );
}

export function primaryAuthorizationReason(
  goal: UserGoal,
  searchIntent: SearchIntent,
  keywords: string[] = []
): string | undefined {
  if (!isBroadSearchIntent(searchIntent)) {
    return undefined;
  }

  const authorizations = goal.authorizations ?? [];
  if (authorizations.length === 0) {
    return goal.allowBroaden ? '兼容旧会话的全局放宽授权。' : undefined;
  }

  return authorizations.find((authorization) =>
    authorizationAllowsPrimary(authorization, searchIntent, keywords)
  )?.reason;
}

/**
 * 找到覆盖一次搜索动作的显式授权引用。
 *
 * 只返回真正匹配 action 语义和关键词的授权，避免 Runtime 把任意授权 id
 * 当成扩大主推荐范围的通行证。
 */
export function primaryAuthorizationRef(
  goal: UserGoal,
  searchIntent: SearchIntent,
  keywords: string[] = []
): string | undefined {
  if (!isBroadSearchIntent(searchIntent)) {
    return undefined;
  }

  return (goal.authorizations ?? []).find((authorization) =>
    authorizationAllowsPrimary(authorization, searchIntent, keywords)
  )?.id;
}

/**
 * 校验 SearchAction 的显式授权是否覆盖当前目标。
 *
 * 这是 fail-closed 的新契约：缺少引用、引用不存在、目标不匹配或关系与授权
 * 类型不匹配时都返回 false。旧 `allowBroaden` 兼容逻辑只留在旧 SearchPlan
 * 的构造路径，不进入此函数。
 */
export function authorizationCovers(
  goal: UserGoal,
  authorizationRef: string | undefined,
  action: Pick<SearchAction, 'supportsGoalIds' | 'relation' | 'query'>
): boolean {
  if (!authorizationRef) {
    return false;
  }

  // Widening is never allowed without an explicit, scoped goal binding. An
  // empty supportsGoalIds list must not turn a valid authorization reference
  // into a global capability.
  if (
    !goal.goalId
    || action.supportsGoalIds.length === 0
    || !action.supportsGoalIds.includes(goal.goalId)
  ) {
    return false;
  }

  const authorization = (goal.authorizations ?? []).find(
    (candidate) => candidate.id === authorizationRef
  );
  if (!authorization) {
    return false;
  }

  return authorizationAllowsPrimary(
    authorization,
    searchIntentFromRelation(action.relation),
    [action.query]
  );
}

export function authorizationSignature(goal: UserGoal): Array<{
  kind: AgentAuthorization['kind'];
  constraints?: AgentAuthorization['constraints'];
}> {
  return (goal.authorizations ?? [])
    .map((authorization) => ({
      kind: authorization.kind,
      constraints: {
        maxMeters: authorization.constraints?.maxMeters,
        allowedSearchIntents: sortedSearchIntents(
          authorization.constraints?.allowedSearchIntents ?? []
        ),
        allowedKeywords: sortedStrings(authorization.constraints?.allowedKeywords ?? []),
      },
    }))
    .sort((left, right) =>
      `${left.kind}:${JSON.stringify(left.constraints)}`
        .localeCompare(`${right.kind}:${JSON.stringify(right.constraints)}`)
    );
}

function authorizationAllowsPrimary(
  authorization: AgentAuthorization,
  searchIntent: SearchIntent,
  keywords: string[]
): boolean {
  if (authorization.kind === 'category_broaden') {
    return searchIntent === 'broadened'
      && constraintsAllowIntent(authorization, searchIntent)
      && constraintsAllowKeywords(authorization, keywords);
  }

  if (authorization.kind === 'fallback_primary') {
    return searchIntent === 'fallback'
      && constraintsAllowIntent(authorization, searchIntent)
      && constraintsAllowKeywords(authorization, keywords);
  }

  return false;
}

function searchIntentFromRelation(relation: SearchRelation): SearchIntent {
  switch (relation) {
    case 'exact':
      return 'exact';
    case 'equivalent':
      return 'synonym';
    case 'broader':
      return 'broadened';
    case 'alternative':
      return 'fallback';
  }
}

function constraintsAllowIntent(
  authorization: AgentAuthorization,
  searchIntent: SearchIntent
): boolean {
  const allowedSearchIntents = authorization.constraints?.allowedSearchIntents;
  return !allowedSearchIntents || allowedSearchIntents.length === 0
    || allowedSearchIntents.includes(searchIntent);
}

function constraintsAllowKeywords(
  authorization: AgentAuthorization,
  keywords: string[]
): boolean {
  const allowedKeywords = sortedStrings(authorization.constraints?.allowedKeywords ?? []);
  if (allowedKeywords.length === 0) {
    return true;
  }

  const keywordSet = new Set(sortedStrings(keywords));
  return allowedKeywords.some((keyword) => keywordSet.has(keyword));
}

function sortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort();
}

function sortedSearchIntents(values: SearchIntent[]): SearchIntent[] {
  return Array.from(new Set(values)).sort();
}
