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
import type { MetricsSink } from '../metrics';
import type { SearchAttempt, SearchKeywordTarget, UserGoal, UserPreferenceSummary } from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL_KEYWORD
  || process.env.OPENAI_MODEL
  || 'deepseek-v4-flash-0731';
const KEYWORD_EXPANSION_TIMEOUT = 60000;
const KEYWORD_EXPANSION_MAX_TOKENS = JSON_FUNCTION_MAX_TOKENS;
const KEYWORD_EXPANSION_RETRY_MAX_TOKENS = JSON_FUNCTION_RETRY_MAX_TOKENS;
const KEYWORD_EXPANSION_LIMIT = 3;

export interface KeywordExpansionAgentInput {
  metricsSink?: MetricsSink;
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

const SYSTEM_PROMPT = `你是餐厅搜索系统的 KeywordExpansionAgent。你为一个已结构化的搜索目标生成高德 POI keyword，并为每个 keyword 建议匹配的官方餐饮 POI typecode；不调用外部工具，也不决定搜索流程。

trustedContext.mode 决定你这次要做什么，只有两种：

【mode=expand_targets】targets 里是用户明确想吃的东西。
- relatedTargets：同一目标下的同义词、常见叫法、代表菜品，或更容易命中 POI 的单个餐饮意图词。
- broadenedTargets：结果不足时才尝试的相邻大类或兼容品类。
- constraints 与 openContext 只能作为排除依据，不能作为生成关键词的来源。

【mode=open_exploration】用户没有指定目标，希望你给方向。
- relatedTargets 必须为空。
- broadenedTargets 给 1-3 个多样、具体、可单独用于高德 keywords 的餐饮探索方向。
- 可以结合 openContext 的 rawQuery、softPreferences、preferenceSummary 判断方向，但这些本身不是搜索词。
- 方向之间要拉开差距，不要给三个同属一类的词。

通用规则：
1. 每个 target.keyword 必须能单独作为高德 keywords 使用，例如“寿司”“刺身”“居酒屋”；不要输出整句，不要用“|”“、”“或者”合并多个意图。
2. 否定条件、口味限制、体验偏好不能转写成搜索词；不要把“不辣/少辣/清淡/都可以/随便”当成高德 keywords。
3. 每个 target.poiTypes 必须只从 foodPoiTypes 输入表里选，且必须匹配当前 keyword；不确定时返回空数组，不要给不匹配的窄类型。
4. 多个 keyword 不共享 poiTypes；例如“日料、韩餐、东南亚菜”必须分别给 Japanese/Korean/Thai-Vietnamese 或 Other Asian 等对应 typecode。
5. 不要重复 targets、alreadyTried 里的词或 constraints.exclusions，也不要输出非餐饮词或无法用于 POI 搜索的形容词。
6. 每个数组最多输出 3 个 target；结合当前上下文生成，不要机械套用固定词表。
7. 为兼容旧调用，同时填写 relatedKeywords/broadenedKeywords，值必须等于对应 targets 的 keyword 列表。`;

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

  // 显式的确定性路径：测试开关或压根没配 key。这不是"降级"，是另一条明路。
  if (!OPENAI_API_KEY || process.env.AGENT_DETERMINISTIC === '1') {
    return deterministicKeywordExpansion(input.goal, input.attempts);
  }

  // 模型挂了就报错，不静默换本地词表。静默降级会让"模型不可用"这个事实对
  // 运维完全不可见——上一次线上事故正是这样被掩盖了两天。
  return sanitizeExpansion(await callKeywordExpansionModel(input), input.goal, input.attempts);
}

export function deterministicKeywordExpansion(
  goal: UserGoal,
  attempts: SearchAttempt[] = []
): KeywordExpansionOutput {
  const seeds = goalKeywords(goal);
  const expansion = expandPoiSearchKeywords(seeds);
  return {
    ...sanitizeExpansion(expansion, goal, attempts),
    rationale: 'KeywordExpansionAgent 走确定性 taxonomy 生成搜索联想词。',
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
    metricsSink: input.metricsSink,
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

/**
 * 只给联想词生成真正需要的东西。
 *
 * `mode` 由编排层算好后显式传入，取代此前"给模型 authorizations 和
 * allowBroaden，让它自己推断当前处于哪个阶段"的做法——那是在请子 Agent
 * 参与编排。软偏好只在开放探索时才有意义（那时它是唯一的方向线索），
 * 有明确目标时传进去只会诱导模型把"清淡""便宜"当成搜索词。
 */
function buildModelInput(input: KeywordExpansionAgentInput) {
  const targets = goalKeywords(input.goal);
  const openExploration = isOpenExplorationGoal(input.goal);

  return {
    trustedContext: {
      mode: openExploration ? 'open_exploration' : 'expand_targets',
      targets,
      openContext: openExploration
        ? {
            rawQuery: input.goal.rawQuery,
            softPreferences: input.goal.softPreferences,
            preferenceSummary: input.preferenceSummary,
          }
        : undefined,
      constraints: {
        hardConstraints: input.goal.hardConstraints,
        exclusions: input.goal.exclusions,
      },
      alreadyTried: normalizeSearchKeywords(
        input.attempts.flatMap((attempt) => attempt.keywords)
      ),
    },
    policy: {
      foodPoiTypes: AMAP_FOOD_POI_TYPES,
      generatedKeywordsMustBeSingleSearchIntent: true,
    },
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
    ? dropAttemptedTargets(normalizedBroadenedTargets, attempts)
    : normalizedBroadenedTargets;

  return KeywordExpansionOutputSchema.parse({
    relatedTargets: normalizedRelatedTargets,
    broadenedTargets: stableBroadenedTargets,
    relatedKeywords: normalizedRelatedTargets.map((target) => target.keyword),
    broadenedKeywords: stableBroadenedTargets.map((target) => target.keyword),
    rationale: expansion.rationale || '根据用户目标生成搜索联想词。',
  });
}

/**
 * 开放探索时去掉已经搜过的方向。
 *
 * 此前这里还会把 [小吃, 中餐, 快餐] 无条件补进模型输出，并把日料相关的 8 个词
 * 强制降权。两者都是无语义依据地指定搜索方向——拿常量冒充判断，正是
 * CLAUDE.md 明令禁止的那类兜底。方向该由模型给，给不出就报错。
 */
function dropAttemptedTargets(
  targets: SearchKeywordTarget[],
  attempts: SearchAttempt[]
): SearchKeywordTarget[] {
  const attemptedKeywords = new Set(
    attempts.flatMap((attempt) => normalizeSearchKeywords(attempt.keywords))
  );
  const seen = new Set<string>();
  const kept: SearchKeywordTarget[] = [];

  for (const target of targets) {
    const [keyword] = normalizeSearchKeywords([target.keyword]);
    if (!keyword || attemptedKeywords.has(keyword) || seen.has(keyword)) {
      continue;
    }

    seen.add(keyword);
    kept.push(buildTarget(keyword, target));
  }

  return kept.slice(0, KEYWORD_EXPANSION_LIMIT);
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
