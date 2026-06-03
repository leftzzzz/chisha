import { logger } from '@/lib/logger';
import {
  callJsonFunctionAgent,
  JSON_FUNCTION_MAX_TOKENS,
  JSON_FUNCTION_RETRY_MAX_TOKENS,
} from '../modelClient';
import {
  expandPoiSearchKeywords,
  isGenericSearchKeyword,
  lookupFoodPoiTypes,
  normalizeSearchKeywords,
} from '../poiTaxonomy';
import { AMAP_FOOD_POI_TYPES, getAmapFoodPoiType } from '../amapPoiTypeCatalog';
import { KeywordExpansionOutputSchema } from '../schemas/keywordExpansion';
import type { SearchAttempt, SearchKeywordTarget, UserGoal, UserPreferenceSummary } from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const KEYWORD_EXPANSION_TIMEOUT = 60000;
const KEYWORD_EXPANSION_MAX_TOKENS = JSON_FUNCTION_MAX_TOKENS;
const KEYWORD_EXPANSION_RETRY_MAX_TOKENS = JSON_FUNCTION_RETRY_MAX_TOKENS;
const KEYWORD_EXPANSION_LIMIT = 3;
const OPEN_EXPLORATION_FALLBACK_TARGETS: SearchKeywordTarget[] = [
  { keyword: '小吃', poiTypes: ['050310'], confidence: 0.7 },
  { keyword: '中餐', poiTypes: ['050100'], confidence: 0.65 },
  { keyword: '快餐', poiTypes: ['050300'], confidence: 0.62 },
];
const OPEN_EXPLORATION_DEMOTED_KEYWORDS = new Set([
  '日料',
  '日本料理',
  '日本菜',
  '寿司',
  '刺身',
  '拉面',
  '日式拉面',
  '居酒屋',
]);

export interface KeywordExpansionAgentInput {
  goal: UserGoal;
  attempts: SearchAttempt[];
  preferenceSummary?: UserPreferenceSummary;
}

export interface KeywordExpansionOutput {
  relatedKeywords: string[];
  broadenedKeywords: string[];
  relatedTargets?: SearchKeywordTarget[];
  broadenedTargets?: SearchKeywordTarget[];
  rationale: string;
}

const SYSTEM_PROMPT = `你是餐厅搜索系统的 KeywordExpansionAgent。你负责为已结构化的 UserGoal 生成高德 POI keyword，并为每个 keyword 建议匹配的官方餐饮 POI typecode；不调用外部工具。

规则：
1. primarySearchTargets 有值时，只能从其中的正向餐饮目标生成联想词。
1a. primarySearchTargets 为空且 openExplorationAllowed=false 时，relatedTargets 和 broadenedTargets 必须都为空。
1b. primarySearchTargets 为空且 openExplorationAllowed=true 时，表示用户明确授权开放推荐；relatedTargets 必须为空，broadenedTargets 可生成 1-3 个多样、具体、可单独用于高德 keywords 的餐饮探索词。
2. relatedKeywords 是同一用户目标下的同义词、常见叫法、代表菜品或更容易命中 POI 的单个餐饮意图词。
3. broadenedKeywords 是结果不足时才尝试的相邻大类或兼容品类。
4. primarySearchTargets 有值时，rawQuery、hardConstraints、softPreferences、exclusions、allowBroaden 只能作为边界和排除依据，不能作为生成关键词的来源；openExplorationAllowed=true 时，可结合 rawQuery、softPreferences、preferenceSummary 生成开放探索词。
5. 否定条件、口味限制、开放授权、体验偏好不能转写成搜索词；不要把“不辣/少辣/清淡/都可以/随便”等非餐饮目标当成高德 keywords。
6. 如果用户只有排除项、约束或软偏好且没有开放推荐授权，不要猜测餐饮品类，输出空数组。
7. 每个 target.keyword 必须能单独作为高德 keywords 使用，例如“寿司”“刺身”“居酒屋”；不要输出整句，不要用“|”“、”“或者”合并多个意图。
8. 每个 target.poiTypes 必须只从 foodPoiTypes 输入表里选，且必须匹配当前 keyword；不确定时返回空数组，不要给不匹配窄类型。
9. 多个 keyword 不共享 poiTypes；例如“日料、韩餐、东南亚菜”必须分别给 Japanese/Korean/Thai-Vietnamese 或 Other Asian 等对应 typecode。
10. 不要重复 primaryKeywords、已尝试 keywords、排除项，也不要输出非餐饮词、体验偏好或无法用于 POI 搜索的形容词。
11. 用户没有 allowBroaden 时仍可输出 broadenedTargets，但它们只能作为候补搜索，不能自动进入主推荐。
12. 每个数组最多输出 3 个 target；结合用户具体上下文生成，不要机械套用固定词表。
13. 为兼容旧调用，同时填写 relatedKeywords/broadenedKeywords，值必须等于对应 targets 的 keyword 列表。`;

