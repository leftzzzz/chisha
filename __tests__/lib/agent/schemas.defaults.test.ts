import { AgentActionSchema } from '@/lib/agent/schemas/action';
import { GoalUnderstandingOutputSchema } from '@/lib/agent/schemas/clarification';
import { GoalPatchSchema, UserGoalSchema } from '@/lib/agent/schemas/goal';
import { KeywordExpansionOutputSchema } from '@/lib/agent/schemas/keywordExpansion';
import { SearchPlanSchema } from '@/lib/agent/schemas/plan';
import { EvaluationModelOutputSchema } from '@/lib/agent/schemas/verdict';

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

  it('tolerates common scalar fields in UserGoal model output', () => {
    const parsed = UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '找现在营业的日料',
      requestedItems: '日料',
      acceptableCategories: '日本料理',
      primaryKeywords: '日料',
      relatedTargets: {
        keyword: '寿司',
        poiTypes: '050202|050203',
        confidence: '0.7',
      },
      hardConstraints: {
        kind: 'open_now',
        label: '当前营业',
        value: true,
        strict: 'true',
      },
      softPreferences: '清淡',
      allowBroaden: 'false',
    });

    expect(parsed.requestedItems).toEqual([{ name: '日料', required: true, aliases: [] }]);
    expect(parsed.acceptableCategories).toEqual([{ name: '日本料理', confidence: 0.8 }]);
    expect(parsed.primaryKeywords).toEqual(['日料']);
    expect(parsed.relatedTargets).toEqual([expect.objectContaining({
      keyword: '寿司',
      poiTypes: ['050202', '050203'],
      confidence: 0.7,
    })]);
    expect(parsed.hardConstraints[0]).toEqual(expect.objectContaining({
      kind: 'open_now',
      value: true,
      strict: true,
    }));
    expect(parsed.softPreferences).toEqual([{ name: '清淡', weight: 1, verifiable: false }]);
    expect(parsed.allowBroaden).toBe(false);
  });

  it('fails closed when any hard constraint is malformed', () => {
    const invalidConstraint = { kind: 'menu_contains_unsupported_field' };
    const strictDistance = {
      kind: 'distance',
      label: '500米内',
      maxMeters: 500,
      strict: true,
    };

    expect(() => UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '500米内的羊肉火锅，不要辣',
      hardConstraints: [strictDistance, invalidConstraint],
    })).toThrow(/Invalid enum value.*menu_contains_unsupported_field/);
  });

  it('rejects a patch with mixed valid and invalid added constraints', () => {
    expect(() => GoalPatchSchema.parse({
      addConstraints: [
        { kind: 'distance', maxMeters: 500, strict: true },
        { kind: 'invalid_constraint_kind' },
      ],
      reason: '增加距离与其他限制',
    })).toThrow();
  });

  it('preserves optional and scalar constraint patch inputs', () => {
    expect(GoalPatchSchema.parse({}).addConstraints).toBeUndefined();
    expect(GoalPatchSchema.parse({ addConstraints: null }).addConstraints).toBeUndefined();
    expect(GoalPatchSchema.parse({ addConstraints: [] }).addConstraints).toEqual([]);
    const constraint = { kind: 'distance', label: '500米内', maxMeters: 500, strict: true };
    expect(GoalPatchSchema.parse({ addConstraints: constraint }).addConstraints)
      .toEqual([constraint]);
    expect(GoalPatchSchema.parse({ addConstraints: [constraint] }).addConstraints)
      .toEqual([constraint]);
    expect(() => GoalPatchSchema.parse({ addConstraints: 'invalid' })).toThrow();
  });

  it('rejects mixed valid and invalid goal targets instead of erasing the valid entries', () => {
    expect(() => UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '想吃牛排，不要川菜',
      requestedItems: [
        { name: '牛排' },
        { required: true },
      ],
      exclusions: ['川菜'],
    })).toThrow();

    expect(() => UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '想吃牛排，不要川菜',
      requestedItems: [{ name: '牛排' }],
      exclusions: ['川菜', 42],
    })).toThrow();
  });

  it('rejects malformed target patch fields instead of applying a partial update', () => {
    expect(() => GoalPatchSchema.parse({
      addRequestedItems: [
        { name: '牛排' },
        { required: true },
      ],
      reason: '追加菜品',
    })).toThrow();

    expect(() => GoalPatchSchema.parse({
      replacePrimaryKeywords: ['牛排', 42],
      addConstraints: {
        kind: 'distance',
        maxMeters: 500,
        strict: true,
      },
      reason: '替换目标并增加距离限制',
    })).toThrow();
  });

  it('rejects malformed executable clarification effects instead of keeping inert options', () => {
    expect(() => GoalUnderstandingOutputSchema.parse({
      question: {
        question: '你想吃牛排还是日料？',
        options: ['牛排', '日料'],
        optionEffects: {
          牛排: {
            addRequestedItems: [
              { name: '牛排' },
              { required: true },
            ],
          },
        },
      },
    })).toThrow();
  });

  it('rejects malformed hard-constraint fields instead of silently dropping them', () => {
    expect(() => UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '500米内，不要川菜',
      hardConstraints: [{
        kind: 'distance',
        label: '500米内',
        maxMeters: 'not-a-number',
        strict: true,
      }],
    })).toThrow();

    expect(() => UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: '不要川菜',
      hardConstraints: [{
        kind: 'exclude_category',
        label: '排除川菜',
        values: ['川菜', 42],
        strict: true,
      }],
    })).toThrow();
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

  });

  it('tolerates common scalar fields in action and plan outputs', () => {
    const plan = SearchPlanSchema.parse({
      keywords: '日料',
      radiusMeters: '1800',
      searchIntent: 'exact',
      allowedForPrimary: 'true',
      reason: null,
    });
    expect(plan).toEqual({
      keywords: ['日料'],
      radiusMeters: 1800,
      searchIntent: 'exact',
      allowedForPrimary: true,
      reason: '根据用户目标搜索。',
    });

    const action = AgentActionSchema.parse({
      type: 'finish',
      selectedIds: 'r1',
      candidateIds: null,
      confidence: '0.75',
      explanation: null,
    });
    expect(action).toEqual(expect.objectContaining({
      type: 'finish',
      selectedIds: ['r1'],
      explanation: '已完成当前推荐。',
      confidence: 0.75,
    }));
    if (action.type === 'finish') {
      expect(action.candidateIds).toBeUndefined();
    }
  });

  it('repairs blank or missing pending questions from model output', () => {
    const supervisorOutput = GoalUnderstandingOutputSchema.parse({
      question: {
        reason: '',
        question: '   ',
      },
      nextAction: 'ask_user',
    });

    expect(supervisorOutput.question).toEqual({
      question: '你想找哪类餐厅，或具体想吃什么？',
      allowFreeText: true,
    });

    const action = AgentActionSchema.parse({
      type: 'ask_user',
      question: {
        question: '',
      },
    });

    expect(action).toEqual({
      type: 'ask_user',
      question: {
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      },
    });

    expect(GoalUnderstandingOutputSchema.parse({
      question: {
        reason: '用户需求缺少明确餐饮目标。',
      },
      nextAction: 'ask_user',
    }).question).toEqual({
      reason: '用户需求缺少明确餐饮目标。',
      question: '你想找哪类餐厅，或具体想吃什么？',
      allowFreeText: true,
    });
  });

  it('tolerates common scalar fields in keyword expansion output', () => {
    const parsed = KeywordExpansionOutputSchema.parse({
      relatedKeywords: '寿司',
      broadenedKeywords: null,
      relatedTargets: {
        keyword: '刺身',
        poiTypes: '050202|050203',
        confidence: '0.9',
        reason: null,
      },
      broadenedTargets: '居酒屋',
      rationale: null,
    });

    expect(parsed.relatedKeywords).toEqual(['寿司']);
    expect(parsed.broadenedKeywords).toEqual([]);
    expect(parsed.relatedTargets[0]).toEqual(expect.objectContaining({
      keyword: '刺身',
      poiTypes: ['050202', '050203'],
      confidence: 0.9,
    }));
    expect(parsed.broadenedTargets[0]).toEqual(expect.objectContaining({
      keyword: '居酒屋',
      confidence: 0.5,
    }));
    expect(parsed.rationale).toBe('根据用户目标生成搜索联想词。');
  });

  it('defaults non-critical evaluation output fields', () => {
    const parsed = EvaluationModelOutputSchema.parse({
      verdicts: [{
        restaurantId: 'r1',
        status: 'passed',
      }],
    });

    expect(parsed.selectedIds).toEqual([]);
    expect(parsed.candidateIds).toEqual([]);
    expect(parsed.explanation).toBe('已完成候选评估。');
    expect(parsed.verdicts[0]).toEqual(expect.objectContaining({
      primaryEligible: false,
      confidence: 0.5,
    }));
    expect(parsed.verdicts[0].matchedItems).toEqual([]);
  });

  it('tolerates common malformed evaluation output fields', () => {
    const parsed = EvaluationModelOutputSchema.parse({
      verdicts: [
        {
          id: 'r1',
          status: 'passed',
          primaryEligible: 'true',
          confidence: '0.85',
          matchedItems: '牛排',
          matchedCategories: '西餐',
        },
        {
          status: 'passed',
          confidence: 0.9,
        },
      ],
      selectedIds: 'r1',
      candidateIds: null,
      explanation: null,
      unmetConstraints: '部分字段由 schema 容错默认。',
    });

    expect(parsed.verdicts).toHaveLength(1);
    expect(parsed.verdicts[0]).toEqual(expect.objectContaining({
      restaurantId: 'r1',
      primaryEligible: true,
      confidence: 0.85,
      matchedItems: ['牛排'],
      matchedCategories: ['西餐'],
    }));
    expect(parsed.selectedIds).toEqual(['r1']);
    expect(parsed.candidateIds).toEqual([]);
    expect(parsed.explanation).toBe('已完成候选评估。');
    expect(parsed.unmetConstraints).toEqual(['部分字段由 schema 容错默认。']);
  });
});
