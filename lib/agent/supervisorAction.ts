import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { AgentActionSchema } from './schemas/action';
import { DEFAULT_POI_TYPE, lookupFoodPoiTypes, normalizeSearchKeywords } from './poiTaxonomy';
import { isPrimaryRecommendationAllowed } from './finalGuard';
import type {
  AgentAction,
  AgentActionRecord,
  AgentContext,
  AgentMessage,
  AgentObservation,
  RestaurantCandidate,
  SearchAttempt,
  SearchPlan,
  UserPreferenceSummary,
} from './types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SUPERVISOR_ACTION_TIMEOUT = 15000;
const MIN_PRIMARY_BEFORE_OPTIONAL_EXPANSION = 6;

export interface SearchSupervisorActionInput {
  message: string;
  goal: AgentContext['goal'];
  messages: AgentMessage[];
  attempts: SearchAttempt[];
  observations: AgentObservation[];
  candidates: RestaurantCandidate[];
  preferenceSummary?: UserPreferenceSummary;
  limits: {
    maxSearchCalls: number;
    remainingSearchCalls: number;
    targetCount: number;
  };
}

const SYSTEM_PROMPT = `你是 SearchSupervisorAgent，也是餐厅搜索唯一 loop controller。你必须在每轮只输出一个 AgentAction。

可选动作：
1. search：给出下一次 search_restaurants 的 SearchPlan。
2. ask_user：需求不足、需要授权放宽、没有可验证主推荐时追问。
3. finish：已有足够可验证候选或达到合理搜索边界时结束。

硬规则：
- 不要编造餐厅事实、距离、营业状态、评分、菜单或排队情况。
- 不要生成高德 typecode；poiType 只能为空或沿用输入中已有值。
- SearchPlan.keywords 必须是单个餐饮意图词数组，例如 ["牛排"] 或 ["川菜","咖啡"]；不要输出整句，也不要用 "|" 拼接多个关键词。
- strict 距离、明确排除项、不吃辣等硬约束不能被自动放宽。
- 用户没有 allowBroaden 时，broadened/fallback 搜索的 allowedForPrimary 必须为 false。
- selectedIds 只能来自候选摘要中的 id；未验证或 failed 候选不能作为主推荐。
- relatedKeywords 还有未尝试词且主推荐少于目标数时，优先继续 search，不要过早 finish。`;

const ACTION_FUNCTION = {
  name: 'decideRestaurantSearchAction',
  description: 'Choose one controlled restaurant-search AgentAction.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['search', 'ask_user', 'finish'] },
      plan: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' } },
          radiusMeters: { type: 'number' },
          poiType: { type: 'string' },
          searchIntent: { type: 'string', enum: ['exact', 'synonym', 'broadened', 'fallback'] },
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
      selectedIds: { type: 'array', items: { type: 'string' } },
      candidateIds: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['type'],
  },
};

export async function decideSearchSupervisorAction(
  input: SearchSupervisorActionInput,
  context: AgentContext
): Promise<AgentAction> {
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicSupervisorAction(input, context);
  }

  try {
    return await callSupervisorActionModel(input);
  } catch (error) {
    logger.warn('SearchSupervisorAgent action model unavailable, using deterministic action', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicSupervisorAction(input, context);
  }
}

export function summarizeAction(action: AgentAction): string {
  if (action.type === 'search') {
    return `搜索「${action.plan.keywords.join('、')}」：${action.plan.reason}`;
  }

  if (action.type === 'ask_user') {
    return action.question.reason ?? action.question.question;
  }

  return action.explanation;
}

export function createActionRecord(action: AgentAction): AgentActionRecord {
  return {
    id: createActionId(),
    action,
    createdAt: Date.now(),
    summary: summarizeAction(action),
  };
}

