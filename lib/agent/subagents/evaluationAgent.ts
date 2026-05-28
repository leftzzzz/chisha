import type { Restaurant } from '@/types';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { parseModelJsonArguments } from '../modelJson';
import { getPoiTerms, lookupFoodPoiTypes } from '../poiTaxonomy';
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
const EVALUATION_TIMEOUT = 18000;

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
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicEvaluation(input);
  }

  try {
    return await callEvaluationModel(input);
  } catch (error) {
    logger.warn('EvaluationAgent unavailable, using deterministic fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicEvaluation(input);
  }
}

export function deterministicEvaluation(input: EvaluationAgentInput): EvaluationAgentOutput {
  const verdicts = input.restaurants.map((restaurant) =>
    evaluateRestaurantFacts(restaurant, input.goal, input.plan)
  );
  const selectedIds = verdicts
    .filter((verdict) => verdict.status === 'passed' && verdict.primaryEligible)
    .sort((left, right) => compareVerdicts(left, right, input.restaurants, input.preferenceSummary))
    .slice(0, input.targetCount)
    .map((verdict) => verdict.restaurantId);
  const selectedSet = new Set(selectedIds);
  const candidateIds = verdicts
    .filter((verdict) => !selectedSet.has(verdict.restaurantId) && verdict.status !== 'failed')
    .sort((left, right) => compareVerdicts(left, right, input.restaurants, input.preferenceSummary))
    .slice(0, 20)
    .map((verdict) => verdict.restaurantId);
  const unmetConstraints = verdicts
    .filter((verdict) => verdict.status !== 'passed')
    .flatMap((verdict) => [...verdict.conflicts, ...verdict.warnings]);

  return {
    verdicts,
    selectedIds,
    candidateIds,
    explanation: selectedIds.length > 0
      ? '已按目标语义验证、硬约束和距离排序。'
      : '没有找到通过语义验证的主推荐。',
    unmetConstraints: Array.from(new Set(unmetConstraints)),
  };
}

function evaluateRestaurantFacts(
  restaurant: Restaurant,
  goal: UserGoal,
  plan: SearchPlan
): CandidateVerdict {
  const text = restaurantText(restaurant);
  const evidence: string[] = [];
  const warnings: string[] = [];
  const conflicts: string[] = [];
  const fieldMatchedItems = goal.requestedItems
    .filter((item) => itemTerms(item).some((term) => textContains(text, term)))
    .map((item) => item.name);
  const matchedCategories = goal.acceptableCategories
    .filter((category) => categoryMatchesRestaurant(category.name, restaurant, text, plan))
    .map((category) => category.name);
  const keywordMatchedItems = matchItemsBySearchKeyword(goal, plan, matchedCategories);
  const matchedItems = Array.from(new Set([...fieldMatchedItems, ...keywordMatchedItems]));
  const requiredItems = goal.requestedItems.filter((item) => item.required);

  if (fieldMatchedItems.length > 0) {
    evidence.push(`事实字段命中菜品：${fieldMatchedItems.join('、')}`);
  }

  if (matchedCategories.length > 0) {
    evidence.push(`事实字段命中品类：${matchedCategories.join('、')}`);
  }

  if (keywordMatchedItems.length > 0) {
    evidence.push(`精确搜索词和兼容品类支持菜品：${keywordMatchedItems.join('、')}`);
  }

  if (restaurant.businessStatus === 'closed') {
    conflicts.push(`${restaurant.name}数据源标记为已停业或未营业。`);
  }

  const missingRequiredItems = requiredItems.filter((item) => !matchedItems.includes(item.name));
  const hasConcreteGoal = requiredItems.length > 0
    || goal.acceptableCategories.some((category) => category.confidence >= 0.7);
  let status: CandidateVerdict['status'] = 'passed';

  if (conflicts.length > 0) {
    status = 'failed';
  } else if (requiredItems.length > 0 && missingRequiredItems.length > 0) {
    if (matchedCategories.length > 0 || plan.searchIntent === 'broadened' || plan.searchIntent === 'fallback') {
      status = 'unverified';
      warnings.push(`未在事实字段中验证菜品「${missingRequiredItems.map((item) => item.name).join('、')}」。`);
    } else {
      status = 'failed';
      conflicts.push(`未验证到明确菜品「${missingRequiredItems.map((item) => item.name).join('、')}」。`);
    }
  } else if (requiredItems.length === 0 && goal.acceptableCategories.length > 0 && matchedCategories.length === 0) {
    if (goal.acceptableCategories.every((category) => category.confidence < 0.7) || plan.searchIntent !== 'exact') {
      status = 'unverified';
      warnings.push(`未在事实字段中验证品类「${goal.acceptableCategories.map((category) => category.name).join('、')}」。`);
    } else {
      status = 'failed';
      conflicts.push(`品类与「${goal.acceptableCategories.map((category) => category.name).join('、')}」不匹配。`);
    }
  } else if (!hasConcreteGoal && plan.searchIntent === 'fallback') {
    evidence.push('开放需求下按通用餐饮候选处理。');
  }

  const confidence = calculateConfidence(status, matchedItems.length, matchedCategories.length, restaurant.distance);

  return {
    restaurantId: restaurant.id,
    status,
    primaryEligible: status === 'passed' && plan.allowedForPrimary,
    confidence,
    matchedItems,
    matchedCategories,
    conflicts,
    evidence,
    warnings,
  };
}

