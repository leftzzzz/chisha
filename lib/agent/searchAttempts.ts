/**
 * 搜索历史的只读查询。
 *
 * 规则层：同样的输入永远给同样的答案，不含语义判断，也不决定下一步。
 * guards 与 orchestrator/policy 都要问"这个词/这个计划试过没有"，
 * 放在这里可以避免规则层反向依赖编排层。
 */

import { normalizeSearchKeywords } from './poiTaxonomy';
import type { PolicyContext, SearchAttempt, SearchPlan } from './types';

export function searchPlanKey(plan: SearchPlan): string {
  return searchKey(plan.keywords, plan.radiusMeters, plan.poiType);
}

export function searchAttemptKey(attempt: SearchAttempt): string {
  return searchKey(attempt.keywords, attempt.radius, attempt.poiType);
}

export function hasTriedPlan(ctx: PolicyContext, plan: SearchPlan): boolean {
  const key = searchPlanKey(plan);
  return ctx.attempts.some(
    (attempt) =>
      `${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}` === key
  );
}

function searchKey(keywords: string[], radiusMeters: number, poiType?: string): string {
  return `${keywords.join('|')}:${radiusMeters}:${poiType ?? ''}`;
}

export function hasTriedKeyword(ctx: PolicyContext, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return ctx.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

export function hasTriedIntent(ctx: PolicyContext, intent: SearchPlan['searchIntent']): boolean {
  return ctx.attempts.some((attempt) => attempt.searchIntent === intent);
}
