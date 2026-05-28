import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { GoalPatchSchema, UserGoalSchema } from './schemas/goal';
import { PendingQuestionSchema, SearchSupervisorOutputSchema } from './schemas/clarification';
import type {
  AgentInput,
  AgentSession,
  ClarificationEffect,
  CandidateVerdict,
  Constraint,
  GoalCategory,
  GoalPatch,
  PendingQuestion,
  RequestedItem,
  SearchAttempt,
  UserGoal,
  UserPreferenceSummary,
} from './types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const SUPERVISOR_TIMEOUT = 18000;

export interface SearchSupervisorInput {
  message: string;
  previousGoal?: UserGoal;
  preferenceSummary?: UserPreferenceSummary;
  pendingQuestion?: PendingQuestion;
  failureReason?: string;
  attempts?: SearchAttempt[];
  verdictSummary?: CandidateVerdict[];
}

export interface SearchSupervisorOutput {
  goal?: UserGoal;
  patch?: GoalPatch;
  question?: PendingQuestion;
  nextAction?: 'plan' | 'ask_user' | 'finish';
}

const SYSTEM_PROMPT = `你是 SearchSupervisorAgent，是餐厅搜索主 Agent。你负责理解用户消息、维护 UserGoal、生成 GoalPatch、决定是否追问或进入计划阶段。

边界：
1. 你可以理解用户意图、菜品、菜系、排除项、偏好和歧义。
2. 你不能调用高德，也不能生成或修改餐厅事实。
3. 你不能生成高德 POI typecode；只输出 UserGoal、GoalPatch 或 PendingQuestion。
4. 用户明确表达的菜品必须保留在 requestedItems，不要只泛化成菜系。
5. 用户没有明确授权时 allowBroaden=false。
6. 需要放宽 strict 距离、明确排除项、未验证候补进入主推荐时，必须 ask_user。
7. 追问应基于当前上下文自己生成，避免固定套用“正餐/小吃/喝点东西”等预设流程。`;

const SUPERVISOR_FUNCTION = {
  name: 'superviseRestaurantSearch',
  description: 'Understand or update a restaurant search goal.',
  parameters: {
    type: 'object',
    properties: {
      goal: userGoalJsonSchema(),
      patch: goalPatchJsonSchema(),
      question: pendingQuestionJsonSchema(),
      nextAction: { type: 'string', enum: ['plan', 'ask_user', 'finish'] },
    },
  },
};

export async function runSearchSupervisor(
  input: SearchSupervisorInput
): Promise<SearchSupervisorOutput> {
  if (!OPENAI_API_KEY || process.env.NODE_ENV === 'test') {
    return deterministicSupervisor(input);
  }

  try {
    return await callSupervisorModel(input);
  } catch (error) {
    logger.warn('SearchSupervisorAgent unavailable, using minimal fallback', {
      error: error instanceof Error ? error.message : String(error),
    });
    return deterministicSupervisor(input);
  }
}

export async function understandSearchGoal(input: AgentInput): Promise<UserGoal> {
  const output = await runSearchSupervisor({
    message: input.query,
    previousGoal: input.runtimeState?.goal,
    preferenceSummary: input.preferenceSummary,
  });

  if (output.goal) {
    return output.goal;
  }

  if (output.patch && input.runtimeState?.goal) {
    return applyGoalPatch(input.runtimeState.goal, output.patch, input.query);
  }

  return buildMinimalFallbackGoal(input.query, input.preferenceSummary);
}

export function deterministicSupervisor(input: SearchSupervisorInput): SearchSupervisorOutput {
  if (input.previousGoal && input.pendingQuestion) {
    const patch = buildMinimalGoalPatch(input.message);
    return {
      patch,
      nextAction: 'plan',
    };
  }

  if (input.previousGoal) {
    return {
      goal: {
        ...input.previousGoal,
        rawQuery: input.message,
      },
      nextAction: 'plan',
    };
  }

  const goal = buildMinimalFallbackGoal(input.message, input.preferenceSummary);
  const question = goal.clarificationNeeded.length > 0
    ? clarificationNeedToPendingQuestion(goal.clarificationNeeded[0])
    : undefined;

  return {
    goal,
    question,
    nextAction: question ? 'ask_user' : 'plan',
  };
}

export function buildMinimalFallbackGoal(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): UserGoal {
  const trimmedQuery = query.trim();
  const hardConstraints = [
    parseDistanceConstraint(trimmedQuery, preferenceSummary),
    parseBudgetConstraint(trimmedQuery, preferenceSummary),
    parseOpenNowConstraint(trimmedQuery),
    ...parseExplicitExclusions(trimmedQuery),
  ].filter((constraint): constraint is Constraint => Boolean(constraint));
  const clarificationNeeded = needsClarification(trimmedQuery)
    ? [{
        reason: '用户需求缺少可验证的菜品或品类目标。',
        question: '你想找哪类餐厅，或具体想吃什么？',
        allowFreeText: true,
      }]
    : [];

  return {
    intent: 'find_restaurants',
    rawQuery: query,
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: trimmedQuery ? [trimmedQuery] : [],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints,
    softPreferences: [],
    exclusions: hardConstraints
      .filter((constraint) => constraint.kind === 'exclude_category')
      .flatMap((constraint) => constraint.values ?? []),
    ambiguity: OPENAI_API_KEY
      ? []
      : ['Agent 目标解析不可用，已使用最小降级目标，不做菜品/菜系语义扩展。'],
    clarificationNeeded,
    allowBroaden: false,
  };
}

