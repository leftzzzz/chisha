import { logger } from '@/lib/logger';
import { callJsonFunctionAgent } from '../modelClient';
import { expandPoiSearchKeywords, isGenericSearchKeyword, normalizeSearchKeywords } from '../poiTaxonomy';
import { KeywordExpansionOutputSchema } from '../schemas/keywordExpansion';
import type { SearchAttempt, UserGoal, UserPreferenceSummary } from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const KEYWORD_EXPANSION_TIMEOUT = 60000;
const KEYWORD_EXPANSION_LIMIT = 3;

export interface KeywordExpansionAgentInput {
  goal: UserGoal;
  attempts: SearchAttempt[];
  preferenceSummary?: UserPreferenceSummary;
}

export interface KeywordExpansionOutput {
  relatedKeywords: string[];
  broadenedKeywords: string[];
  rationale: string;
}

const SYSTEM_PROMPT = `你是餐厅搜索系统的 KeywordExpansionAgent。你只负责为已结构化的 UserGoal 生成高德 POI keywords 搜索联想词，不调用外部工具。

规则：
1. primarySearchTargets 有值时，只能从其中的正向餐饮目标生成联想词。
1a. primarySearchTargets 为空且 openExplorationAllowed=false 时，relatedKeywords 和 broadenedKeywords 必须都为空。
1b. primarySearchTargets 为空且 openExplorationAllowed=true 时，表示用户明确授权开放推荐；relatedKeywords 必须为空，broadenedKeywords 可生成 1-3 个多样、具体、可单独用于高德 keywords 的餐饮探索词。
2. relatedKeywords 是同一用户目标下的同义词、常见叫法、代表菜品或更容易命中 POI 的单个餐饮意图词。
3. broadenedKeywords 是结果不足时才尝试的相邻大类或兼容品类。
4. primarySearchTargets 有值时，rawQuery、hardConstraints、softPreferences、exclusions、allowBroaden 只能作为边界和排除依据，不能作为生成关键词的来源；openExplorationAllowed=true 时，可结合 rawQuery、softPreferences、preferenceSummary 生成开放探索词。
5. 否定条件、口味限制、开放授权、体验偏好不能转写成搜索词；不要把“不辣/少辣/清淡/都可以/随便”等非餐饮目标当成高德 keywords。
6. 如果用户只有排除项、约束或软偏好且没有开放推荐授权，不要猜测餐饮品类，输出空数组。
7. 每个关键词必须能单独作为高德 keywords 使用，例如“寿司”“刺身”“居酒屋”；不要输出整句，不要用“|”“、”“或者”合并多个意图。
8. 不要重复 primaryKeywords、已尝试 keywords、排除项，也不要输出非餐饮词、体验偏好或无法用于 POI 搜索的形容词。
9. 用户没有 allowBroaden 时仍可输出 broadenedKeywords，但它们只能作为候补搜索，不能自动进入主推荐。
10. 每个数组最多输出 3 个关键词；结合用户具体上下文生成，不要机械套用固定词表。`;

const KEYWORD_EXPANSION_FUNCTION = {
  name: 'expandRestaurantSearchKeywords',
  description: 'Generate dynamic restaurant-search keyword expansions for a structured UserGoal.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      relatedKeywords: {
        type: 'array',
        description: '同义词、常见叫法、代表菜品或更容易命中 POI 的单意图搜索词，最多 3 个。',
        items: { type: 'string' },
      },
      broadenedKeywords: {
        type: 'array',
        description: '结果不足时才尝试的相邻品类或更宽泛目标，最多 3 个。',
        items: { type: 'string' },
      },
      rationale: { type: 'string' },
    },
    required: ['relatedKeywords', 'broadenedKeywords', 'rationale'],
  },
};

export async function runKeywordExpansionAgent(
  input: KeywordExpansionAgentInput
): Promise<KeywordExpansionOutput> {
  if (goalKeywords(input.goal).length === 0 && !isOpenExplorationGoal(input.goal)) {
    return {
      relatedKeywords: [],
      broadenedKeywords: [],
      rationale: '没有正向餐饮目标，KeywordExpansionAgent 不生成搜索联想词。',
    };
  }

  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicKeywordExpansion(input.goal, input.attempts);
  }

  try {
    return sanitizeExpansion(await callKeywordExpansionModel(input), input.goal, input.attempts);
  } catch (error) {
    logger.warn('KeywordExpansionAgent unavailable, using taxonomy fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicKeywordExpansion(input.goal, input.attempts);
  }
}

