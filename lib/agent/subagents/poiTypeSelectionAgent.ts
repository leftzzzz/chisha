import { z } from 'zod';
import { logger } from '@/lib/logger';
import { callJsonFunctionAgent } from '../modelClient';
import { AMAP_FOOD_POI_TYPES, getAmapFoodPoiType } from '../amapPoiTypeCatalog';
import type { SearchPlan, UserGoal } from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const POI_TYPE_SELECTION_TIMEOUT = 12000;

const PoiTypeSelectionOutputSchema = z.object({
  typeCodes: z.array(z.string().regex(/^\d{6}$/)).max(5),
  confidence: z.number().min(0).max(1).default(0.5),
  rationale: z.string().default('根据搜索目标选择高德 POI 类型。'),
});

export interface PoiTypeSelectionInput {
  goal: UserGoal;
  plan: SearchPlan;
}

export interface PoiTypeSelectionOutput {
  typeCodes: string[];
  confidence: number;
  rationale: string;
}

const SYSTEM_PROMPT = `你是 PoiTypeSelectionAgent。你只根据用户目标、搜索计划和给定的高德官方餐饮 POI 分类表选择 typecode。

规则：
1. 只能从输入的 foodPoiTypes 中选择 code，不要凭记忆输出表外 code。
2. 用户目标是具体食物/饮品时，选择能提高召回精度的餐饮类型；不要选过宽的 050000，除非没有更合理类型且 confidence 较低。
3. 不要把品牌型小类当作通用品类，例如用户没有点名品牌时，不要选择肯德基、麦当劳、大家乐、大快活、美心等品牌码。
4. 如果分类表无法可靠表达用户意图，返回空 typeCodes，并在 rationale 说明。
5. 你不验证具体餐厅事实；只选择搜索用的 POI type。`;

const POI_TYPE_SELECTION_FUNCTION = {
  name: 'selectAmapPoiTypes',
  description: 'Select constrained Amap food POI typecodes from the provided official food POI catalog.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      typeCodes: {
        type: 'array',
        description: 'Selected official Amap POI typecodes from input foodPoiTypes only.',
        items: { type: 'string' },
      },
      confidence: { type: 'number' },
      rationale: { type: 'string' },
    },
    required: ['typeCodes', 'confidence', 'rationale'],
  },
};

export async function runPoiTypeSelectionAgent(
  input: PoiTypeSelectionInput
): Promise<PoiTypeSelectionOutput> {
  const deterministicSelection = deterministicPoiTypeSelection(input);
  if (deterministicSelection.typeCodes.length > 0) {
    return deterministicSelection;
  }

  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicSelection;
  }

  try {
    return sanitizeSelection(await callPoiTypeSelectionModel(input));
  } catch (error) {
    logger.warn('PoiTypeSelectionAgent unavailable, using deterministic fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicSelection;
  }
}

export function deterministicPoiTypeSelection(input: PoiTypeSelectionInput): PoiTypeSelectionOutput {
  const targetText = searchableGoalText(input);
  const ranked = AMAP_FOOD_POI_TYPES
    .map((entry) => ({
      entry,
      score: scorePoiTypeEntry(targetText, entry.mid, entry.sub, entry.midEn, entry.subEn),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const typeCodes = ranked
    .filter((item) => item.score >= Math.max(3, ranked[0]?.score ?? 0))
    .map((item) => item.entry.code)
    .slice(0, 3);

  return sanitizeSelection({
    typeCodes,
    confidence: typeCodes.length > 0 ? 0.55 : 0.25,
    rationale: typeCodes.length > 0
      ? '根据官方餐饮 POI 分类表的字面匹配选择 typecode。'
      : '官方餐饮 POI 分类表中没有稳定命中的字面类型。',
  });
}

function sanitizeSelection(output: Partial<PoiTypeSelectionOutput>): PoiTypeSelectionOutput {
  const typeCodes = Array.from(new Set(output.typeCodes ?? []))
    .filter((code) => Boolean(getAmapFoodPoiType(code)))
    .filter((code) => code !== '050000')
    .slice(0, 5);
  const confidence = typeof output.confidence === 'number'
    ? Math.max(0, Math.min(1, output.confidence))
    : 0;

  if (confidence < 0.4 || typeCodes.length === 0) {
    return PoiTypeSelectionOutputSchema.parse({
      typeCodes: [],
      confidence,
      rationale: output.rationale || '未能可靠选择高德 POI type。',
    });
  }

  return PoiTypeSelectionOutputSchema.parse({
    typeCodes,
    confidence,
    rationale: output.rationale || '已从官方餐饮 POI 分类表选择搜索 type。',
  });
}

async function callPoiTypeSelectionModel(
  input: PoiTypeSelectionInput
): Promise<PoiTypeSelectionOutput> {
  return callJsonFunctionAgent({
    agentName: 'PoiTypeSelectionAgent',
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    input: buildModelInput(input),
    functionDefinition: POI_TYPE_SELECTION_FUNCTION,
    functionName: 'selectAmapPoiTypes',
    schema: PoiTypeSelectionOutputSchema,
    temperature: 0,
    maxTokens: 700,
    timeoutMs: POI_TYPE_SELECTION_TIMEOUT,
  }) as Promise<PoiTypeSelectionOutput>;
}

function buildModelInput(input: PoiTypeSelectionInput) {
  return {
    goal: {
      rawQuery: input.goal.rawQuery,
      requestedItems: input.goal.requestedItems,
      acceptableCategories: input.goal.acceptableCategories,
      primaryKeywords: input.goal.primaryKeywords,
      relatedKeywords: input.goal.relatedKeywords,
      broadenedKeywords: input.goal.broadenedKeywords,
      allowBroaden: input.goal.allowBroaden,
    },
    plan: input.plan,
    foodPoiTypes: AMAP_FOOD_POI_TYPES,
  };
}

function searchableGoalText(input: PoiTypeSelectionInput): string {
  return [
    input.goal.rawQuery,
    ...input.plan.keywords,
    ...input.goal.primaryKeywords,
    ...input.goal.relatedKeywords,
    ...input.goal.requestedItems.flatMap((item) => [item.name, ...item.aliases]),
    ...input.goal.acceptableCategories.map((category) => category.name),
  ].join(' ').toLowerCase();
}

function scorePoiTypeEntry(
  targetText: string,
  mid: string,
  sub: string,
  midEn: string,
  subEn: string
): number {
  const haystack = `${mid} ${sub} ${midEn} ${subEn}`.toLowerCase();
  let score = 0;

  for (const token of [mid, sub, midEn, subEn]) {
    const normalized = token.toLowerCase();
    if (normalized && targetText.includes(normalized)) {
      score += normalized.length + 2;
    }
  }

  for (const char of Array.from(new Set(targetText.replace(/\s/g, '')))) {
    if (/[\u4e00-\u9fa5A-Za-z]/.test(char) && haystack.includes(char)) {
      score += 1;
    }
  }

  return score;
}
