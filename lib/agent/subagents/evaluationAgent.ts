import type { Restaurant } from '@/types';
import type { z } from 'zod';
import { fetchWithTimeout } from '@/lib/withTimeout';
import {
  JSON_FUNCTION_MAX_TOKENS,
  JSON_FUNCTION_RETRY_MAX_TOKENS,
  parseJsonFunctionAgentResponse,
  type JsonFunctionParseResult,
} from '../modelClient';
import type { ChatCompletionFunctionResponse } from '../modelJson';
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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const EVALUATION_TIMEOUT = 60000;
const EVALUATION_MAX_TOKENS = JSON_FUNCTION_MAX_TOKENS;
const EVALUATION_RETRY_MAX_TOKENS = JSON_FUNCTION_RETRY_MAX_TOKENS;

export interface EvaluationAgentInput {
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

  return callEvaluationModel(input);
}

async function callEvaluationModel(input: EvaluationAgentInput): Promise<EvaluationAgentOutput> {
  const first = await requestEvaluationModel(input, EVALUATION_MAX_TOKENS);
  const firstResult = parseEvaluationModelResult(first);

  if (firstResult.truncated) {
    const second = await requestEvaluationModel(input, EVALUATION_RETRY_MAX_TOKENS);
    const secondResult = parseEvaluationModelResult(second);
    if (secondResult.ok) {
      return secondResult.data as EvaluationAgentOutput;
    }

    if (firstResult.ok) {
      return firstResult.data as EvaluationAgentOutput;
    }

    throw secondResult.error ?? firstResult.error ?? new Error('EvaluationAgent returned invalid function arguments');
  }

  if (!firstResult.ok) {
    throw firstResult.error ?? new Error('EvaluationAgent returned invalid function arguments');
  }

  return firstResult.data as EvaluationAgentOutput;
}

async function requestEvaluationModel(
  input: EvaluationAgentInput,
  maxTokens: number
): Promise<ChatCompletionFunctionResponse> {
  const response = await fetchWithTimeout(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'user',
            content: `${SYSTEM_PROMPT}\n\n${JSON.stringify({
              goal: input.goal,
              plan: input.plan,
              restaurants: input.restaurants.map((restaurant) => ({
                id: restaurant.id,
                name: restaurant.name,
                cuisineType: restaurant.cuisineType,
                address: restaurant.address,
                distance: restaurant.distance,
                rating: restaurant.rating,
                averagePrice: restaurant.averagePrice,
                businessStatus: restaurant.businessStatus,
                poiTypeCode: restaurant.poiTypeCode,
              })),
              targetCount: input.targetCount,
              preferenceSummary: input.preferenceSummary,
            })}`,
          },
        ],
        functions: [EVALUATION_FUNCTION],
        function_call: { name: 'evaluateRestaurantCandidates' },
        temperature: 0,
        max_tokens: maxTokens,
      }),
    },
    EVALUATION_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`EvaluationAgent API failed: ${response.status}`);
  }

  return response.json();
}

function parseEvaluationModelResult(
  data: ChatCompletionFunctionResponse
): JsonFunctionParseResult<EvaluationAgentOutput> {
  return parseJsonFunctionAgentResponse<EvaluationAgentOutput>(data, {
    agentName: 'EvaluationAgent',
    functionName: 'evaluateRestaurantCandidates',
    schema: EvaluationAgentOutputSchema as z.ZodType<EvaluationAgentOutput>,
  });
}