function itemTerms(item: UserGoal['requestedItems'][number]): string[] {
  return Array.from(new Set([item.name, ...item.aliases].map((term) => term.trim()).filter(Boolean)));
}

function matchItemsBySearchKeyword(
  goal: UserGoal,
  plan: SearchPlan,
  matchedCategories: string[]
): string[] {
  if (!plan.allowedForPrimary || (plan.searchIntent !== 'exact' && plan.searchIntent !== 'synonym')) {
    return [];
  }

  const hasCategorySupport = matchedCategories.length > 0;
  if (!hasCategorySupport) {
    return [];
  }

  return goal.requestedItems
    .filter((item) => itemTerms(item).some((term) =>
      plan.keywords.some((keyword) => textContains(keyword, term) || textContains(term, keyword))
    ))
    .map((item) => item.name);
}

function categoryMatchesRestaurant(
  categoryName: string,
  restaurant: Restaurant,
  text: string,
  plan: SearchPlan
): boolean {
  if (getPoiTerms(categoryName).some((term) => textContains(text, term))) {
    return true;
  }

  if (plan.poiType && restaurant.poiTypeCode) {
    return plan.poiType.split('|').some((poiType) => poiType === restaurant.poiTypeCode);
  }

  return poiTypesForTerm(categoryName).some((poiType) =>
    restaurant.poiTypeCode === poiType
  );
}

function poiTypesForTerm(term: string): string[] {
  return (lookupFoodPoiTypes(term) ?? '')
    .split('|')
    .map((poiType) => poiType.trim())
    .filter(Boolean);
}

function calculateConfidence(
  status: CandidateVerdict['status'],
  itemMatchCount: number,
  categoryMatchCount: number,
  distance?: number
): number {
  if (status === 'failed') {
    return 0.1;
  }

  const semanticBase = itemMatchCount > 0 ? 0.9 : categoryMatchCount > 0 ? 0.78 : 0.5;
  const statusPenalty = status === 'unverified' ? 0.2 : 0;
  const distanceBonus = distance === undefined ? 0 : distance <= 500 ? 0.05 : distance <= 1200 ? 0.03 : 0;
  return Math.max(0, Math.min(1, Math.round((semanticBase + distanceBonus - statusPenalty) * 100) / 100));
}

function compareVerdicts(
  left: CandidateVerdict,
  right: CandidateVerdict,
  restaurants: Restaurant[],
  preferenceSummary?: UserPreferenceSummary
): number {
  const statusDelta = verdictRank(right) - verdictRank(left);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  const leftRejected = isRecentlyRejected(left.restaurantId, restaurants, preferenceSummary);
  const rightRejected = isRecentlyRejected(right.restaurantId, restaurants, preferenceSummary);
  if (leftRejected !== rightRejected) {
    return leftRejected ? 1 : -1;
  }

  if (right.confidence !== left.confidence) {
    return right.confidence - left.confidence;
  }

  const leftDistance = restaurants.find((restaurant) => restaurant.id === left.restaurantId)?.distance ?? Infinity;
  const rightDistance = restaurants.find((restaurant) => restaurant.id === right.restaurantId)?.distance ?? Infinity;
  return leftDistance - rightDistance;
}

function verdictRank(verdict: CandidateVerdict): number {
  if (verdict.status === 'passed') return 3;
  if (verdict.status === 'unverified') return 2;
  return 1;
}

function isRecentlyRejected(
  restaurantId: string,
  restaurants: Restaurant[],
  preferenceSummary?: UserPreferenceSummary
): boolean {
  const restaurant = restaurants.find((item) => item.id === restaurantId);
  if (!restaurant) {
    return false;
  }

  return preferenceSummary?.recentRejectedRestaurants?.includes(restaurant.name) ?? false;
}

async function callEvaluationModel(input: EvaluationAgentInput): Promise<EvaluationAgentOutput> {
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
        max_tokens: 1600,
      }),
    },
    EVALUATION_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`EvaluationAgent API failed: ${response.status}`);
  }

  const data = await response.json();
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('EvaluationAgent returned no function arguments');
  }

  const parsed = EvaluationAgentOutputSchema.safeParse(
    parseModelJsonArguments(args, 'EvaluationAgent')
  );
  if (!parsed.success) {
    throw new Error(`EvaluationAgent returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

function restaurantText(restaurant: Restaurant): string {
  return `${restaurant.name} ${restaurant.cuisineType} ${restaurant.address}`;
}

function textContains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
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