const KEYWORD_EXPANSION_FUNCTION = {
  name: 'expandRestaurantSearchKeywords',
  description: 'Generate dynamic restaurant-search keyword expansions for a structured UserGoal.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      relatedTargets: {
        type: 'array',
        description: '同义词、常见叫法、代表菜品或更容易命中 POI 的单意图搜索目标，最多 3 个。',
        items: keywordTargetJsonSchema(),
      },
      broadenedTargets: {
        type: 'array',
        description: '结果不足时才尝试的相邻品类或更宽泛搜索目标，最多 3 个。',
        items: keywordTargetJsonSchema(),
      },
      relatedKeywords: { type: 'array', items: { type: 'string' } },
      broadenedKeywords: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
    },
    required: ['relatedTargets', 'broadenedTargets', 'rationale'],
  },
};

function keywordTargetJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      keyword: { type: 'string' },
      poiTypes: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['keyword', 'poiTypes'],
  };
}

export async function runKeywordExpansionAgent(
  input: KeywordExpansionAgentInput
): Promise<KeywordExpansionOutput> {
  if (goalKeywords(input.goal).length === 0 && !isOpenExplorationGoal(input.goal)) {
    return {
      relatedKeywords: [],
      broadenedKeywords: [],
      relatedTargets: [],
      broadenedTargets: [],
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
  const relatedTargets = expansion.relatedTargets
    ?? expansion.relatedKeywords.map((keyword) => buildTarget(keyword));
  const broadenedTargets = expansion.broadenedTargets
    ?? expansion.broadenedKeywords.map((keyword) => buildTarget(keyword));

  return {
    ...goal,
    relatedKeywords: mergeKeywords(goal.relatedKeywords, expansion.relatedKeywords)
      .filter((keyword) => !goal.primaryKeywords.includes(keyword))
      .slice(0, KEYWORD_EXPANSION_LIMIT),
    broadenedKeywords: mergeKeywords(goal.broadenedKeywords, expansion.broadenedKeywords)
      .filter((keyword) => !goal.primaryKeywords.includes(keyword))
      .slice(0, KEYWORD_EXPANSION_LIMIT),
    relatedTargets: mergeTargets(goal.relatedTargets ?? [], relatedTargets, goal)
      .filter((target) => !goal.primaryKeywords.includes(target.keyword))
      .slice(0, KEYWORD_EXPANSION_LIMIT),
    broadenedTargets: mergeTargets(goal.broadenedTargets ?? [], broadenedTargets, goal)
      .filter((target) => !goal.primaryKeywords.includes(target.keyword))
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
    maxTokens: KEYWORD_EXPANSION_MAX_TOKENS,
    retryMaxTokens: KEYWORD_EXPANSION_RETRY_MAX_TOKENS,
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
    foodPoiTypes: AMAP_FOOD_POI_TYPES,
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
  const relatedTargets = allowsRelatedKeywords
    ? sanitizeTargets(expansion.relatedTargets, expansion.relatedKeywords, blockedKeywords).slice(0, KEYWORD_EXPANSION_LIMIT)
    : [];
  const broadenedTargets = sanitizeTargets(expansion.broadenedTargets, expansion.broadenedKeywords, blockedKeywords)
    .slice(0, KEYWORD_EXPANSION_LIMIT);
  const relatedKeywords = allowsRelatedKeywords
    ? sanitizeKeywords(expansion.relatedKeywords ?? [], blockedKeywords).slice(0, KEYWORD_EXPANSION_LIMIT)
    : [];
  const broadenedKeywords = sanitizeKeywords(expansion.broadenedKeywords ?? [], blockedKeywords)
    .slice(0, KEYWORD_EXPANSION_LIMIT);
  const normalizedRelatedTargets = relatedTargets.length > 0
    ? relatedTargets
    : relatedKeywords.map((keyword) => buildTarget(keyword));
  const normalizedBroadenedTargets = broadenedTargets.length > 0
    ? broadenedTargets
    : broadenedKeywords.map((keyword) => buildTarget(keyword));
  const stableBroadenedTargets = isOpenExplorationGoal(goal)
    ? stabilizeOpenExplorationTargets(normalizedBroadenedTargets, attempts)
    : normalizedBroadenedTargets;

  return KeywordExpansionOutputSchema.parse({
    relatedTargets: normalizedRelatedTargets,
    broadenedTargets: stableBroadenedTargets,
    relatedKeywords: normalizedRelatedTargets.map((target) => target.keyword),
    broadenedKeywords: stableBroadenedTargets.map((target) => target.keyword),
    rationale: expansion.rationale || '根据用户目标生成搜索联想词。',
  });
}

function stabilizeOpenExplorationTargets(
  targets: SearchKeywordTarget[],
  attempts: SearchAttempt[]
): SearchKeywordTarget[] {
  const attemptedKeywords = new Set(
    attempts.flatMap((attempt) => normalizeSearchKeywords(attempt.keywords))
  );
  const seen = new Set<string>();
  const preferred: SearchKeywordTarget[] = [];
  const demoted: SearchKeywordTarget[] = [];

  for (const target of targets) {
    const [keyword] = normalizeSearchKeywords([target.keyword]);
    if (!keyword || attemptedKeywords.has(keyword) || seen.has(keyword)) {
      continue;
    }

    seen.add(keyword);
    const normalizedTarget = buildTarget(keyword, target);
    if (isDemotedOpenExplorationKeyword(keyword)) {
      demoted.push(normalizedTarget);
    } else {
      preferred.push(normalizedTarget);
    }
  }

  const fallbackTargets = OPEN_EXPLORATION_FALLBACK_TARGETS
    .map((target) => buildTarget(target.keyword, target))
    .filter((target) => !attemptedKeywords.has(target.keyword))
    .filter((target) => !seen.has(target.keyword));

  return [
    ...preferred,
    ...fallbackTargets,
    ...demoted,
  ].slice(0, KEYWORD_EXPANSION_LIMIT);
}

function isDemotedOpenExplorationKeyword(keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return normalizedKeywords.some((normalizedKeyword) =>
    OPEN_EXPLORATION_DEMOTED_KEYWORDS.has(normalizedKeyword)
  );
}

function sanitizeTargets(
  targets: SearchKeywordTarget[] | undefined,
  fallbackKeywords: string[] | undefined,
  blockedKeywords: Set<string>
): SearchKeywordTarget[] {
  const rawTargets = targets && targets.length > 0
    ? targets
    : (fallbackKeywords ?? []).map((keyword) => ({ keyword }));
  const seen = new Set<string>();
  const sanitized: SearchKeywordTarget[] = [];

  for (const target of rawTargets) {
    const [keyword] = sanitizeKeywords([target.keyword], blockedKeywords);
    if (!keyword || seen.has(keyword)) {
      continue;
    }
    seen.add(keyword);
    sanitized.push(buildTarget(keyword, target));
  }

  return sanitized;
}

function buildTarget(keyword: string, target: Partial<SearchKeywordTarget> = {}): SearchKeywordTarget {
  const sanitizedPoiTypes = sanitizePoiTypes(target.poiTypes);
  const taxonomyPoiTypes = lookupFoodPoiTypes(keyword)?.split('|') ?? [];
  const poiTypes = (sanitizedPoiTypes.length > 0 ? sanitizedPoiTypes : taxonomyPoiTypes)
    .filter((code) => Boolean(getAmapFoodPoiType(code)));

  return {
    keyword,
    poiTypes,
    confidence: typeof target.confidence === 'number'
      ? Math.max(0, Math.min(1, target.confidence))
      : (poiTypes.length > 0 ? 0.55 : 0.45),
    reason: target.reason,
  };
}

function sanitizePoiTypes(poiTypes: string[] | undefined): string[] {
  return Array.from(new Set(poiTypes ?? []))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== '050000')
    .slice(0, 5);
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

function mergeTargets(
  left: SearchKeywordTarget[],
  right: SearchKeywordTarget[],
  goal: UserGoal
): SearchKeywordTarget[] {
  const merged = new Map<string, SearchKeywordTarget>();

  for (const target of [...left, ...right]) {
    const [keyword] = normalizeSearchKeywords([target.keyword]);
    if (!keyword || goal.exclusions.includes(keyword)) {
      continue;
    }
    const current = merged.get(keyword);
    if (!current || (target.confidence ?? 0) > (current.confidence ?? 0)) {
      merged.set(keyword, buildTarget(keyword, target));
    }
  }

  return Array.from(merged.values());
}
