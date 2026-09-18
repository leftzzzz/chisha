/**
 * 候选排序不再受模型的全局选择影响。
 *
 * 背景：EvaluationModel 曾被要求输出 selectedIds，而它是**分批**调用的
 * （每批 6 家），也就是让一个只有局部视野的模型角色 做全局选择，结果再被
 * 机械合并。这些 id 还真的生效——命中就 +30 分。阶段 4 把选择权收回确定性规则。
 */

import { evaluateSearchResult } from '@/lib/agent/evaluator';
import { applyFinalGuard } from '@/lib/agent/finalGuard';
import { withUpdatedGoalVersion } from '@/lib/agent/goalVersion';
import { EvaluationModelOutputSchema } from '@/lib/agent/schemas/verdict';
import type {
  AgentContext,
  EvaluationModelOutput,
  SearchPlan,
  UserGoal,
} from '@/lib/agent/types';
import type { Restaurant } from '@/types';

const location = { lat: 30.2794, lng: 120.1305 };

function goal(): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '想吃火锅',
    requestedItems: [],
    acceptableCategories: [{ name: '火锅', confidence: 0.9 }],
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
  };
}

function context(): AgentContext {
  return {
    query: '想吃火锅',
    location,
    goal: withUpdatedGoalVersion(goal()),
    attempts: [],
    candidates: [],
    unmetConstraints: [],
    maxSteps: 8,
    maxSearchCalls: 4,
    targetCount: 8,
  } as AgentContext;
}

const plan: SearchPlan = {
  keywords: ['火锅'],
  radiusMeters: 1800,
  searchIntent: 'exact',
  allowedForPrimary: true,
  reason: '先搜索用户明确表达的餐饮目标。',
  planId: 'plan_1',
};

function restaurant(id: string, distance: number): Restaurant {
  return {
    id,
    name: `${id}火锅`,
    cuisineType: '火锅',
    address: '测试地址',
    distance,
    location,
    source: 'amap',
  };
}

function verdict(restaurantId: string, confidence: number) {
  return {
    restaurantId,
    status: 'passed' as const,
    primaryEligible: true,
    confidence,
    matchedItems: [],
    matchedCategories: ['火锅'],
    conflicts: [],
    evidence: [`「${restaurantId}」符合搜索意图。`],
    warnings: [],
  };
}

function evaluation(overrides: Partial<EvaluationModelOutput> = {}): EvaluationModelOutput {
  return {
    verdicts: [verdict('high', 0.9), verdict('low', 0.4)],
    selectedIds: [],
    candidateIds: [],
    explanation: '',
    unmetConstraints: [],
    source: 'model',
    ...overrides,
  };
}

