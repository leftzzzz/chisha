/**
 * 目标代数：UserGoal 的合并、打补丁与追问选项应用。
 *
 * 全部是纯函数，不调模型、不发请求。此前它们和 GoalUnderstandingModel 混在
 * 同一个文件里，导致任何想复用"合并目标"的地方都得 import 一个模型角色。
 *
 * 边界：这里只做"给定旧目标和一个变更，新目标长什么样"，不判断该不该变更
 * （属于 orchestrator/policy），也不理解用户说了什么（属于模型角色）。
 */

import { promoteAuthorizedBroadenedResults } from './broadenAdmission';
import { withUpdatedGoalVersion } from './goalVersion';
import { PendingQuestionSchema } from './schemas/clarification';
import { GoalPatchSchema, UserGoalSchema } from './schemas/goal';
import type {
  AgentAuthorization,
  AgentSession,
  ClarificationEffect,
  Constraint,
  GoalCategory,
  GoalPatch,
  PendingQuestion,
  RequestedItem,
  UserGoal,
} from './types';

/**
 * 目标词的**合并集合**签名，用于判断"用户想吃的东西整体变没变"。
 *
 * 与 `goalVersion.ts` 的分字段签名刻意不同：同一个词在 requestedItems 与
 * primaryKeywords 之间挪动，对"是不是换了个新需求"没有意义。
 */
export function primaryTargetSetSignature(goal: UserGoal): string {
  return Array.from(new Set([
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].map((item) => item.trim()).filter(Boolean))).sort().join('|');
}

/** 用户明确要求且不允许放宽的最大距离；没有则 undefined。 */
export function getStrictDistanceMaxMeters(goal: UserGoal): number | undefined {
  const strictDistance = goal.hardConstraints.find(
    (constraint) => constraint.kind === 'distance' && constraint.strict
  );

  return strictDistance?.maxMeters
    ?? (typeof strictDistance?.value === 'number' ? strictDistance.value : undefined);
}

export function hasPrimaryTargets(goal: UserGoal): boolean {
  return [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].some((item) => item.trim().length > 0);
}

/**
 * 应用一个追问选项，得到更新后的目标。
 *
 * 按 **id** 查 effect——绝不按文案匹配。文案匹配正是死循环的成因：
 * 前端「你推荐」与后端「随便推荐」对不上，确定性通道恒 miss。
 *
 * @returns 该 id 没有对应 effect 时返回 null（调用方据此报 INVALID_OPTION）
 */
export function applyClarificationOptionToGoal(
  goal: UserGoal,
  pendingQuestion: PendingQuestion | undefined,
  optionId: string
): UserGoal | null {
  const effect = pendingQuestion?.optionEffects?.[optionId];
  if (!effect) {
    return null;
  }

  const patch = goalPatchFromClarificationEffect(effect, goal);
  return applyGoalPatch(goal, patch, goal.rawQuery);
}

/** 追问选项在当前问题里是否存在（即使没有 effect，例如"换个类型"）。 */
export function hasClarificationOption(
  pendingQuestion: PendingQuestion | undefined,
  optionId: string
): boolean {
  return (pendingQuestion?.options ?? []).some((option) => option.id === optionId);
}

/** 取选项的展示文案，用于写入会话消息。 */
export function clarificationOptionLabel(
  pendingQuestion: PendingQuestion | undefined,
  optionId: string
): string | undefined {
  return (pendingQuestion?.options ?? []).find((option) => option.id === optionId)?.label;
}

export function applyGoalPatch(goal: UserGoal, patch: GoalPatch, rawQuery = goal.rawQuery): UserGoal {
  const replacingPrimaryTargets = patch.replacePrimaryKeywords !== undefined
    || patch.replaceRequestedItems !== undefined
    || patch.replaceCategories !== undefined;
  const patched: UserGoal = {
    ...goal,
    rawQuery,
    poiType: replacingPrimaryTargets ? undefined : goal.poiType,
    requestedItems: patch.replaceRequestedItems
      ?? mergeByName(goal.requestedItems, patch.addRequestedItems ?? []),
    acceptableCategories: patch.replaceCategories
      ?? mergeCategories(goal.acceptableCategories, patch.addCategories ?? []),
    relatedKeywords: replacingPrimaryTargets ? [] : goal.relatedKeywords,
    broadenedKeywords: replacingPrimaryTargets ? [] : goal.broadenedKeywords,
    relatedTargets: replacingPrimaryTargets ? [] : goal.relatedTargets,
    broadenedTargets: replacingPrimaryTargets ? [] : goal.broadenedTargets,
    softPreferences: mergePreferences(goal.softPreferences, patch.addSoftPreferences ?? []),
    hardConstraints: mergeConstraints(
      goal.hardConstraints.filter((constraint) =>
        !(patch.removeConstraints ?? []).includes(constraint.label)
      ),
      patch.addConstraints ?? []
    ),
    authorizations: mergeAuthorizations(
      goal.authorizations ?? [],
      patch.addAuthorizations ?? inferAuthorizationsFromLegacyPatch(patch, goal)
    ),
    allowBroaden: patch.allowBroaden ?? goal.allowBroaden,
    // Patch reason explains why the goal version changed; it is not evidence
    // that a user constraint remains unmet.
    ambiguity: goal.ambiguity,
    clarificationNeeded: [],
  };

  const primaryKeywordBase = patch.replacePrimaryKeywords
    ?? (replacingPrimaryTargets
      ? [
          ...(patch.replaceRequestedItems ?? []).map((item) => item.name),
          ...(patch.replaceCategories ?? []).map((category) => category.name),
        ]
      : patched.primaryKeywords);
  patched.primaryKeywords = mergeStrings(
    primaryKeywordBase,
    [
      ...(patch.addRequestedItems ?? []).map((item) => item.name),
      ...(patch.addCategories ?? []).map((category) => category.name),
    ]
  );
  patched.exclusions = patched.hardConstraints
    .filter((constraint) => constraint.kind === 'exclude_category')
    .flatMap((constraint) => constraint.values ?? []);

  return withUpdatedGoalVersion(UserGoalSchema.parse(patched), goal);
}

