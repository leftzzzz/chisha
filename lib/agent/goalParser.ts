import { z } from 'zod';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import type { AgentInput, UserGoal } from './types';
import { parseUserGoal, type AgentGoalDraft } from './planner';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const GOAL_PARSE_TIMEOUT = 15000;

const GoalDraftSchema = z.object({
  requestedItems: z.array(z.object({
    name: z.string().min(1),
    required: z.boolean().default(true),
    aliases: z.array(z.string()).default([]),
  })).default([]),
  acceptableCategories: z.array(z.object({
    name: z.string().min(1),
    confidence: z.number().min(0).max(1).default(0.7),
  })).default([]),
  alternativeGroups: z.array(z.object({
    mode: z.enum(['any_of', 'all_of']),
    items: z.array(z.string().min(1)).default([]),
    minPerGroup: z.number().int().positive().optional(),
  })).default([]),
  primaryKeywords: z.array(z.string().min(1)).default([]),
  relatedKeywords: z.array(z.string().min(1)).default([]),
  broadenedKeywords: z.array(z.string().min(1)).default([]),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  softPreferences: z.array(z.object({
    name: z.string().min(1),
    weight: z.number().default(1),
    verifiable: z.boolean().default(false),
  })).default([]),
  ambiguity: z.array(z.string()).default([]),
  clarificationNeeded: z.array(z.object({
    reason: z.string().min(1),
    question: z.string().min(1),
    options: z.array(z.object({
      label: z.string().min(1),
      value: z.string().min(1),
      effect: z.object({
        addRequestedItems: z.array(z.string()).default([]),
        addCategories: z.array(z.string()).default([]),
        setDistanceMaxMeters: z.number().optional(),
        allowBroaden: z.boolean().optional(),
      }).optional(),
    })).optional(),
    allowFreeText: z.boolean().default(true),
  })).default([]),
  allowBroaden: z.boolean().default(false),
});

const GOAL_PARSER_FUNCTION = {
  name: 'parseAgentRestaurantGoal',
  description: 'Parse a restaurant-search user request into a structured Agent goal. Do not invent restaurant facts.',
  parameters: {
    type: 'object',
    properties: {
      requestedItems: {
        type: 'array',
        description: 'Dish or item level requests explicitly asked for by the user.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            required: { type: 'boolean' },
            aliases: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'required', 'aliases'],
        },
      },
      acceptableCategories: {
        type: 'array',
        description: 'Cuisine or restaurant categories that satisfy the request.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            confidence: { type: 'number' },
          },
          required: ['name', 'confidence'],
        },
      },
      alternativeGroups: {
        type: 'array',
        description: 'OR/AND intent groups, e.g. Japanese or Korean food.',
        items: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['any_of', 'all_of'] },
            items: { type: 'array', items: { type: 'string' } },
            minPerGroup: { type: 'number' },
          },
          required: ['mode', 'items'],
        },
      },
      primaryKeywords: { type: 'array', items: { type: 'string' } },
      relatedKeywords: { type: 'array', items: { type: 'string' } },
      broadenedKeywords: { type: 'array', items: { type: 'string' } },
      poiType: {
        type: 'string',
        description: 'Amap POI type code only when highly confident; otherwise omit.',
      },
      softPreferences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            weight: { type: 'number' },
            verifiable: { type: 'boolean' },
          },
          required: ['name', 'weight', 'verifiable'],
        },
      },
      ambiguity: { type: 'array', items: { type: 'string' } },
      clarificationNeeded: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
            question: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  effect: {
                    type: 'object',
                    properties: {
                      addRequestedItems: { type: 'array', items: { type: 'string' } },
                      addCategories: { type: 'array', items: { type: 'string' } },
                      setDistanceMaxMeters: { type: 'number' },
                      allowBroaden: { type: 'boolean' },
                    },
                  },
                },
                required: ['label', 'value'],
              },
            },
            allowFreeText: { type: 'boolean' },
          },
          required: ['reason', 'question', 'allowFreeText'],
        },
      },
      allowBroaden: {
        type: 'boolean',
        description: 'True only when the user explicitly allows broad recommendations or the request is intentionally open-ended.',
      },
    },
    required: [
      'requestedItems',
      'acceptableCategories',
      'alternativeGroups',
      'primaryKeywords',
      'relatedKeywords',
      'broadenedKeywords',
      'softPreferences',
      'ambiguity',
      'clarificationNeeded',
      'allowBroaden',
    ],
  },
};

const SYSTEM_PROMPT = `你是餐厅搜索 Agent 的目标解析器。你的职责是把用户输入解析为结构化 goal，供后续搜索和验证使用。

原则：
1. 意图识别由你完成，不依赖固定关键词规则。
2. 保留用户明确提出的菜品级目标，不要用泛化品类覆盖。例如“炸鸡薯条”必须保留为 requestedItems。
3. 多意图必须保留为 alternativeGroups。例如“日料或韩餐”是 any_of。
4. 用户没有明确允许时，allowBroaden 必须为 false；“随便、都行、你决定”这类开放请求可以为 true。
5. 不要编造餐厅事实、评分、价格或营业状态。
6. relatedKeywords 只能放同义词或非常近的表达；broadenedKeywords 是上位品类，只能供 Runtime 在有授权时使用。
7. 如果需求太模糊或搜索失败后需要用户选择，写入 clarificationNeeded。
8. poiType 只有在非常确定高德 POI 类型代码时才填写，不确定就省略。`;

export type AgentGoalParser = (input: AgentInput) => Promise<UserGoal>;

export async function parseAgentGoal(input: AgentInput): Promise<UserGoal> {
  const draft = await callAgentGoalParser(input).catch((error) => {
    logger.warn('Agent goal parser unavailable, using rule-free fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });

  return parseUserGoal(input.query, input.preferenceSummary, draft);
}

async function callAgentGoalParser(input: AgentInput): Promise<AgentGoalDraft | undefined> {
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return undefined;
  }

  const userContent = [
    `用户需求：${input.query}`,
    input.location.address ? `用户位置：${input.location.address}` : '',
    input.preferenceSummary ? `历史偏好摘要：${JSON.stringify(input.preferenceSummary)}` : '',
  ].filter(Boolean).join('\n');

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
          { role: 'user', content: `${SYSTEM_PROMPT}\n\n${userContent}` },
        ],
        functions: [GOAL_PARSER_FUNCTION],
        function_call: { name: 'parseAgentRestaurantGoal' },
        temperature: 0,
        max_tokens: 900,
      }),
    },
    GOAL_PARSE_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`Goal parser API failed: ${response.status}`);
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
    throw new Error('Goal parser returned no function arguments');
  }

  const parsed = GoalDraftSchema.safeParse(JSON.parse(args));
  if (!parsed.success) {
    throw new Error(`Goal parser returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
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
