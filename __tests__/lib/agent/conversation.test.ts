import { applyClarifyingAnswer, getClarifyingQuestion } from '@/lib/agent/conversation';
import type { AgentSession } from '@/lib/agent/types';

describe('agent conversation', () => {
  it('asks a clarifying question for vague food requests', () => {
    const question = getClarifyingQuestion('随便吃点');

    expect(question).toEqual(
      expect.objectContaining({
        question: expect.stringContaining('具体想吃什么'),
        allowFreeText: true,
      })
    );
  });

  it('does not pause when the user already provided a concrete cuisine', () => {
    expect(getClarifyingQuestion('想吃日料')).toBeNull();
    expect(getClarifyingQuestion('今天吃清淡点，不吃辣')).toBeNull();
  });

  it('applies clarifying option effects to the persisted goal', () => {
    const session: AgentSession = {
      id: 's1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      goal: {
        intent: 'find_restaurants',
        rawQuery: '随便吃点',
        requestedItems: [],
        acceptableCategories: [],
        alternativeGroups: [],
        primaryKeywords: [],
        relatedKeywords: [],
        broadenedKeywords: [],
        hardConstraints: [],
        softPreferences: [],
        exclusions: [],
        ambiguity: [],
        clarificationNeeded: [],
        allowBroaden: false,
      },
      pendingQuestion: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        options: ['正餐', '小吃'],
        optionEffects: {
          '小吃': { addCategories: ['小吃', '快餐'] },
        },
      },
    };

    applyClarifyingAnswer(session, '小吃');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.primaryKeywords).toEqual(expect.arrayContaining(['小吃', '快餐']));
    expect(session.goal?.acceptableCategories.map((item) => item.name)).toEqual(
      expect.arrayContaining(['小吃', '快餐'])
    );
    expect(session.goal?.clarificationNeeded).toEqual([]);
  });

  it('merges free-text clarifying answers into the persisted goal', () => {
    const session: AgentSession = {
      id: 's1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      location: { lat: 31.2, lng: 121.4 },
      messages: [],
      attempts: [],
      candidates: [],
      goal: {
        intent: 'find_restaurants',
        rawQuery: '随便吃点',
        requestedItems: [],
        acceptableCategories: [],
        alternativeGroups: [],
        primaryKeywords: [],
        relatedKeywords: [],
        broadenedKeywords: [],
        hardConstraints: [],
        softPreferences: [],
        exclusions: [],
        ambiguity: [],
        clarificationNeeded: [{
          reason: '用户需求较开放，缺少可验证目标。',
          question: '你想找哪类餐厅，或具体想吃什么？',
          allowFreeText: true,
        }],
        allowBroaden: false,
      },
      pendingQuestion: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      },
    };

    applyClarifyingAnswer(session, '想吃日料');

    expect(session.pendingQuestion).toBeUndefined();
    expect(session.goal?.primaryKeywords).toEqual(expect.arrayContaining(['日料']));
    expect(session.goal?.acceptableCategories.map((item) => item.name)).toEqual(
      expect.arrayContaining(['日料'])
    );
    expect(session.goal?.clarificationNeeded).toEqual([]);
  });
});
