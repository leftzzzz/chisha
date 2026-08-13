import {
  buildDegradedGoalFromQuery,
  buildEmptyDegradedGoal,
  extractDegradedKeywords,
} from '@/lib/agent/degraded';

describe('入口降级', () => {
  it('extracts known food terms from the raw query', () => {
    expect(extractDegradedKeywords('想吃火锅')).toEqual(['火锅']);
    expect(extractDegradedKeywords('中午来点日料吧')).toEqual(['日料']);
  });

  it('refuses to invent search targets from sentence fragments', () => {
    // 关键不变量：理解失败时宁可追问，也不能把"没有具体想吃的"当成搜索词。
    expect(extractDegradedKeywords('没有具体想吃的，你来选')).toEqual([]);
    expect(extractDegradedKeywords('随便吧都行')).toEqual([]);
    expect(extractDegradedKeywords('   ')).toEqual([]);
  });

  it('builds a minimal goal that keeps hard constraints empty', () => {
    const goal = buildDegradedGoalFromQuery('想吃火锅');

    expect(goal?.primaryKeywords).toEqual(['火锅']);
    expect(goal?.hardConstraints).toEqual([]);
    expect(goal?.allowBroaden).toBe(false);
    expect(goal?.clarificationNeeded).toEqual([]);
    expect(goal?.ambiguity[0]).toContain('需求理解服务暂时不可用');
    expect(goal?.goalSignature).toBeDefined();
  });

  it('returns null when no food term can be extracted', () => {
    expect(buildDegradedGoalFromQuery('没有具体想吃的，你来选')).toBeNull();
  });

  it('builds an empty goal for the clarification path', () => {
    const goal = buildEmptyDegradedGoal('没有具体想吃的，你来选');

    expect(goal.primaryKeywords).toEqual([]);
    expect(goal.rawQuery).toBe('没有具体想吃的，你来选');
    expect(goal.goalVersion).toBe(1);
  });
});
