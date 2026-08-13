import { deriveGoalSignature, withUpdatedGoalVersion } from '@/lib/agent/goalVersion';
import { applyKeywordExpansion } from '@/lib/agent/subagents/keywordExpansionAgent';
import type { UserGoal } from '@/lib/agent/types';

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return withUpdatedGoalVersion({
    intent: 'find_restaurants',
    rawQuery: '想吃火锅',
    requestedItems: [{ name: '火锅', required: true, aliases: [] }],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: ['火锅'],
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
  });
}

/**
 * 首搜与 KeywordExpansion 并发的前提。
 *
 * 首批搜索在联想词返回前就发起，它产出的候选带着当时的 goalSignature。
 * 如果 applyKeywordExpansion 会改变签名，这些候选会在下一步被判为 stale，
 * 并发就成了净损失。这条断言把该前提锁死——它失败就必须退回串行。
 */
describe('applyKeywordExpansion 对目标签名的影响', () => {
  it('never changes the goal signature', () => {
    const base = goal();
    const before = deriveGoalSignature(base);

    const expanded = applyKeywordExpansion(base, {
      relatedKeywords: ['川菜', '麻辣烫'],
      broadenedKeywords: ['烧烤'],
      relatedTargets: [{ keyword: '川菜' }, { keyword: '麻辣烫' }],
      broadenedTargets: [{ keyword: '烧烤' }],
      rationale: 'test',
    });

    expect(deriveGoalSignature(expanded)).toBe(before);
    expect(expanded.relatedTargets?.map((target) => target.keyword)).toEqual(['川菜', '麻辣烫']);
  });

  it('never changes the goal version or id', () => {
    const base = goal();

    const expanded = applyKeywordExpansion(base, {
      relatedKeywords: ['川菜'],
      broadenedKeywords: [],
      relatedTargets: [{ keyword: '川菜' }],
      broadenedTargets: [],
      rationale: 'test',
    });

    expect(expanded.goalVersion).toBe(base.goalVersion);
    expect(expanded.goalId).toBe(base.goalId);
    expect(expanded.goalSignature).toBe(base.goalSignature);
  });

  it('still changes the signature when the primary target actually changes', () => {
    const before = deriveGoalSignature(goal());
    const after = deriveGoalSignature(goal({ primaryKeywords: ['日料'] }));

    expect(after).not.toBe(before);
  });
});
