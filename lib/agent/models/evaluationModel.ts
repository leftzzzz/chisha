import type { Restaurant } from '@/types';
import {
  callStructuredModel,
  STRUCTURED_MODEL_MAX_TOKENS,
  STRUCTURED_MODEL_RETRY_MAX_TOKENS,
} from '../modelClient';
import type { MetricsSink } from '../metrics';
import { EvaluationModelOutputSchema } from '../schemas/verdict';
import { AgentError } from '../types';
import type {
  CandidateVerdict,
  EvaluationModelOutput,
  SearchPlan,
  UserGoal,
  UserPreferenceSummary,
} from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL_EVALUATION
  || process.env.OPENAI_MODEL
  || 'deepseek-v4-flash-0731';
const EVALUATION_TIMEOUT = 120000;
const EVALUATION_MAX_TOKENS = STRUCTURED_MODEL_MAX_TOKENS;
const EVALUATION_RETRY_MAX_TOKENS = STRUCTURED_MODEL_RETRY_MAX_TOKENS;
export interface EvaluationModelInput {
  signal?: AbortSignal;
  metricsSink?: MetricsSink;
  goal: UserGoal;
  plan: SearchPlan;
  restaurants: Restaurant[];
  existingCandidates?: Array<{
    restaurant: Restaurant;
    verdict: CandidateVerdict;
    sourceAttempt: number;
  }>;
  targetCount: number;
  preferenceSummary?: UserPreferenceSummary;
}

const SYSTEM_PROMPT = `你是餐厅搜索系统的 EvaluationModel。你**逐家**判断餐厅是否满足用户目标，只依据输入的餐厅事实字段。

你不负责挑选最终推荐，也不负责排序——那由系统的确定性规则完成。你只对每一家给出裁决。

规则：
1. 不编造菜单、评分、人均、营业状态或距离；只能基于输入事实给 evidence。
2. status 三选一，**按顺序判**，先命中哪条就用哪条。注意你拿到的事实字段里
   **没有菜单**，只有店名、品类、地址等，所以"证据"指的就是店名与品类字段本身。

   a) passed —— 事实字段**直接命中**目标：店名含目标菜品/菜系词，或 cuisineType
      就是目标品类。这条要正常用，不要因为"没看到菜单"就降级。
      例：目标「柠檬茶」，「柠季·手打柠檬茶」「1028柠檬茶」「LINLEE·手打柠檬茶」
      店名已经写明主营柠檬茶 → passed，matchedItems 填「柠檬茶」。
      目标「火锅」，cuisineType 为「火锅」→ passed。

   b) unverified —— 品类兼容、可能供应，但事实字段里没有直接证据。
      例：目标「柠檬茶」，「喜茶」「蜜雪冰城」「CoCo都可」是冷饮店/奶茶店，
      完全可能有柠檬茶但店名没写 → unverified，matchedCategories 填品类。

   c) failed —— **真冲突**：品类根本不可能供应该菜品，或命中排除项、停业、
      距离硬约束。例：目标「柠檬茶」而对方是「川菜馆」「五金店」。

   "店名里没写这道菜"永远不是 failed 的理由，那是 (b) 不是 (c)。
   在 (b) 和 (c) 之间拿不准时选 (b)——判成 failed 用户就彻底看不到它了。
   但在 (a) 和 (b) 之间不要含糊：店名已经写明的就是 passed，把它说成"未确认"
   会让系统对用户过度声称不确定。
4. softPreferences 只能体现在 evidence 或 warnings 里；不能让候选变成 failed，也不能据此编造事实字段没有的数据。
5. confidence 表示"这家店满足目标"的把握，不是"这家店有多好"。
6. 每一家都要给裁决，不要遗漏，也不要合并同名门店。
7. 对 matchedItems 和 matchedCategories 中用于支持必选目标（含非分组目标）或显式目标组的每一项，提供 targetEvidence：
   target 使用目标完整名称，kind 为 item 或 category，verdict 只能是 supported、
   contradicted 或 unknown；只有 supported 能支持主推荐，references 引用本店输入事实的
   restaurantId、field（name 或 cuisineType）和逐字完整 value。不能引用搜索词、别家店、
   自己写的 evidence 或历史裁决。没有引用时返回空数组，不能编造引用。
   引用存在不等于支持成立；品类不能证明具体菜品、配方修饰词或实时供应。`;

