/**
 * 入口降级：Supervisor（需求理解）不可用时的兜底目标构造。
 *
 * 其余三个 Agent 都有确定性降级路径，唯独入口没有——一次模型抖动就会让
 * 整轮 SSE 直接报错。这里用原始 query 抽取餐饮词构造最小 UserGoal，
 * 让用户至少拿到"按原文搜索"的结果。
 *
 * 注意：降级只影响"理解"环节，不放宽任何硬约束，也不代替 EvaluationAgent
 * 做语义验证——候选仍需正常走验证与准入。
 */

import { UserGoalSchema } from './schemas/goal';
import { withUpdatedGoalVersion } from './goalVersion';
import { extractKnownFoodTerms, isGenericSearchKeyword } from './poiTaxonomy';
import type { UserGoal } from './types';

const DEGRADED_AMBIGUITY = '需求理解服务暂时不可用，已按原文关键词搜索。';

/**
 * 从原始 query 构造降级目标。
 *
 * @returns 抽不出任何餐饮词时返回 null，调用方应转为追问而不是报错。
 */
export function buildDegradedGoalFromQuery(query: string): UserGoal | null {
  const keywords = extractDegradedKeywords(query);
  if (keywords.length === 0) {
    return null;
  }

  return withUpdatedGoalVersion(
    UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: query.trim(),
      requestedItems: [],
      acceptableCategories: [],
      alternativeGroups: [],
      primaryKeywords: keywords,
      relatedKeywords: [],
      broadenedKeywords: [],
      relatedTargets: [],
      broadenedTargets: [],
      hardConstraints: [],
      softPreferences: [],
      exclusions: [],
      ambiguity: [DEGRADED_AMBIGUITY],
      clarificationNeeded: [],
      authorizations: [],
      allowBroaden: false,
    })
  );
}

/**
 * 连关键词都抽不出来时的空目标。
 *
 * 用于在理解服务不可用时仍然走正常的"暂停 + 追问"流程，
 * 而不是让整轮请求以 SSE error 结束。
 */
export function buildEmptyDegradedGoal(query: string): UserGoal {
  return withUpdatedGoalVersion(
    UserGoalSchema.parse({
      intent: 'find_restaurants',
      rawQuery: query.trim(),
      requestedItems: [],
      acceptableCategories: [],
      alternativeGroups: [],
      primaryKeywords: [],
      relatedKeywords: [],
      broadenedKeywords: [],
      relatedTargets: [],
      broadenedTargets: [],
      hardConstraints: [],
      softPreferences: [],
      exclusions: [],
      ambiguity: [DEGRADED_AMBIGUITY],
      clarificationNeeded: [],
      authorizations: [],
      allowBroaden: false,
    })
  );
}

export const DEGRADED_CLARIFYING_QUESTION = {
  reason: '需求理解服务暂时不可用，无法从这句话里识别出想吃的东西。',
  question: '想吃点什么？可以直接说菜品或菜系，例如「牛排」「川菜」。',
  allowFreeText: true,
} as const;

/**
 * 抽取降级搜索词。
 *
 * 只接受餐饮 taxonomy 能识别的词——降级时宁可追问，也不能把
 * "没有具体想吃的"这类句子片段当成搜索目标去搜。
 */
export function extractDegradedKeywords(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  return extractKnownFoodTerms(trimmed)
    .filter((keyword) => !isGenericSearchKeyword(keyword))
    .slice(0, 3);
}

export const DEGRADED_GOAL_NOTICE = DEGRADED_AMBIGUITY;