function deterministicSupervisorAction(
  input: SearchSupervisorActionInput,
  context: AgentContext
): AgentAction {
  const primaryCandidates = context.candidates.filter((candidate) =>
    isPrimaryRecommendationAllowed(candidate, context)
  );

  const shouldTryRelatedKeywords = hasUntriedRelatedKeywords(context)
    && primaryCandidates.length < Math.min(MIN_PRIMARY_BEFORE_OPTIONAL_EXPANSION, context.targetCount);
  const shouldTryBroadenedKeywords = hasUntriedBroadenedKeywords(context)
    && primaryCandidates.length === 0;

  if (
    primaryCandidates.length >= Math.min(3, context.targetCount)
    && !shouldTryRelatedKeywords
    && !shouldTryBroadenedKeywords
  ) {
    return {
      type: 'finish',
      selectedIds: primaryCandidates.slice(0, context.targetCount).map((candidate) => candidate.restaurant.id),
      candidateIds: context.candidates
        .filter((candidate) => !primaryCandidates.includes(candidate))
        .slice(0, 20)
        .map((candidate) => candidate.restaurant.id),
      explanation: '已找到通过主推荐准入的候选，停止继续搜索。',
      confidence: 0.82,
    };
  }

  if (input.limits.remainingSearchCalls <= 0) {
    return primaryCandidates.length > 0
      ? {
          type: 'finish',
          selectedIds: primaryCandidates.map((candidate) => candidate.restaurant.id),
          explanation: '已达到搜索上限，返回当前通过验证的结果。',
          confidence: 0.62,
        }
      : buildFailureQuestionAction(context);
  }

  const exactKeywords = initialKeywords(context);
  if (context.attempts.length === 0 && exactKeywords.length > 0) {
    return {
      type: 'search',
      plan: buildPlan(context, exactKeywords, 'exact', true, '先搜索用户明确表达的餐饮目标。'),
    };
  }

  const relatedKeywords = untriedRelatedKeywords(context);
  if (relatedKeywords.length > 0) {
    return {
      type: 'search',
      plan: buildPlan(context, relatedKeywords, 'synonym', true, '原始搜索不足，继续尝试同义词和近似表达。'),
    };
  }

  const broadenedKeywords = untriedBroadenedKeywords(context);
  if (broadenedKeywords.length > 0) {
    return {
      type: 'search',
      plan: buildPlan(
        context,
        broadenedKeywords,
        'broadened',
        context.goal.allowBroaden,
        context.goal.allowBroaden
          ? '用户允许放宽，扩展到相邻品类。'
          : '原始目标不足，搜索相邻品类作为候补。'
      ),
    };
  }

  if (context.goal.allowBroaden && !hasTriedIntent(context, 'fallback')) {
    return {
      type: 'search',
      plan: buildPlan(context, ['餐厅', '美食'], 'fallback', true, '开放需求下使用通用餐饮兜底搜索。'),
    };
  }

  if (primaryCandidates.length > 0) {
    return {
      type: 'finish',
      selectedIds: primaryCandidates.map((candidate) => candidate.restaurant.id),
      explanation: '没有更多可验证搜索策略，返回当前通过验证的推荐。',
      confidence: 0.68,
    };
  }

  return buildFailureQuestionAction(context);
}