export function applyGoalPatch(goal: UserGoal, patch: GoalPatch, rawQuery = goal.rawQuery): UserGoal {
  const patched: UserGoal = {
    ...goal,
    rawQuery,
    requestedItems: mergeByName(goal.requestedItems, patch.addRequestedItems ?? []),
    acceptableCategories: mergeCategories(goal.acceptableCategories, patch.addCategories ?? []),
    hardConstraints: mergeConstraints(
      goal.hardConstraints.filter((constraint) =>
        !(patch.removeConstraints ?? []).includes(constraint.label)
      ),
      patch.addConstraints ?? []
    ),
    allowBroaden: patch.allowBroaden ?? goal.allowBroaden,
    ambiguity: mergeStrings(goal.ambiguity, [patch.reason]),
    clarificationNeeded: [],
  };

  patched.primaryKeywords = mergeStrings(
    patched.primaryKeywords,
    [
      ...(patch.addRequestedItems ?? []).map((item) => item.name),
      ...(patch.addCategories ?? []).map((category) => category.name),
    ]
  );
  patched.exclusions = patched.hardConstraints
    .filter((constraint) => constraint.kind === 'exclude_category')
    .flatMap((constraint) => constraint.values ?? []);

  return UserGoalSchema.parse(patched);
}

export function applySupervisorClarifyingAnswer(session: AgentSession, answer: string): void {
  const goal = session.goal;
  if (!goal) {
    session.pendingQuestion = undefined;
    return;
  }

  const normalized = answer.trim();
  const effect = normalized
    ? session.pendingQuestion?.optionEffects?.[normalized]
    : undefined;
  const patch = effect
    ? goalPatchFromClarificationEffect(effect)
    : buildMinimalGoalPatch(normalized);

  session.goal = applyGoalPatch(goal, patch, normalized ? `${goal.rawQuery}，${normalized}` : goal.rawQuery);
  session.pendingQuestion = undefined;
}

export function clarificationNeedToPendingQuestion(
  need: UserGoal['clarificationNeeded'][number]
): PendingQuestion {
  return PendingQuestionSchema.parse({
    reason: need.reason,
    question: need.question,
    options: need.options?.map((option) => option.label),
    allowFreeText: need.allowFreeText,
    optionEffects: Object.fromEntries(
      (need.options ?? [])
        .filter((option) => option.effect)
        .map((option) => [option.label, option.effect!])
    ),
  });
}

function buildMinimalGoalPatch(answer: string): GoalPatch {
  const trimmed = answer.trim();
  const allowsBroaden = /放宽|扩大|远一点|候补/.test(trimmed);
  const constraints = [
    parseDistanceConstraint(trimmed),
    parseBudgetConstraint(trimmed),
    parseOpenNowConstraint(trimmed),
    ...parseExplicitExclusions(trimmed),
  ].filter((constraint): constraint is Constraint => Boolean(constraint));

  return GoalPatchSchema.parse({
    addRequestedItems: trimmed && !allowsBroaden ? [{ name: trimmed, required: true, aliases: [] }] : [],
    addConstraints: constraints,
    allowBroaden: allowsBroaden ? true : undefined,
    reason: '根据用户追问回复更新目标。',
  });
}

function goalPatchFromClarificationEffect(effect: ClarificationEffect): GoalPatch {
  const addConstraints: Constraint[] = [];

  if (effect.setDistanceMaxMeters !== undefined) {
    addConstraints.push({
      kind: 'distance',
      label: `${Math.round(effect.setDistanceMaxMeters)}米内`,
      value: effect.setDistanceMaxMeters,
      maxMeters: effect.setDistanceMaxMeters,
      strict: false,
    });
  }

  return GoalPatchSchema.parse({
    addRequestedItems: effect.addRequestedItems?.map((item) => ({
      name: item,
      required: true,
      aliases: [],
    })),
    addCategories: effect.addCategories?.map((category) => ({
      name: category,
      confidence: 0.8,
    })),
    addConstraints,
    removeConstraints: effect.setDistanceMaxMeters !== undefined
      ? ['楼下500米内', '步行1公里内']
      : undefined,
    allowBroaden: effect.allowBroaden,
    reason: '根据用户追问选项更新目标。',
  });
}