/**
 * 会话级的追问选项应用。
 *
 * @param optionId - 选项 id（不是文案）
 */
export function applyClarificationOptionToSession(session: AgentSession, optionId: string): void {
  const goal = session.goal;
  if (!goal) {
    session.pendingQuestion = undefined;
    return;
  }

  const effect = session.pendingQuestion?.optionEffects?.[optionId];
  const patched = applyClarificationOptionToGoal(goal, session.pendingQuestion, optionId);
  if (!patched) {
    session.pendingQuestion = undefined;
    return;
  }

  session.goal = patched;
  if (effect?.allowBroaden === true) {
    promoteAuthorizedBroadenedResults(session);
  }
  session.pendingQuestion = undefined;
}

export function clarificationNeedToPendingQuestion(
  need: UserGoal['clarificationNeeded'][number]
): PendingQuestion {
  return PendingQuestionSchema.parse({
    reason: need.reason,
    question: need.question,
    options: need.options?.map((option) => option.label),
    allowFreeText: need.allowFreeText,
    optionEffects: Object.fromEntries(
      (need.options ?? [])
        .filter((option) => option.effect)
        .map((option) => [option.label, option.effect!])
    ),
  });
}

function goalPatchFromClarificationEffect(
  effect: ClarificationEffect,
  previousGoal?: UserGoal
): GoalPatch {
  const addConstraints: Constraint[] = [];
  const replaceRequestedItems = effect.replaceRequestedItems?.filter(Boolean);
  const replaceCategories = effect.replaceCategories?.filter(Boolean);
  const replacePrimaryKeywords = effect.replacePrimaryKeywords?.filter(Boolean);
  const addRequestedItems = effect.addRequestedItems?.filter(Boolean);
  const addCategories = effect.addCategories?.filter(Boolean);

  if (effect.setDistanceMaxMeters !== undefined) {
    addConstraints.push({
      kind: 'distance',
      label: `${Math.round(effect.setDistanceMaxMeters)}米内`,
      value: effect.setDistanceMaxMeters,
      maxMeters: effect.setDistanceMaxMeters,
      strict: false,
    });
  }

  return GoalPatchSchema.parse({
    replaceRequestedItems: replaceRequestedItems?.length
      ? replaceRequestedItems.map((item) => ({
          name: item,
          required: true,
          aliases: [],
        }))
      : undefined,
    replaceCategories: replaceCategories?.length
      ? replaceCategories.map((category) => ({
          name: category,
          confidence: 0.8,
        }))
      : undefined,
    replacePrimaryKeywords: replacePrimaryKeywords?.length ? replacePrimaryKeywords : undefined,
    addRequestedItems: addRequestedItems?.length
      ? addRequestedItems.map((item) => ({
          name: item,
          required: true,
          aliases: [],
        }))
      : undefined,
    addCategories: addCategories?.length
      ? addCategories.map((category) => ({
          name: category,
          confidence: 0.8,
        }))
      : undefined,
    addSoftPreferences: effect.addSoftPreferences,
    addConstraints,
    removeConstraints: effect.setDistanceMaxMeters !== undefined
      ? strictDistanceConstraintLabels(previousGoal)
      : undefined,
    addAuthorizations: effect.addAuthorizations
      ?? inferAuthorizationsFromClarificationEffect(effect, previousGoal),
    allowBroaden: effect.allowBroaden,
    reason: '根据用户追问选项更新目标。',
  });
}

