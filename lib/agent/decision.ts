import { z } from 'zod';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import type { AgentContext, AgentDecision, AgentDecisionMaker, Observation } from './types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const DECISION_TIMEOUT = 15000;

const SearchPlanSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(5),
  radiusMeters: z.number().int().min(300).max(5000),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  searchIntent: z.enum(['exact', 'synonym', 'broadened', 'fallback']),
  allowedForPrimary: z.boolean(),
  reason: z.string().min(1).max(200),
});

const PendingQuestionSchema = z.object({
  reason: z.string().min(1).max(200).optional(),
  question: z.string().min(1).max(120),
  options: z.array(z.string().min(1).max(24)).min(2).max(4).optional(),
  allowFreeText: z.boolean().default(true),
});

const AgentDecisionSchema = z.union([
  z.object({
    type: z.literal('search'),
    plan: SearchPlanSchema,
  }),
  z.object({
    type: z.literal('ask_user'),
    question: PendingQuestionSchema,
  }),
  z.object({
    type: z.literal('finish'),
    explanation: z.string().max(300).optional(),
  }),
]);

const DECISION_FUNCTION = {
  name: 'decideRestaurantAgentNextAction',
  description: 'Choose the next restaurant-search Agent action after observing verified search results.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['search', 'ask_user', 'finish'],
      },
      plan: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          radiusMeters: { type: 'number' },
          poiType: { type: 'string' },
          searchIntent: {
            type: 'string',
            enum: ['exact', 'synonym', 'broadened', 'fallback'],
          },
          allowedForPrimary: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      question: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          allowFreeText: { type: 'boolean' },
        },
      },
      explanation: { type: 'string' },
    },
    required: ['type'],
  },
};

const SYSTEM_PROMPT = `你是餐厅搜索 Agent 的恢复决策器。你根据用户目标、已搜索计划、验证摘要决定下一步动作。

可选动作：
1. search：继续调用 search_restaurants。用于同义词、另一意图、用户已授权的放宽搜索。
2. ask_user：需要用户授权或选择时追问。用于 strict 距离不足、明确菜品没找到、候补不足以满足原目标。
3. finish：停止搜索，让 Runtime 用已验证候选组装结果。

硬规则：
- 不要自动放宽 strict=true 的距离、排除、不吃辣等硬约束；需要放宽必须 ask_user。
- 用户没有 allowBroaden 时，broadened/fallback 只能作为候补，allowedForPrimary 必须 false。
- 如果某个意图还没搜索过，可以 search 该意图，而不是固定走 fallback。
- 如果已有候补但不满足原始目标，优先 ask_user 让用户决定是否看候补或调整需求。
- 不要编造餐厅事实、评分、营业状态或距离。`;

export const decideNextAgentAction: AgentDecisionMaker = async (context, observation) => {
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicDecision(context);
  }

  try {
    return await callDecisionModel(context, observation);
  } catch (error) {
    logger.warn('Agent decision model unavailable, finishing with verified candidates', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicDecision(context);
  }
};

function deterministicDecision(context: AgentContext): AgentDecision {
  const relatedKeywords = context.goal.relatedKeywords.filter((keyword) =>
    !hasTriedKeyword(context, keyword)
  );
  if (relatedKeywords.length > 0) {
    return {
      type: 'search',
      plan: {
        keywords: relatedKeywords.slice(0, 5),
        radiusMeters: nextRadius(context),
        poiType: context.goal.poiType,
        searchIntent: 'synonym',
        allowedForPrimary: true,
        reason: '原始搜索不足，继续尝试同义词和近似表达。',
      },
    };
  }

  const broadenedKeywords = context.goal.broadenedKeywords.filter((keyword) =>
    !hasTriedKeyword(context, keyword)
  );
  if (broadenedKeywords.length > 0) {
    return {
      type: 'search',
      plan: {
        keywords: broadenedKeywords.slice(0, 5),
        radiusMeters: nextRadius(context),
        searchIntent: 'broadened',
        allowedForPrimary: context.goal.allowBroaden,
        reason: context.goal.allowBroaden
          ? '用户允许放宽，扩展到相邻品类。'
          : '原始目标不足，先搜索相邻品类作为候补。',
      },
    };
  }

  if (context.goal.allowBroaden && !hasTriedIntent(context, 'fallback')) {
    return {
      type: 'search',
      plan: {
        keywords: ['餐厅', '美食'],
        radiusMeters: nextRadius(context),
        searchIntent: 'fallback',
        allowedForPrimary: true,
        reason: '开放需求下使用通用餐饮兜底搜索。',
      },
    };
  }

  return { type: 'finish' };
}

