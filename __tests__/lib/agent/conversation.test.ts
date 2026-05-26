import { getClarifyingQuestion } from '@/lib/agent/conversation';

describe('agent conversation', () => {
  it('asks a clarifying question for vague food requests', () => {
    const question = getClarifyingQuestion('随便吃点');

    expect(question).toEqual(
      expect.objectContaining({
        question: expect.stringContaining('正餐'),
        options: expect.arrayContaining(['正餐', '小吃']),
      })
    );
  });

  it('does not pause when the user already provided a concrete cuisine', () => {
    expect(getClarifyingQuestion('想吃日料')).toBeNull();
    expect(getClarifyingQuestion('今天吃清淡点，不吃辣')).toBeNull();
  });
});