function buildFailureQuestionAction(context: AgentContext): AgentAction {
  const target = [
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.primaryKeywords,
  ].filter(Boolean).slice(0, 3).join('、');
  const hasStrictDistance = context.goal.hardConstraints.some((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  if (hasStrictDistance) {
    return {
      type: 'ask_user',
      question: {
        reason: '当前严格距离范围内没有找到通过主推荐准入的餐厅。',
        question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
        options: ['扩大范围', '换个类型'],
        allowFreeText: true,
        optionEffects: {
          '扩大范围': { allowBroaden: true, setDistanceMaxMeters: 5000 },
        },
      },
    };
  }

  return {
    type: 'ask_user',
    question: {
      reason: '没有找到通过主推荐准入的餐厅，需要用户调整或授权放宽。',
      question: target
        ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
        : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
      options: ['允许放宽', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '允许放宽': { allowBroaden: true },
      },
    },
  };
}

function buildPlan(
  context: AgentContext,
  keywords: string[],
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan {
  const normalizedKeywords = normalizeSearchKeywords(keywords);
  const poiType = normalizedKeywords.length === 1
    ? lookupFoodPoiTypes(normalizedKeywords[0]) ?? context.goal.poiType
    : undefined;

  return {
    keywords: normalizedKeywords.length > 0 ? normalizedKeywords : ['餐厅'],
    radiusMeters: nextRadius(context),
    poiType: poiType === DEFAULT_POI_TYPE ? undefined : poiType,
    searchIntent,
    allowedForPrimary,
    reason,
  };
}

function initialKeywords(context: AgentContext): string[] {
  return [
    ...context.goal.primaryKeywords,
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.acceptableCategories.map((category) => category.name),
  ].filter(Boolean);
}

function hasUntriedRelatedKeywords(context: AgentContext): boolean {
  return untriedRelatedKeywords(context).length > 0;
}

function untriedRelatedKeywords(context: AgentContext): string[] {
  return context.goal.relatedKeywords.filter((keyword) =>
    !hasTriedKeyword(context, keyword)
  );
}

function hasUntriedBroadenedKeywords(context: AgentContext): boolean {
  return untriedBroadenedKeywords(context).length > 0;
}

function untriedBroadenedKeywords(context: AgentContext): string[] {
  return context.goal.broadenedKeywords.filter((keyword) =>
    !hasTriedKeyword(context, keyword)
  );
}

function hasTriedKeyword(context: AgentContext, keyword: string): boolean {
  const normalizedKeywords = normalizeSearchKeywords([keyword]);
  return context.attempts.some((attempt) =>
    attempt.keywords.some((attemptKeyword) => normalizedKeywords.includes(attemptKeyword))
  );
}

function hasTriedIntent(context: AgentContext, intent: string): boolean {
  return context.attempts.some((attempt) => attempt.searchIntent === intent);
}

function nextRadius(context: AgentContext): number {
  const distance = context.goal.hardConstraints.find((constraint) =>
    constraint.kind === 'distance'
  );
  const maxMeters = distance?.maxMeters
    ?? (typeof distance?.value === 'number' ? distance.value : undefined);

  if (maxMeters !== undefined) {
    return Math.max(300, Math.min(5000, maxMeters));
  }

  const latestRadius = context.attempts.at(-1)?.radius ?? 1800;
  return Math.min(5000, Math.max(300, Math.round(latestRadius * 1.25)));
}

async function callSupervisorActionModel(input: SearchSupervisorActionInput): Promise<AgentAction> {
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
            content: `${SYSTEM_PROMPT}\n\n${JSON.stringify(buildModelInput(input))}`,
          },
        ],
        functions: [ACTION_FUNCTION],
        function_call: { name: 'decideRestaurantSearchAction' },
        temperature: 0,
        max_tokens: 900,
      }),
    },
    SUPERVISOR_ACTION_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`SearchSupervisorAgent action API failed: ${response.status}`);
  }

  const data = await response.json();
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('SearchSupervisorAgent action returned no function arguments');
  }

  const parsed = AgentActionSchema.safeParse(JSON.parse(args));
  if (!parsed.success) {
    throw new Error(`SearchSupervisorAgent action returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

function buildModelInput(input: SearchSupervisorActionInput) {
  return {
    message: input.message,
    goal: input.goal,
    messages: input.messages.slice(-8),
    attempts: input.attempts,
    observations: input.observations.slice(-5).map((observation) => ({
      actionId: observation.actionId,
      plan: observation.plan,
      rawCount: observation.rawCount,
      hardRejected: observation.hardRejected.length,
      acceptedPrimaryIds: observation.acceptedPrimaryIds,
      candidateIds: observation.candidateIds,
      unmetConstraints: observation.unmetConstraints.slice(0, 6),
    })),
    candidates: input.candidates.slice(0, 12).map((candidate) => ({
      id: candidate.restaurant.id,
      name: candidate.restaurant.name,
      cuisineType: candidate.restaurant.cuisineType,
      distance: candidate.restaurant.distance,
      score: candidate.score,
      verification: candidate.verification,
      sourceAttempt: candidate.sourceAttempt,
    })),
    preferenceSummary: input.preferenceSummary,
    limits: input.limits,
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

function createActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
