import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { parseModelJsonArguments } from '../modelJson';
import { normalizeSearchKeywords } from '../poiTaxonomy';
import { PlanningAgentOutputSchema } from '../schemas/plan';
import type {
  PlanningAgentOutput,
  SearchAttempt,
  SearchTarget,
  UserGoal,
} from '../types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const PLANNING_TIMEOUT = 15000;

export interface PlanningAgentInput {
  goal: UserGoal;
  attempts: SearchAttempt[];
  failureReason?: string;
  targetCount: number;
}

const SYSTEM_PROMPT = `你是餐厅搜索系统的 PlanningAgent。你只负责把已结构化的 UserGoal 转成下一批搜索目标，不调用外部工具，也不生成高德 POI typecode。

规则：
1. targets 只能是用户目标里的菜品、菜系、餐厅类型、同义表达或用户已授权的 broad/fallback。
2. 用户没有 allowBroaden 时，broadened/fallback 计划不能进入主推荐，allowedForPrimary 必须为 false。
3. strict 距离、预算、排除项等硬约束不能被你放宽。
4. 同一轮可包含多个并列目标，例如“日料或韩餐”需要同时保留。
5. target.label 必须是单个餐饮意图词，例如“牛排”“川菜”“咖啡”，不要输出整句或用“|”合并多个关键词。
6. 输出为什么继续搜，以及本轮目标是 exact、synonym、broadened 还是 fallback。`;

const PLANNING_FUNCTION = {
  name: 'planRestaurantSearchTargets',
  description: 'Generate restaurant search targets from a structured UserGoal.',
  parameters: {
    type: 'object',
    properties: {
      plans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            targets: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  kind: { type: 'string', enum: ['dish', 'cuisine', 'restaurant_type', 'generic'] },
                  strictness: { type: 'string', enum: ['exact', 'compatible', 'broad'] },
                },
                required: ['label', 'kind', 'strictness'],
              },
            },
            radiusMeters: { type: 'number' },
            searchIntent: { type: 'string', enum: ['exact', 'synonym', 'broadened', 'fallback'] },
            allowedForPrimary: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['targets', 'radiusMeters', 'searchIntent', 'allowedForPrimary', 'reason'],
        },
      },
    },
    required: ['plans'],
  },
};

export async function runPlanningAgent(input: PlanningAgentInput): Promise<PlanningAgentOutput> {
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicPlanning(input);
  }

  try {
    return await callPlanningModel(input);
  } catch (error) {
    logger.warn('PlanningAgent unavailable, using deterministic fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicPlanning(input);
  }
}

export function deterministicPlanning(input: PlanningAgentInput): PlanningAgentOutput {
  const radiusMeters = getGoalRadius(input.goal);
  const exactTargets = buildTargets(input.goal.primaryKeywords, input.goal, 'exact');
  if (exactTargets.length > 0 && !hasTriedAllTargets(input.attempts, exactTargets)) {
    return {
      plans: [{
        targets: filterUntriedTargets(input.attempts, exactTargets),
        radiusMeters,
        searchIntent: 'exact',
        allowedForPrimary: true,
        reason: '先搜索用户明确表达的目标。',
      }],
    };
  }

  const relatedTargets = buildTargets(input.goal.relatedKeywords, input.goal, 'compatible');
  if (relatedTargets.length > 0 && !hasTriedAllTargets(input.attempts, relatedTargets)) {
    return {
      plans: [{
        targets: filterUntriedTargets(input.attempts, relatedTargets),
        radiusMeters,
        searchIntent: 'synonym',
        allowedForPrimary: true,
        reason: '明确目标不足时，继续搜索 Agent 解析出的同义或近义表达。',
      }],
    };
  }

  const broadTargets = buildTargets(input.goal.broadenedKeywords, input.goal, 'broad');
  if (broadTargets.length > 0 && !hasTriedAllTargets(input.attempts, broadTargets)) {
    return {
      plans: [{
        targets: filterUntriedTargets(input.attempts, broadTargets),
        radiusMeters,
        searchIntent: 'broadened',
        allowedForPrimary: input.goal.allowBroaden,
        reason: input.goal.allowBroaden
          ? '用户允许放宽，搜索相邻品类。'
          : '原始目标不足，仅作为候补搜索相邻品类。',
      }],
    };
  }

  if (input.goal.allowBroaden && !input.attempts.some((attempt) => attempt.searchIntent === 'fallback')) {
    return {
      plans: [{
        targets: [{ label: '餐厅', kind: 'generic', strictness: 'broad' }],
        radiusMeters,
        searchIntent: 'fallback',
        allowedForPrimary: true,
        reason: '开放需求下搜索通用餐饮候选。',
      }],
    };
  }

  return { plans: [] };
}

function buildTargets(
  keywords: string[],
  goal: UserGoal,
  strictness: SearchTarget['strictness']
): SearchTarget[] {
  if (!keywords.some((keyword) => keyword.trim())) {
    return [];
  }

  return normalizeSearchKeywords(keywords)
    .map((label) => ({
      label,
      kind: inferTargetKind(label, goal),
      strictness,
    }));
}

function inferTargetKind(label: string, goal: UserGoal): SearchTarget['kind'] {
  if (goal.requestedItems.some((item) => item.name === label || item.aliases.includes(label))) {
    return 'dish';
  }

  if (goal.acceptableCategories.some((category) => category.name === label)) {
    return 'cuisine';
  }

  if (label === '餐厅' || label === '美食') {
    return 'generic';
  }

  return 'restaurant_type';
}

function hasTriedAllTargets(attempts: SearchAttempt[], targets: SearchTarget[]): boolean {
  return targets.every((target) =>
    attempts.some((attempt) => attempt.keywords.includes(target.label))
  );
}

function filterUntriedTargets(attempts: SearchAttempt[], targets: SearchTarget[]): SearchTarget[] {
  const untried = targets.filter((target) =>
    !attempts.some((attempt) => attempt.keywords.includes(target.label))
  );

  return untried.length > 0 ? untried : targets;
}

function getGoalRadius(goal: UserGoal): number {
  const distanceConstraint = goal.hardConstraints.find((constraint) => constraint.kind === 'distance');
  const radius = distanceConstraint?.maxMeters
    ?? (typeof distanceConstraint?.value === 'number' ? distanceConstraint.value : 1800);

  return Math.max(300, Math.min(5000, Math.round(radius)));
}

async function callPlanningModel(input: PlanningAgentInput): Promise<PlanningAgentOutput> {
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
              attempts: input.attempts,
              failureReason: input.failureReason,
              targetCount: input.targetCount,
            })}`,
          },
        ],
        functions: [PLANNING_FUNCTION],
        function_call: { name: 'planRestaurantSearchTargets' },
        temperature: 0,
        max_tokens: 900,
      }),
    },
    PLANNING_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`PlanningAgent API failed: ${response.status}`);
  }

  const data = await response.json();
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('PlanningAgent returned no function arguments');
  }

  const parsed = PlanningAgentOutputSchema.safeParse(
    parseModelJsonArguments(args, 'PlanningAgent')
  );
  if (!parsed.success) {
    throw new Error(`PlanningAgent returned invalid schema: ${parsed.error.message}`);
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