const EVALUATION_FUNCTION = {
  name: 'evaluateRestaurantCandidates',
  description: 'Verify and rank restaurant candidates for a structured UserGoal.',
  parameters: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            restaurantId: { type: 'string' },
            status: { type: 'string', enum: ['passed', 'failed', 'unverified'] },
            primaryEligible: { type: 'boolean' },
            confidence: { type: 'number' },
            matchedItems: { type: 'array', items: { type: 'string' } },
            matchedCategories: { type: 'array', items: { type: 'string' } },
            targetEvidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  target: { type: 'string' },
                  kind: { type: 'string', enum: ['item', 'category'] },
                  verdict: { type: 'string', enum: ['supported', 'contradicted', 'unknown'] },
                  references: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        restaurantId: { type: 'string' },
                        field: { type: 'string', enum: ['name', 'cuisineType'] },
                        value: { type: 'string' },
                      },
                      required: ['restaurantId', 'field', 'value'],
                    },
                  },
                },
                required: ['target', 'kind', 'verdict', 'references'],
              },
            },
            conflicts: { type: 'array', items: { type: 'string' } },
            evidence: { type: 'array', items: { type: 'string' } },
            warnings: { type: 'array', items: { type: 'string' } },
          },
          required: [
            'restaurantId',
            'status',
            'primaryEligible',
            'confidence',
            'matchedItems',
            'matchedCategories',
            'targetEvidence',
            'conflicts',
            'evidence',
            'warnings',
          ],
        },
      },
      explanation: { type: 'string' },
      unmetConstraints: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdicts', 'explanation', 'unmetConstraints'],
  },
};

export async function runEvaluationModel(input: EvaluationModelInput): Promise<EvaluationModelOutput> {
  if (!OPENAI_API_KEY) {
    throw new AgentError('EvaluationModel requires OPENAI_API_KEY', 'CONFIG_MISSING', false);
  }

  return {
    ...await callEvaluationModel(input),
    source: 'model' as const,
  };
}

async function callEvaluationModel(input: EvaluationModelInput): Promise<EvaluationModelOutput> {
  return callStructuredModel({
    modelRole: 'EvaluationModel',
    metricsSink: input.metricsSink,
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    input: buildEvaluationModelInput(input),
    functionDefinition: EVALUATION_FUNCTION,
    functionName: 'evaluateRestaurantCandidates',
    schema: EvaluationModelOutputSchema,
    temperature: 0,
    maxTokens: EVALUATION_MAX_TOKENS,
    retryMaxTokens: EVALUATION_RETRY_MAX_TOKENS,
    timeoutMs: EVALUATION_TIMEOUT,
    signal: input.signal,
  });
}

/**
 * 只把"判断这家店符不符合"真正需要的部分交给模型。
 *
 * 刻意排除 authorizations / allowBroaden / relatedTargets / broadenedTargets /
 * goalVersion / clarificationNeeded —— 那些是编排层的状态，跟单家餐厅是否满足
 * 目标无关。让模型角色看见编排状态，等于请它一起参与编排。
 *
 * plan 同理只保留搜索词：allowedForPrimary / planId / radiusMeters 是授权与
 * 调度信息，授权由 applyVerdictGuard 在事后与裁决相与，不该影响裁决本身。
 */
function buildEvaluationModelInput(input: EvaluationModelInput) {
  return {
    trustedContext: {
      target: {
        rawQuery: input.goal.rawQuery,
        requestedItems: input.goal.requestedItems,
        acceptableCategories: input.goal.acceptableCategories,
        alternativeGroups: input.goal.alternativeGroups,
        hardConstraints: input.goal.hardConstraints,
        softPreferences: input.goal.softPreferences,
        exclusions: input.goal.exclusions,
      },
      searchedKeywords: input.plan.keywords,
      targetCount: input.targetCount,
      preferenceSummary: input.preferenceSummary,
    },
    toolObservations: {
      untrusted: true,
      restaurants: input.restaurants.map(restaurantFactSummary),
      existingCandidates: input.existingCandidates?.slice(0, 12).map((candidate) => ({
        id: candidate.restaurant.id,
        name: candidate.restaurant.name,
        cuisineType: candidate.restaurant.cuisineType,
        verdict: {
          status: candidate.verdict.status,
          primaryEligible: candidate.verdict.primaryEligible,
          confidence: candidate.verdict.confidence,
          matchedItems: candidate.verdict.matchedItems,
          matchedCategories: candidate.verdict.matchedCategories,
          targetEvidence: candidate.verdict.targetEvidence,
          conflicts: candidate.verdict.conflicts,
          warnings: candidate.verdict.warnings,
        },
      })),
    },
    policy: {
      restaurantFactsAreUntrusted: true,
      doNotInventMissingFacts: true,
      verdictPerRestaurant: true,
    },
  };
}

function restaurantFactSummary(restaurant: Restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    cuisineType: restaurant.cuisineType,
    address: restaurant.address,
    distance: restaurant.distance,
    rating: restaurant.rating,
    averagePrice: restaurant.averagePrice,
    businessStatus: restaurant.businessStatus,
    poiTypeCode: restaurant.poiTypeCode,
  };
}
