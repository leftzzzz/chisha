import {
  applyGoalPatch,
  applySupervisorClarifyingAnswer,
  buildMinimalFallbackGoal,
  deterministicSupervisor,
} from '@/lib/agent/supervisor';
import type { AgentSession, UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '随便吃点',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['随便吃点'],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: false,
    ...overrides,
  };
}

describe('SearchSupervisorAgent', () => {
  it('uses a minimal rule-free fallback when model parsing is unavailable', () => {
    const output = deterministicSupervisor({ message: '想吃牛排' });

    expect(output.goal).toEqual(expect.objectContaining({
      primaryKeywords: ['牛排'],
      requestedItems: [],
      acceptableCategories: [],
      allowBroaden: false,
    }));
  });

  it('asks a generic clarification for vague requests without fixed category options', () => {
    const output = deterministicSupervisor({ message: '随便吃点' });

    expect(output.nextAction).toBe('ask_user');
    expect(output.question?.question).toContain('具体想吃什么');
    expect(output.question?.options).toBeUndefined();
  });

  it('keeps explicit hard constraints in the fallback goal', () => {
    const fallbackGoal = buildMinimalFallbackGoal('下楼500米内还开门的餐厅');

    expect(fallbackGoal.hardConstraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'distance', maxMeters: 500, strict: true }),
        expect.objectContaining({ kind: 'open_now' }),
      ])
    );
  });

  it('applies goal patches without overwriting existing hard constraints', () => {
    const patched = applyGoalPatch(
      goal({
        hardConstraints: [{ kind: 'distance', label: '500米内', value: 500, maxMeters: 500, strict: true }],
      }),
      {
        addRequestedItems: [{ name: '日料', required: true, aliases: [] }],
        reason: '用户补充了想吃日料。',
      },
      '随便吃点，日料'
    );

    expect(patched.requestedItems.map((item) => item.name)).toContain('日料');
    expect(patched.hardConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'distance', maxMeters: 500 })])
    );
  });

  it('applies soft preference patches without turning them into requested items', () => {
    const patched = applyGoalPatch(
      goal({ primaryKeywords: ['火锅'] }),
      {
        addSoftPreferences: [{ name: '人气高', weight: 1, verifiable: false }],
        reason: '用户补充了不可稳定验证的体验偏好。',
      },
      '想吃火锅，人多的地方'
    );

    expect(patched.requestedItems.map((item) => item.name)).not.toContain('人气高');
    expect(patched.softPreferences).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: '人气高', verifiable: false })])
    );
  });

  it('applies pending question option effects inside Supervisor ownership', () => {
    const session: AgentSession = {
      id: 's1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      goal: goal(),
      pendingQuestion: {
        question: '要允许放宽吗？',
        options: ['允许放宽'],
        optionEffects: {
          '允许放宽': { allowBroaden: true, setDistanceMaxMeters: 5000 },
        },
      },
    };

    applySupervisorClarifyingAnswer(session, '允许放宽');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.allowBroaden).toBe(true);
    expect(session.goal?.requestedItems.map((item) => item.name)).not.toContain('允许放宽');
    expect(session.goal?.hardConstraints).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'distance', maxMeters: 5000 })])
    );
  });

  it('keeps asking when a clarification answer is still only a soft preference', () => {
    const output = deterministicSupervisor({
      message: '清淡一点',
      previousGoal: goal({ primaryKeywords: [] }),
      pendingQuestion: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      },
    });

    expect(output.nextAction).toBe('ask_user');
    expect(output.question?.question).toContain('具体想吃什么');
    expect(output.patch).toBeUndefined();
  });
});