async function callSupervisorModel(input: SearchSupervisorInput): Promise<SearchSupervisorOutput> {
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
              message: input.message,
              previousGoal: input.previousGoal,
              pendingQuestion: input.pendingQuestion,
              failureReason: input.failureReason,
              attempts: input.attempts,
              verdictSummary: input.verdictSummary,
              preferenceSummary: input.preferenceSummary,
            })}`,
          },
        ],
        functions: [SUPERVISOR_FUNCTION],
        function_call: { name: 'superviseRestaurantSearch' },
        temperature: 0,
        max_tokens: 1600,
      }),
    },
    SUPERVISOR_TIMEOUT
  );

  if (!response.ok) {
    throw new Error(`SearchSupervisorAgent API failed: ${response.status}`);
  }

  const data = await response.json();
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error('SearchSupervisorAgent returned no function arguments');
  }

  const parsed = SearchSupervisorOutputSchema.safeParse(JSON.parse(args));
  if (!parsed.success) {
    throw new Error(`SearchSupervisorAgent returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data as SearchSupervisorOutput;
}

function parseDistanceConstraint(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): Constraint | null {
  const explicitKm = query.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)/i);
  if (explicitKm) {
    const maxMeters = Math.round(Number(explicitKm[1]) * 1000);
    return { kind: 'distance', label: `${explicitKm[1]}公里内`, value: maxMeters, maxMeters, strict: true };
  }

  const explicitMeters = query.match(/(\d{2,5})\s*(?:米|m)/i);
  if (explicitMeters) {
    const maxMeters = Number(explicitMeters[1]);
    return { kind: 'distance', label: `${explicitMeters[1]}米内`, value: maxMeters, maxMeters, strict: true };
  }

  if (/下楼|楼下/.test(query)) {
    return { kind: 'distance', label: '楼下500米内', value: 500, maxMeters: 500, strict: true };
  }

  if (/步行|走路|几分钟/.test(query)) {
    return { kind: 'distance', label: '步行1公里内', value: 1000, maxMeters: 1000, strict: true };
  }

  if (preferenceSummary?.preferredDistanceMeters) {
    return {
      kind: 'distance',
      label: '历史偏好距离',
      value: preferenceSummary.preferredDistanceMeters,
      maxMeters: preferenceSummary.preferredDistanceMeters,
      strict: false,
    };
  }

  return null;
}

function parseBudgetConstraint(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): Constraint | null {
  const budgetMatch = query.match(/(?:预算|人均|每人|一人|每位)?\s*(\d{2,4})\s*(?:元|块|左右|以内)/);
  if (budgetMatch) {
    return {
      kind: 'budget',
      label: `预算${budgetMatch[1]}左右`,
      value: { max: Number(budgetMatch[1]) },
      max: Number(budgetMatch[1]),
      strict: false,
    };
  }

  if (preferenceSummary?.preferredPriceRange) {
    return {
      kind: 'budget',
      label: '历史偏好价格',
      value: preferenceSummary.preferredPriceRange,
      min: preferenceSummary.preferredPriceRange.min,
      max: preferenceSummary.preferredPriceRange.max,
      strict: false,
    };
  }

  return null;
}

function parseOpenNowConstraint(query: string): Constraint | null {
  return /营业中|还开|开门|现在开|没打烊|正在营业/.test(query)
    ? { kind: 'open_now', label: '当前营业中', strict: false }
    : null;
}

function parseExplicitExclusions(query: string): Constraint[] {
  const matches = Array.from(query.matchAll(/(?:不吃|不要|别吃|不想吃|排除|避开)([\p{Script=Han}A-Za-z0-9]{1,12})/gu));
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => ({
      kind: 'exclude_category',
      label: `排除${value}`,
      value,
      values: [value],
      strict: true,
    }));
}

function needsClarification(query: string): boolean {
  return !query.trim() || /随便|都行|吃点|吃什么|不知道吃啥|你决定/.test(query);
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].map((item) => item.trim()).filter(Boolean)));
}

function mergeByName<T extends RequestedItem>(left: T[], right: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of [...left, ...right]) {
    byName.set(item.name, item);
  }
  return Array.from(byName.values());
}

function mergeCategories(left: GoalCategory[], right: GoalCategory[]): GoalCategory[] {
  const byName = new Map<string, GoalCategory>();
  for (const category of [...left, ...right]) {
    const existing = byName.get(category.name);
    byName.set(category.name, {
      name: category.name,
      confidence: existing ? Math.max(existing.confidence, category.confidence) : category.confidence,
    });
  }
  return Array.from(byName.values());
}

function mergeConstraints(left: Constraint[], right: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  const constraints: Constraint[] = [];
  for (const constraint of [...left, ...right]) {
    const key = `${constraint.kind}:${constraint.label}:${JSON.stringify(constraint.value ?? constraint.values ?? '')}`;
    if (!seen.has(key)) {
      seen.add(key);
      constraints.push(constraint);
    }
  }
  return constraints;
}

function userGoalJsonSchema() {
  return {
    type: 'object',
    additionalProperties: true,
  };
}

function goalPatchJsonSchema() {
  return {
    type: 'object',
    additionalProperties: true,
  };
}

function pendingQuestionJsonSchema() {
  return {
    type: 'object',
    additionalProperties: true,
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