function hasTriedKeyword(context: AgentContext, keyword: string): boolean {
  return context.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => attemptKeyword === keyword)
  );
}

function hasTriedIntent(context: AgentContext, intent: string): boolean {
  return context.attempts.some((attempt) => attempt.searchIntent === intent);
}

function nextRadius(context: AgentContext): number {
  const latestRadius = context.attempts.at(-1)?.radius ?? 1800;
  const strictDistance = context.goal.hardConstraints.find((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  if (strictDistance?.maxMeters) {
    return strictDistance.maxMeters;
  }

  return Math.min(5000, Math.max(latestRadius, Math.round(latestRadius * 1.5)));
}

async function callDecisionModel(
  context: AgentContext,
  observation: Observation
): Promise<AgentDecision> {
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
            content: `${SYSTEM_PROMPT}\n\n${JSON.stringify(buildDecisionInput(context, observation))}`,
          },
        ],
        functions: [DECISION_FUNCTION],
        function_call: { name: 'decideRestaurantAgentNextAction' },
        temperature: 0,
        max_tokens: 800,
      }),
    },
    DECISION_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Agent decision API failed: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
        function_call?: { name: string; arguments: string };
        tool_calls?: Array<{
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('Agent decision returned no function arguments');
  }

  const parsed = AgentDecisionSchema.safeParse(JSON.parse(args));
  if (!parsed.success) {
    throw new Error(`Agent decision returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

function buildDecisionInput(context: AgentContext, observation: Observation) {
  return {
    goal: {
      rawQuery: context.goal.rawQuery,
      requestedItems: context.goal.requestedItems,
      acceptableCategories: context.goal.acceptableCategories,
      alternativeGroups: context.goal.alternativeGroups,
      hardConstraints: context.goal.hardConstraints,
      allowBroaden: context.goal.allowBroaden,
      primaryKeywords: context.goal.primaryKeywords,
      relatedKeywords: context.goal.relatedKeywords,
      broadenedKeywords: context.goal.broadenedKeywords,
    },
    limits: {
      maxSearchCalls: context.maxSearchCalls,
      remainingSearchCalls: Math.max(0, context.maxSearchCalls - context.attempts.length),
      targetCount: context.targetCount,
    },
    attempts: context.attempts,
    lastObservation: {
      plan: observation.plan,
      found: observation.found,
      accepted: observation.acceptedCandidates.length,
      rejected: observation.rejected,
      reason: observation.reason,
      acceptedSummaries: observation.acceptedCandidates.slice(0, 8).map((candidate) => ({
        name: candidate.restaurant.name,
        cuisineType: candidate.restaurant.cuisineType,
        distance: candidate.restaurant.distance,
        score: candidate.score,
        verification: candidate.verification,
      })),
    },
    candidateSummary: context.candidates.slice(0, 12).map((candidate) => ({
      id: candidate.restaurant.id,
      name: candidate.restaurant.name,
      cuisineType: candidate.restaurant.cuisineType,
      distance: candidate.restaurant.distance,
      score: candidate.score,
      sourceAttempt: candidate.sourceAttempt,
      verification: candidate.verification,
    })),
  };
}

function extractFunctionArguments(data: {
  choices?: Array<{
    message?: {
      content?: string;
      function_call?: { name: string; arguments: string };
      tool_calls?: Array<{
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
}): string | null {
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
