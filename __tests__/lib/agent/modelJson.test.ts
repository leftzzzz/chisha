import { parseModelJsonArguments } from '@/lib/agent/modelJson';

describe('parseModelJsonArguments', () => {
  it('parses strict model JSON arguments', () => {
    expect(parseModelJsonArguments('{"type":"finish","confidence":0.8}', 'TestAgent')).toEqual({
      type: 'finish',
      confidence: 0.8,
    });
  });

  it('repairs structurally truncated JSON arguments', () => {
    expect(parseModelJsonArguments(
      '{"goal":{"intent":"find_restaurants","rawQuery":"想吃日料"',
      'TestAgent'
    )).toEqual({
      goal: {
        intent: 'find_restaurants',
        rawQuery: '想吃日料',
      },
    });
  });

  it('throws an agent-scoped error when JSON cannot be repaired', () => {
    expect(() => parseModelJsonArguments(
      '{"reason":"用户说"不要辣的""}',
      'TestAgent'
    )).toThrow('TestAgent returned malformed function arguments JSON');
  });
});
