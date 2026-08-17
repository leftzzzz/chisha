import { authorizationCovers } from './authorization';
import { SearchActionInputSchema } from './schemas/searchAction';
import type {
  SearchAction,
  SearchActionInput,
  SearchIntent,
  UserGoal,
} from './types';

/** Convert the legacy persisted intent to the new action relation. */
export function searchRelationFromIntent(
  searchIntent: SearchIntent
): SearchAction['relation'] {
  switch (searchIntent) {
    case 'exact':
      return 'exact';
    case 'synonym':
      return 'equivalent';
    case 'broadened':
      return 'broader';
    case 'fallback':
      return 'alternative';
  }
}

/**
 * Create a Runtime-owned SearchAction. Model output must never supply the id or
 * a derived primary-scope boolean.
 */
export function createSearchAction(input: SearchActionInput): SearchAction {
  const normalized = SearchActionInputSchema.parse(input);
  return {
    ...normalized,
    id: createSearchActionId(),
  };
}

/**
 * Derive primary recommendation authorization from the action contract.
 * Exact/equivalent actions are in scope by definition; widening requires an
 * explicit authorization reference that covers this goal and query.
 */
export function isPrimaryScopeAuthorized(
  goal: UserGoal,
  action: SearchAction
): boolean {
  return action.relation === 'exact'
    || action.relation === 'equivalent'
    || authorizationCovers(goal, action.authorizationRef, action);
}

export function createSearchActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return `action_${globalThis.crypto.randomUUID()}`;
  }

  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
