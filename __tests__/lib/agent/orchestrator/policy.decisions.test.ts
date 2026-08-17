/**
 * 从 runtime 外移过来的四类决策。
 *
 * 这些用例的价值在于**不需要任何 mock**：入口分派、上下文重置、探路时机、
 * 追问收敛全部是纯函数，给状态就能断言结论。此前它们埋在 runtime 里，
 * 想测就得起一整轮 agent 并把三个模型角色 都桩掉。
 */

import {
  decideAskOrConverge,
  decideContextReset,
  decideScouting,
  decideTurnEntry,
  MAX_CONSECUTIVE_ASK_TURNS,
} from '@/lib/agent/orchestrator/policy';
import { CLARIFICATION_OPTION } from '@/lib/agent/clarificationOptions';
import type {
  AgentInput,
  ContextInvalidationPlan,
  PendingQuestion,
  PolicyContext,
  UserGoal,
} from '@/lib/agent/types';

const location = { lat: 30.2794, lng: 120.1305 };

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '附近有什么好吃的',
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
    ...overrides,
  };
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    goal: goal(),
    attempts: [],
    candidates: [],
    location,
    targetCount: 8,
    maxSearchCalls: 4,
    ...overrides,
  };
}

function input(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    query: '附近有什么好吃的',
    location,
    ...overrides,
  } as AgentInput;
}

const invalidation = (
  overrides: Partial<ContextInvalidationPlan> = {}
): ContextInvalidationPlan => ({
  primaryTargetChanged: false,
  hardConstraintsChanged: false,
  exclusionsChanged: false,
  locationChanged: false,
  reasons: [],
  ...overrides,
});

describe('decideTurnEntry', () => {
  it('sends free text to the goal understanding agent', () => {
    expect(decideTurnEntry(input({ query: '想吃火锅' })))
      .toEqual({ kind: 'understand', message: '想吃火锅' });
  });

  it('rejects an option that is no longer on the pending question', () => {
    const decision = decideTurnEntry(input({
      optionId: 'nearby_1',
      runtimeState: { goal: goal(), pendingQuestion: { question: '想吃什么？' } },
    }));

    expect(decision).toEqual({
      kind: 'invalid_option',
      optionId: 'nearby_1',
      reason: 'unavailable',
    });
  });

  it('reruns the current goal on retry instead of treating it as a new request', () => {
    // 历史 bug：把「重试」当新需求喂给模型，rawQuery 被改写、会话被清空。
    const previousGoal = goal({ rawQuery: '想吃火锅', primaryKeywords: ['火锅'] });
    const decision = decideTurnEntry(input({
      query: '重试',
      optionId: CLARIFICATION_OPTION.RETRY_TURN,
      runtimeState: {
        goal: previousGoal,
        pendingQuestion: {
          question: '要重试一次吗？',
          options: [{ id: CLARIFICATION_OPTION.RETRY_TURN, label: '重试' }],
        },
      },
    }));

    expect(decision).toEqual({ kind: 'rerun_current_goal', goal: previousGoal });
  });

  it('applies a deterministic effect without calling the model', () => {
    const decision = decideTurnEntry(input({
      optionId: CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY,
      runtimeState: {
        goal: goal(),
        pendingQuestion: {
          question: '附近主要有这些，想吃哪类？',
          options: [{ id: CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY, label: '随便推荐' }],
          optionEffects: {
            [CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY]: { allowBroaden: true },
          },
        },
      },
    }));

    expect(decision.kind).toBe('apply_effect');
    if (decision.kind === 'apply_effect') {
      expect(decision.goal.allowBroaden).toBe(true);
      expect(decision.conversationMode).toBe('patch_current_goal');
    }
  });

  it('delegates an effect-less model option to the model as free text', () => {
    // 模型自己写的选项没有 effect：它的 label 就是一句预填的用户回答。
    const decision = decideTurnEntry(input({
      optionId: 'opt_1',
      runtimeState: {
        goal: goal(),
        pendingQuestion: {
          question: '想吃什么？',
          options: [{ id: 'opt_1', label: '日本料理' }],
        },
      },
    }));

    expect(decision).toEqual({ kind: 'understand', message: '日本料理' });
  });
});

describe('decideContextReset', () => {
  it('clears everything when the user starts a new goal', () => {
    expect(decideContextReset('start_new_goal', invalidation())).toEqual({
      clearAttempts: true,
      clearCandidates: true,
      clearActionHistory: true,
      clearObservations: true,
      reason: 'start_new_goal',
    });
  });

  it('keeps candidates when only constraints changed', () => {
    const plan = decideContextReset(
      'patch_current_goal',
      invalidation({ hardConstraintsChanged: true, reasons: ['hard_constraints_changed'] })
    );

    expect(plan.clearAttempts).toBe(true);
    expect(plan.clearCandidates).toBe(false);
    expect(plan.reason).toBe('hard_constraints_changed');
  });

  it('keeps everything when nothing relevant changed', () => {
    expect(decideContextReset('continue_current_goal', invalidation())).toEqual({
      clearAttempts: false,
      clearCandidates: false,
      clearActionHistory: false,
      clearObservations: false,
    });
  });
});

describe('decideScouting', () => {
  it('scouts before asking when the user named no food target', () => {
    const decision = decideScouting(context());

    expect(decision.kind).toBe('scout');
    if (decision.kind === 'scout') {
      expect(decision.plan.keywords).toEqual(['餐厅']);
      // 探路只为看清品类分布，绝不能让它的结果进主推荐。
      expect(decision.plan.allowedForPrimary).toBe(false);
      expect(decision.plan.searchIntent).toBe('fallback');
    }
  });

  it('skips scouting when the user already said what they want', () => {
    expect(decideScouting(context({ goal: goal({ primaryKeywords: ['火锅'] }) })))
      .toEqual({ kind: 'skip' });
  });
});

describe('decideAskOrConverge', () => {
  const question: PendingQuestion = {
    question: '想吃点什么？',
    options: [{ id: 'nearby_1', label: '火锅 12家' }],
  };

  it('asks and advances the counter on a fresh question', () => {
    const decision = decideAskOrConverge({}, question);

    expect(decision.kind).toBe('ask');
    if (decision.kind === 'ask') {
      expect(decision.nextState.consecutiveAskTurns).toBe(1);
      expect(decision.nextState.lastQuestionFingerprint).toBeTruthy();
    }
  });

  it('converges instead of asking the very same question twice', () => {
    const first = decideAskOrConverge({}, question);
    if (first.kind !== 'ask') throw new Error('expected ask');

    const second = decideAskOrConverge(first.nextState, question);

    expect(second).toEqual({
      kind: 'converge',
      reason: 'CLARIFICATION_STALLED',
      repeated: true,
      consecutiveAskTurns: 1,
    });
  });

  it('converges once the consecutive ask limit is reached', () => {
    const decision = decideAskOrConverge(
      { lastQuestionFingerprint: 'something-else', consecutiveAskTurns: MAX_CONSECUTIVE_ASK_TURNS },
      question
    );

    expect(decision.kind).toBe('converge');
  });

  it('treats a differently-worded question as a new ask', () => {
    const first = decideAskOrConverge({}, question);
    if (first.kind !== 'ask') throw new Error('expected ask');

    const second = decideAskOrConverge(first.nextState, {
      question: '要扩大范围再搜吗？',
      options: [{ id: 'expand_distance', label: '扩大范围' }],
    });

    expect(second.kind).toBe('ask');
  });
});
