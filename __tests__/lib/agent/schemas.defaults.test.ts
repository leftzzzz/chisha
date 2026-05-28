import { AgentActionSchema } from '@/lib/agent/schemas/action';
import { UserGoalSchema } from '@/lib/agent/schemas/goal';
import { PlanningAgentOutputSchema, SearchPlanSchema } from '@/lib/agent/schemas/plan';
import { EvaluationAgentOutputSchema } from '@/lib/agent/schemas/verdict';

describe('Agent schema defaults', () => {
  it('defaults non-critical UserGoal fields commonly omitted by models', () => {
    const parsed = UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '不要辣的，其他都可以',
      requestedItems: [{ name: '日料' }],
      acceptableCategories: [{ name: '日本料理' }],
      hardConstraints: [{ kind: 'avoid_spicy' }],
      softPreferences: [{ name: '清淡' }],
      clarificationNeeded: [{ question: '你想找哪类餐厅？' }],
    });

    expect(parsed.requestedItems[0]).toEqual({ name: '日料', required: true, aliases: [] });
    expect(parsed.acceptableCategories[0]).toEqual({ name: '日本料理', confidence: 0.8 });
    expect(parsed.hardConstraints[0]).toEqual({ kind: 'avoid_spicy', label: '约束' });
    expect(parsed.softPreferences[0]).toEqual({ name: '清淡', weight: 1, verifiable: false });
    expect(parsed.clarificationNeeded[0]).toEqual({
      reason: '需要补充信息。',
      question: '你想找哪类餐厅？',
      allowFreeText: true,
    });
  });

  it('defaults optional explanation fields in action and plan outputs', () => {
    expect(AgentActionSchema.parse({ type: 'finish' })).toEqual({
      type: 'finish',
      explanation: '已完成当前推荐。',
      confidence: 0.6,
    });

    expect(SearchPlanSchema.parse({
      keywords: ['日料'],
      radiusMeters: 1800,
      searchIntent: 'exact',
      allowedForPrimary: true,
    }).reason).toBe('根据用户目标搜索。');

    expect(PlanningAgentOutputSchema.parse({}).plans).toEqual([]);
  });

  it('defaults non-critical evaluation output fields', () => {
    const parsed = EvaluationAgentOutputSchema.parse({
      verdicts: [{
        restaurantId: 'r1',
        status: 'passed',
        primaryEligible: true,
        confidence: 0.8,
      }],
    });

    expect(parsed.selectedIds).toEqual([]);
    expect(parsed.candidateIds).toEqual([]);
    expect(parsed.explanation).toBe('已完成候选评估。');
    expect(parsed.verdicts[0].matchedItems).toEqual([]);
  });
});
