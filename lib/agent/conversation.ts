import { parseUserGoal } from './planner';
import type { AgentSession, PendingQuestion, UserPreferenceSummary } from './types';

const CLARIFYING_QUESTION: PendingQuestion = {
  question: '想吃正餐、小吃，还是喝点东西？',
  options: ['正餐', '小吃', '喝点东西'],
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

  session.pendingQuestion = undefined;
}

function hasEnoughIntentSignal(message: string): boolean {
  return /火锅|日料|日本|寿司|拉面|川菜|湘菜|粤菜|西餐|韩餐|咖啡|奶茶|甜品|烧烤|面|粥|素食|轻食|沙拉|海鲜|清真|快餐|小吃|正餐|不吃辣|清淡|约会|聚餐/.test(message);
}