export function deterministicKeywordExpansion(
  goal: UserGoal,
  attempts: SearchAttempt[] = []
): KeywordExpansionOutput {
  const seeds = goalKeywords(goal);
  const expansion = expandPoiSearchKeywords(seeds);
  return {
    ...sanitizeExpansion(expansion, goal, attempts),
    rationale: 'KeywordExpansionAgent 降级为本地餐饮 taxonomy 生成搜索联想词。',
  };
}

export function applyKeywordExpansion(goal: UserGoal, expansion: KeywordExpansionOutput): UserGoal {
  return {
    ...goal,
    relatedKeywords: mergeKeywords(goal.relatedKeywords, expansion.relatedKeywords)
      .filter((keyword) => !goal.primaryKeywords.includes(keyword))
      .slice(0, KEYWORD_EXPANSION_LIMIT),
    broadenedKeywords: mergeKeywords(goal.broadenedKeywords, expansion.broadenedKeywords)
      .filter((keyword) => !goal.primaryKeywords.includes(keyword))
      .slice(0, KEYWORD_EXPANSION_LIMIT),
  };
}

async function callKeywordExpansionModel(
  input: KeywordExpansionAgentInput
): Promise<KeywordExpansionOutput> {
  return callJsonFunctionAgent({
    agentName: 'KeywordExpansionAgent',
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    input: buildModelInput(input),
    functionDefinition: KEYWORD_EXPANSION_FUNCTION,
    functionName: 'expandRestaurantSearchKeywords',
    schema: KeywordExpansionOutputSchema,
    temperature: 0.2,
    maxTokens: 700,
    timeoutMs: KEYWORD_EXPANSION_TIMEOUT,
  }) as Promise<KeywordExpansionOutput>;
}

function buildModelInput(input: KeywordExpansionAgentInput) {
  const primarySearchTargets = goalKeywords(input.goal);

  return {
    primarySearchTargets,
    openExplorationAllowed: isOpenExplorationGoal(input.goal),
    goalContext: {
      rawQuery: input.goal.rawQuery,
      requestedItems: input.goal.requestedItems,
      acceptableCategories: input.goal.acceptableCategories,
      alternativeGroups: input.goal.alternativeGroups,
      primaryKeywords: input.goal.primaryKeywords,
      hardConstraints: input.goal.hardConstraints,
      softPreferences: input.goal.softPreferences,
      exclusions: input.goal.exclusions,
      allowBroaden: input.goal.allowBroaden,
    },
    attemptedKeywords: input.attempts.flatMap((attempt) => attempt.keywords),
    preferenceSummary: input.preferenceSummary,
  };
}

function sanitizeExpansion(
  expansion: Partial<KeywordExpansionOutput>,
  goal: UserGoal,
  attempts: SearchAttempt[]
): KeywordExpansionOutput {
  const blockedKeywords = new Set([
    ...goal.primaryKeywords,
    ...goal.exclusions,
    ...attempts.flatMap((attempt) => attempt.keywords),
  ].map((keyword) => keyword.trim()).filter(Boolean));
  const allowsRelatedKeywords = goalKeywords(goal).length > 0;
  const relatedKeywords = allowsRelatedKeywords
    ? sanitizeKeywords(expansion.relatedKeywords ?? [], blockedKeywords).slice(0, KEYWORD_EXPANSION_LIMIT)
    : [];
  const broadenedKeywords = sanitizeKeywords(expansion.broadenedKeywords ?? [], blockedKeywords)
    .slice(0, KEYWORD_EXPANSION_LIMIT);

  return KeywordExpansionOutputSchema.parse({
    relatedKeywords,
    broadenedKeywords,
    rationale: expansion.rationale || '根据用户目标生成搜索联想词。',
  });
}

function sanitizeKeywords(keywords: string[], blockedKeywords: Set<string>): string[] {
  return normalizeSearchKeywords(keywords)
    .filter((keyword) =>
      !blockedKeywords.has(keyword)
      && !isGenericSearchKeyword(keyword)
      && !/[|｜、,，;；/／]|或者|还是|以及/.test(keyword)
    );
}

function goalKeywords(goal: UserGoal): string[] {
  return [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].filter(Boolean);
}

function isOpenExplorationGoal(goal: UserGoal): boolean {
  return goal.allowBroaden
    && goal.clarificationNeeded.length === 0
    && goalKeywords(goal).length === 0;
}

function mergeKeywords(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map((keyword) => keyword.trim()).filter(Boolean)));
}
