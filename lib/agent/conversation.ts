import { parseUserGoal } from './planner';
import type { AgentSession, ClarificationEffect, Constraint, PendingQuestion, UserPreferenceSummary } from './types';

const CLARIFYING_QUESTION: PendingQuestion = {
  question: '你想找哪类餐厅，或具体想吃什么？',
  allowFreeText: true,
};

export function getClarifyingQuestion(
  message: string,
  preferenceSummary?: UserPreferenceSummary,
  session?: AgentSession
): PendingQuestion | null {
  if (session?.pendingQuestion) {
    return null;
  }

  const goal = parseUserGoal(message, preferenceSummary);
  const isDefaultStrategy = goal.softPreferences.some((preference) => preference.name === '默认多样性');

  if (!isDefaultStrategy) {
    return null;
  }

  if (hasEnoughIntentSignal(message)) {
    return null;
  }

  return CLARIFYING_QUESTION;
}

export function applyClarifyingAnswer(session: AgentSession, answer: string): void {
  const normalized = answer.trim();

  if (!normalized) {
    return;
  }

  const effect = session.pendingQuestion?.optionEffects?.[normalized]
    ?? inferClarificationEffect(normalized);
  if (session.goal) {
    if (effect) {
      applyClarificationEffect(session, effect);
    } else if (hasEnoughIntentSignal(normalized)) {
      mergeAnswerGoal(session, parseUserGoal(normalized));
    }

    session.goal.clarificationNeeded = [];
  }

  session.pendingQuestion = undefined;
}

function hasEnoughIntentSignal(message: string): boolean {
  return /火锅|日料|日本|寿司|拉面|川菜|湘菜|粤菜|西餐|韩餐|咖啡|奶茶|甜品|烧烤|面|粥|素食|轻食|沙拉|海鲜|清真|快餐|小吃|正餐|不吃辣|清淡|约会|聚餐/.test(message);
}

function inferClarificationEffect(answer: string): ClarificationEffect | null {
  if (/扩大|放宽|远一点|查看候补|看看候补/.test(answer)) {
    return { allowBroaden: true, setDistanceMaxMeters: 5000 };
  }

  if (/正餐/.test(answer)) {
    return { addCategories: ['中餐', '餐厅'] };
  }

  if (/小吃/.test(answer)) {
    return { addCategories: ['小吃', '快餐'] };
  }

  if (/喝|饮品|奶茶|咖啡/.test(answer)) {
    return { addCategories: ['咖啡', '奶茶', '饮品'] };
  }

  return null;
}

function applyClarificationEffect(session: AgentSession, effect: ClarificationEffect): void {
  const goal = session.goal;
  if (!goal) {
    return;
  }

  if (effect.addRequestedItems) {
    for (const item of effect.addRequestedItems) {
      if (!goal.requestedItems.some((requested) => requested.name === item)) {
        goal.requestedItems.push({ name: item, required: true, aliases: [] });
      }
    }
    goal.primaryKeywords = mergeStrings(goal.primaryKeywords, effect.addRequestedItems);
  }

  if (effect.addCategories) {
    for (const category of effect.addCategories) {
      if (!goal.acceptableCategories.some((item) => item.name === category)) {
        goal.acceptableCategories.push({ name: category, confidence: 0.8 });
      }
    }
    goal.primaryKeywords = mergeStrings(goal.primaryKeywords, effect.addCategories);
  }

  if (effect.allowBroaden !== undefined) {
    goal.allowBroaden = effect.allowBroaden;
  }

  if (effect.setDistanceMaxMeters !== undefined) {
    goal.hardConstraints = replaceDistanceConstraint(goal.hardConstraints, effect.setDistanceMaxMeters);
  }
}

function mergeAnswerGoal(session: AgentSession, answerGoal: NonNullable<AgentSession['goal']>): void {
  const goal = session.goal;
  if (!goal) {
    return;
  }

  for (const item of answerGoal.requestedItems) {
    if (!goal.requestedItems.some((requested) => requested.name === item.name)) {
      goal.requestedItems.push(item);
    }
  }

  for (const category of answerGoal.acceptableCategories) {
    const existing = goal.acceptableCategories.find((item) => item.name === category.name);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, category.confidence);
    } else {
      goal.acceptableCategories.push(category);
    }
  }

  goal.primaryKeywords = mergeStrings(goal.primaryKeywords, answerGoal.primaryKeywords);
  goal.relatedKeywords = mergeStrings(goal.relatedKeywords, answerGoal.relatedKeywords);
  goal.broadenedKeywords = mergeStrings(goal.broadenedKeywords, answerGoal.broadenedKeywords);
  goal.hardConstraints = mergeConstraints(goal.hardConstraints, answerGoal.hardConstraints);
  goal.softPreferences = mergePreferences(goal.softPreferences, answerGoal.softPreferences);
  goal.exclusions = mergeStrings(goal.exclusions, answerGoal.exclusions);
  goal.ambiguity = mergeStrings(goal.ambiguity, answerGoal.ambiguity);
  goal.poiType ??= answerGoal.poiType;
  goal.allowBroaden = goal.allowBroaden || answerGoal.allowBroaden;
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

function mergePreferences(
  left: NonNullable<AgentSession['goal']>['softPreferences'],
  right: NonNullable<AgentSession['goal']>['softPreferences']
): NonNullable<AgentSession['goal']>['softPreferences'] {
  const byName = new Map<string, NonNullable<AgentSession['goal']>['softPreferences'][number]>();

  for (const preference of [...left, ...right]) {
    const existing = byName.get(preference.name);
    byName.set(preference.name, {
      ...preference,
      weight: existing ? Math.max(existing.weight, preference.weight) : preference.weight,
      verifiable: existing ? existing.verifiable || preference.verifiable : preference.verifiable,
    });
  }

  return Array.from(byName.values());
}

function replaceDistanceConstraint(constraints: Constraint[], maxMeters: number): Constraint[] {
  return [
    ...constraints.filter((constraint) => constraint.kind !== 'distance'),
    {
      kind: 'distance',
      label: `${Math.round(maxMeters)}米内`,
      value: maxMeters,
      maxMeters,
      strict: false,
    },
  ];
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map((item) => item.trim()).filter(Boolean)));
}
