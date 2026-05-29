import type { Restaurant } from '@/types';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { parseModelJsonArguments } from '../modelJson';
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
const MIN_EVALUATION_MAX_TOKENS = 1600;
const MAX_EVALUATION_MAX_TOKENS = 4096;

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
  const initialMaxTokens = evaluationMaxTokens(input.restaurants.length);
  const first = await requestEvaluationModel(input, initialMaxTokens);
  const firstArgs = extractFunctionArguments(first);

  if (
    shouldRetryEvaluationParse(first, firstArgs)
    && initialMaxTokens < MAX_EVALUATION_MAX_TOKENS
  ) {
    const second = await requestEvaluationModel(input, MAX_EVALUATION_MAX_TOKENS);
    return parseEvaluationModelOutput(second);
  }

  return parseEvaluationModelOutput(first);
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

function parseEvaluationModelOutput(data: ChatCompletionFunctionResponse): EvaluationAgentOutput {
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('EvaluationAgent returned no function arguments');
  }

  const finishReason = getFinishReason(data);
  if (finishReason === 'length' || !hasCompleteJsonStructure(args)) {
    throw new Error('EvaluationAgent returned truncated function arguments');
  }

  const parsed = EvaluationAgentOutputSchema.safeParse(
    parseModelJsonArguments(args, 'EvaluationAgent')
  );
  if (!parsed.success) {
    throw new Error(`EvaluationAgent returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

function evaluationMaxTokens(restaurantCount: number): number {
  return Math.min(
    MAX_EVALUATION_MAX_TOKENS,
    Math.max(MIN_EVALUATION_MAX_TOKENS, 600 + restaurantCount * 220)
  );
}

function shouldRetryEvaluationParse(
  data: ChatCompletionFunctionResponse,
  args: string | null
): boolean {
  return getFinishReason(data) === 'length'
    || Boolean(args && !hasCompleteJsonStructure(args));
}

function getFinishReason(data: ChatCompletionFunctionResponse): string | undefined {
  return data.choices?.[0]?.finish_reason;
}

function extractFunctionArguments(data: ChatCompletionFunctionResponse): string | null {
  const message = data.choices?.[0]?.message;
  if (message?.function_call?.arguments) {
    return message.function_call.arguments;
  }

  const toolCall = message?.tool_calls?.find((item) => item.type === 'function');
  if (toolCall?.function.arguments) {
    return toolCall.function.arguments;
  }

  return extractJsonObjectFromText(message?.content ?? '');
}

interface ChatCompletionFunctionResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      function_call?: { name: string; arguments: string };
      tool_calls?: Array<{
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}

function extractJsonObjectFromText(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  for (let index = start; index < content.length; index++) {
    const char = content[index];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return null;
}

function hasCompleteJsonStructure(content: string): boolean {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of content.trim()) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) {
        return false;
      }
    }
  }

  return !inString && stack.length === 0;
}