function inferAuthorizationsFromClarificationEffect(
  effect: ClarificationEffect,
  previousGoal?: UserGoal
): AgentAuthorization[] | undefined {
  if (effect.setDistanceMaxMeters !== undefined) {
    return [
      createAuthorization('distance_expansion', '用户授权扩大距离范围。', {
        maxMeters: effect.setDistanceMaxMeters,
      }),
    ];
  }

  if (effect.allowBroaden !== true) {
    return undefined;
  }

  return [
    hasPrimaryTargets(previousGoal ?? emptyGoalForAuthorization())
      ? createAuthorization('category_broaden', '用户授权放宽到相邻品类。', {
          allowedSearchIntents: ['broadened'],
        })
      : createAuthorization('fallback_primary', '用户授权开放推荐，可将兜底餐饮候选作为主推荐。', {
          allowedSearchIntents: ['fallback'],
        }),
  ];
}

function inferAuthorizationsFromLegacyPatch(
  patch: GoalPatch,
  previousGoal: UserGoal
): AgentAuthorization[] {
  if (patch.allowBroaden !== true) {
    return [];
  }

  const distanceConstraint = patch.addConstraints?.find((constraint) =>
    constraint.kind === 'distance' && constraint.maxMeters !== undefined && constraint.strict !== true
  );
  if (distanceConstraint?.maxMeters !== undefined) {
    return [
      createAuthorization('distance_expansion', '用户授权扩大距离范围。', {
        maxMeters: distanceConstraint.maxMeters,
      }),
    ];
  }

  return [
    hasPrimaryTargets(previousGoal)
      ? createAuthorization('category_broaden', '用户授权放宽到相邻品类。', {
          allowedSearchIntents: ['broadened'],
        })
      : createAuthorization('fallback_primary', '用户授权开放推荐，可将兜底餐饮候选作为主推荐。', {
          allowedSearchIntents: ['fallback'],
        }),
  ];
}

function createAuthorization(
  kind: AgentAuthorization['kind'],
  reason: string,
  constraints?: AgentAuthorization['constraints']
): AgentAuthorization {
  return {
    id: `auth_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    createdAt: Date.now(),
    reason,
    constraints,
  };
}

function mergeAuthorizations(
  left: AgentAuthorization[],
  right: AgentAuthorization[]
): AgentAuthorization[] {
  const byKey = new Map<string, AgentAuthorization>();
  for (const authorization of [...left, ...right]) {
    byKey.set(authorizationKey(authorization), authorization);
  }
  return Array.from(byKey.values());
}

function authorizationKey(authorization: AgentAuthorization): string {
  return [
    authorization.kind,
    authorization.reason,
    authorization.constraints?.maxMeters ?? '',
    (authorization.constraints?.allowedSearchIntents ?? []).join('|'),
    (authorization.constraints?.allowedKeywords ?? []).join('|'),
  ].join(':');
}

function emptyGoalForAuthorization(): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
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
  };
}

function strictDistanceConstraintLabels(goal: UserGoal | undefined): string[] {
  const labels = goal?.hardConstraints
    .filter((constraint) => constraint.kind === 'distance' && constraint.strict)
    .map((constraint) => constraint.label)
    .filter(Boolean);

  return labels && labels.length > 0 ? labels : ['楼下500米内', '步行1公里内'];
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map((item) => item.trim()).filter(Boolean)));
}

function mergeByName<T extends RequestedItem>(left: T[], right: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of [...left, ...right]) {
    byName.set(item.name, item);
  }
  return Array.from(byName.values());
}

function mergeCategories(left: GoalCategory[], right: GoalCategory[]): GoalCategory[] {
  const byName = new Map<string, GoalCategory>();
  for (const category of [...left, ...right]) {
    const existing = byName.get(category.name);
    byName.set(category.name, {
      name: category.name,
      confidence: existing ? Math.max(existing.confidence, category.confidence) : category.confidence,
    });
  }
  return Array.from(byName.values());
}

function mergePreferences(left: UserGoal['softPreferences'], right: UserGoal['softPreferences']): UserGoal['softPreferences'] {
  const byName = new Map<string, UserGoal['softPreferences'][number]>();
  for (const preference of [...left, ...right]) {
    const existing = byName.get(preference.name);
    byName.set(preference.name, {
      name: preference.name,
      weight: existing ? Math.max(existing.weight, preference.weight) : preference.weight,
      verifiable: existing ? existing.verifiable || preference.verifiable : preference.verifiable,
    });
  }
  return Array.from(byName.values());
}

function mergeConstraints(left: Constraint[], right: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  const constraints: Constraint[] = [];
  for (const constraint of [...left, ...right]) {
    const key = `${constraint.kind}:${constraint.label}:${JSON.stringify(constraint.value ?? constraint.values ?? '')}`;
    if (!seen.has(key)) {
      seen.add(key);
      constraints.push(constraint);
    }
  }
  return constraints;
}