describe('候选排序', () => {
  const restaurants = [restaurant('high', 500), restaurant('low', 500)];

  it.each(['name', 'llm_semantic'] as const)(
    'rejects legacy %s matches without references through the publication pipeline', (matchedBy) => {
      const ctx = context();
      ctx.goal.alternativeGroups = [{ mode: 'all_of', items: ['火锅'] }];
      ctx.attempts = [{
        keywords: plan.keywords, radius: plan.radiusMeters, searchIntent: 'exact',
        allowedForPrimary: true, reason: plan.reason, found: 1, accepted: 1,
      }];
      const output = EvaluationModelOutputSchema.parse(evaluation({
        verdicts: [{ ...verdict('high', 1), matchedItems: ['火锅'] }],
      }));
      ctx.candidates = evaluateSearchResult([restaurants[0]], ctx, plan, 1, output).acceptedCandidates;
      ctx.candidates[0].verification.itemMatches[0].matchedBy = matchedBy;
      const restored = JSON.parse(JSON.stringify(ctx)) as AgentContext;
      expect(restored.candidates[0].verification.targetEvidence).toBeUndefined();
      const guarded = applyFinalGuard(restored, {
        selectedIds: ['high'], candidateIds: [], explanation: 'proposal', confidence: 1,
      });
      expect(guarded.verdict).toBe('rejected');
      expect(guarded.primaryCandidates).toEqual([]);
      expect(guarded.backupCandidates).toEqual(restored.candidates);
      expect(guarded.violations).toEqual([expect.objectContaining({
        code: 'REQUIRED_ITEM_UNSUPPORTED', disposition: 'backup',
      })]);
      expect(restored.candidates[0].verification.status).toBe('passed');
    }
  );

  it('preserves model fact references through parsing, evaluation and session roundtrip', () => {
    const facts = restaurant('high', 500);
    const ctx = context();
    ctx.goal.alternativeGroups = [{ mode: 'all_of', items: ['火锅'] }];
    ctx.attempts = [{
      keywords: plan.keywords, radius: plan.radiusMeters, searchIntent: 'exact',
      allowedForPrimary: true, reason: plan.reason, found: 1, accepted: 1,
    }];
    const targetEvidence = [{
      target: '火锅', kind: 'category' as const,
      verdict: 'supported' as const,
      observationRef: 'plan-1',
      references: [{ restaurantId: facts.id, field: 'cuisineType' as const, value: facts.cuisineType }],
    }];
    const output = EvaluationModelOutputSchema.parse(evaluation({
      verdicts: [{ ...verdict('high', 0.9), targetEvidence }],
    }));
    ctx.observations = [{
      actionId: 'action-1', plan: { ...plan, planId: 'plan-1' },
      goalId: ctx.goal.goalId,
      goalVersion: ctx.goal.goalVersion,
      goalSignature: ctx.goal.goalSignature,
      provider: facts.source, fetchedAt: 1_800_000_000_000,
      facts: [{ id: facts.id, source: facts.source, name: facts.name, cuisineType: facts.cuisineType }],
      rawCount: 1, hardRejected: [], verdicts: output.verdicts,
      acceptedPrimaryIds: [], candidateIds: [facts.id], unmetConstraints: [],
    }];
    ctx.candidates = evaluateSearchResult([facts], ctx, plan, 1, output).acceptedCandidates;
    expect(ctx.candidates[0].verification.targetEvidence).toEqual(targetEvidence);
    const restored = JSON.parse(JSON.stringify(ctx)) as AgentContext;
    expect(applyFinalGuard(restored).primaryCandidates).toHaveLength(1);
    restored.candidates[0].restaurant.cuisineType = '餐饮';
    expect(applyFinalGuard(restored).primaryCandidates).toHaveLength(0);
    expect(restored.candidates[0].verification.status).toBe('passed');
  });

  it('does not derive references from matching words or tolerate malformed references', () => {
    const output = evaluation({ verdicts: [{ ...verdict('high', 0.9), matchedItems: ['火锅'] }] });
    const candidate = evaluateSearchResult(restaurants, context(), plan, 1, output).acceptedCandidates[0];
    expect(candidate.verification.targetEvidence).toBeUndefined();
    expect(candidate.verification.itemMatches[0].matchedBy).toBe('llm_semantic');
    const malformed = EvaluationModelOutputSchema.parse({
      ...output, verdicts: [{ ...output.verdicts[0], targetEvidence: [{
        target: '火锅', kind: 'item', references: [],
      }] }],
    });
    expect(malformed.verdicts[0].targetEvidence).toBeUndefined();
    expect(malformed.verdicts).toHaveLength(1);
  });

  it('保留 Provider 顺序，且不受模型是否"选中"影响', () => {
    const withoutSelection = evaluateSearchResult(
      restaurants, context(), plan, 1, evaluation()
    );
    // EvaluationModel 只裁决资格，排序由后续 Policy 在合格集合内完成。
    const withSelection = evaluateSearchResult(
      restaurants, context(), plan, 1, evaluation({ selectedIds: ['low'] })
    );

    expect(withoutSelection.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['high', 'low']);
    expect(withSelection.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['high', 'low']);
    expect(withSelection.acceptedCandidates.map((c) => c.score))
      .toEqual(withoutSelection.acceptedCandidates.map((c) => c.score));
  });

  it('相同输入必得相同分数，顺序完全可复现', () => {
    const first = evaluateSearchResult(restaurants, context(), plan, 1, evaluation());
    const second = evaluateSearchResult(restaurants, context(), plan, 1, evaluation());

    expect(first.acceptedCandidates.map((c) => [c.restaurant.id, c.score]))
      .toEqual(second.acceptedCandidates.map((c) => [c.restaurant.id, c.score]));
  });

  it('把距离写入确定性效用，但不在评估层重排', () => {
    const near = restaurant('near', 200);
    const far = restaurant('far', 3000);
    const observation = evaluateSearchResult(
      [far, near],
      context(),
      plan,
      1,
      evaluation({ verdicts: [verdict('far', 0.8), verdict('near', 0.8)] })
    );

    expect(observation.acceptedCandidates.map((c) => c.restaurant.id))
      .toEqual(['far', 'near']);
    expect(observation.acceptedCandidates[1].score)
      .toBeGreaterThan(observation.acceptedCandidates[0].score);
  });
});
