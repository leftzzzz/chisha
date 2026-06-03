import type {
  AgentAuthorization,
  SearchIntent,
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
