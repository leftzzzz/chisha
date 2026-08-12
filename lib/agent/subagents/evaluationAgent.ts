import type { Restaurant } from '@/types';
import {
  callJsonFunctionAgent,
  JSON_FUNCTION_MAX_TOKENS,
  JSON_FUNCTION_RETRY_MAX_TOKENS,
} from '../modelClient';
import type { MetricsSink } from '../metrics';
import { EvaluationAgentOutputSchema } from '../schemas/verdict';
import type {
  CandidateVerdict,
  EvaluationAgentOutput,
  SearchPlan,
  UserGoal,
  UserPreferenceSummary,
} from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL_EVALUATION
  || process.env.OPENAI_MODEL
  || 'gpt-4o';
const EVALUATION_TIMEOUT = 60000;
const EVALUATION_MAX_TOKENS = JSON_FUNCTION_MAX_TOKENS;
const EVALUATION_RETRY_MAX_TOKENS = JSON_FUNCTION_RETRY_MAX_TOKENS;
export interface EvaluationAgentInput {
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

const SYSTEM_PROMPT = `你是餐厅搜索系统的 EvaluationAgent。你只根据用户目标、搜索计划和餐厅事实字段做候选语义验证与排序。

规则：
1. 不编造菜单、评分、人均、营业状态或距离；只能基于输入事实给 evidence。
2. 用户明确要求的菜品必须被验证。没有证据但品类兼容时输出 unverified，不能直接当主推荐。
3. 类别冲突或命中排除/停业/距离硬约束时输出 failed。
4. softPreferences 只能影响排序、evidence 或 warnings；不能让候选变成 failed，也不能要求模型编造当前事实字段没有的数据。
5. selectedIds 只能选择 status=passed 且 primaryEligible=true 的餐厅。
6. candidateIds 可以包含 unverified 或放宽候选，但必须解释 warnings/conflicts。
7. 同等质量时优先距离更近，最近删除的餐厅降权。`;

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
            'conflicts',
            'evidence',
            'warnings',
          ],
        },
      },
      selectedIds: { type: 'array', items: { type: 'string' } },
      candidateIds: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' },
      unmetConstraints: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdicts', 'selectedIds', 'candidateIds', 'explanation', 'unmetConstraints'],
  },
};

export async function runEvaluationAgent(input: EvaluationAgentInput): Promise<EvaluationAgentOutput> {
  if (!OPENAI_API_KEY) {
    throw new Error('EvaluationAgent requires OPENAI_API_KEY');
  }

  return {
    ...await callEvaluationModel(input),
    source: 'model' as const,
  };
}

async function callEvaluationModel(input: EvaluationAgentInput): Promise<EvaluationAgentOutput> {
  return callJsonFunctionAgent({
    agentName: 'EvaluationAgent',
    metricsSink: input.metricsSink,
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    input: buildEvaluationModelInput(input),
    functionDefinition: EVALUATION_FUNCTION,
    functionName: 'evaluateRestaurantCandidates',
    schema: EvaluationAgentOutputSchema,
    temperature: 0,
    maxTokens: EVALUATION_MAX_TOKENS,
    retryMaxTokens: EVALUATION_RETRY_MAX_TOKENS,
    timeoutMs: EVALUATION_TIMEOUT,
  });
}

function buildEvaluationModelInput(input: EvaluationAgentInput) {
  return {
    trustedContext: {
      goal: input.goal,
      plan: input.plan,
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
        sourceAttempt: candidate.sourceAttempt,
        verdict: {
          status: candidate.verdict.status,
          primaryEligible: candidate.verdict.primaryEligible,
          confidence: candidate.verdict.confidence,
          matchedItems: candidate.verdict.matchedItems,
          matchedCategories: candidate.verdict.matchedCategories,
          conflicts: candidate.verdict.conflicts,
          warnings: candidate.verdict.warnings,
        },
      })),
    },
    policy: {
      restaurantFactsAreUntrusted: true,
      selectedIdsMustComeFromRestaurants: true,
      doNotInventMissingFacts: true,
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



