import { logger } from '@/lib/logger';
import { callJsonFunctionAgent } from './modelClient';
import { GoalPatchSchema, UserGoalSchema } from './schemas/goal';
import { PendingQuestionSchema, SearchSupervisorOutputSchema } from './schemas/clarification';
import type {
  AgentMessage,
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
const SUPERVISOR_TIMEOUT = 60000;
const SUPERVISOR_MAX_TOKENS = 4096;
const SUPERVISOR_RETRY_MAX_TOKENS = 8192;

export interface SearchSupervisorInput {
  message: string;
  previousGoal?: UserGoal;
  preferenceSummary?: UserPreferenceSummary;
  pendingQuestion?: PendingQuestion;
  messages?: AgentMessage[];
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
7. 追问应基于当前上下文自己生成，避免固定套用“正餐/小吃/喝点东西”等预设流程。
7a. 如果追问给出选项，必须尽量给每个选项设置 optionEffects；选项只是分类说明时，effect 要指向被澄清的原始目标，不能把选项标签当搜索词。
8. 用户明确说“随便/随意/随机/都行/都可以/无所谓/你决定/你看着办/帮我决定/直接推荐/不知道吃啥/不知道吃什么/没有具体想吃的”等，且没有具体菜品/菜系/餐厅类型时，表示开放随机推荐；输出 goal，allowBroaden=true，requestedItems/acceptableCategories/primaryKeywords 为空，clarificationNeeded=[]，加入“默认多样性”软偏好，进入 plan 后由 KeywordExpansionAgent 生成开放探索词；不要 ask_user，也不要把这些词当 keywords。
8a. 用户只是“附近有什么/吃点/清淡点/健康点/便宜点/环境好/人气高”等软偏好或开放询问、但没有明确授权随意/随机推荐且没有明确菜品/菜系/餐厅类型时，必须 ask_user 先澄清，不能直接搜索通用“餐厅/美食”。
9. 如果 pendingQuestion 存在，用户回答“都行/随便/你决定/直接推荐/按你推荐”等，表示授权开放推荐；输出 patch.allowBroaden=true，加入“默认多样性”软偏好并进入 plan，不要再次 ask_user。
10. 如果 pendingQuestion 存在，用户补充了新的菜品/菜系/餐厅类型，必须把这次回答总结成 GoalPatch，并清空旧 clarificationNeeded；不要重复提出同一个澄清问题。
11. primaryKeywords 只能放用户正向想吃的、适合高德 keywords 的单个餐饮意图词，例如“牛排”“川菜”“咖啡”；不要放整句“想吃牛排”，也不要把多个无关意图合成“川菜|咖啡”。
12. 不要为 primaryKeywords 生成搜索联想词；relatedKeywords 和 broadenedKeywords 由 KeywordExpansionAgent 负责生成，初始目标保持空数组即可。
13. 处理 pendingQuestion 的用户回复时，必须结合 previousGoal.rawQuery、pendingQuestion 和历史 messages 重新总结完整需求；当前 message 不是独立新需求。
14. 如果用户回复命中的是上轮澄清问题的选项标签或分类说明，不要把该标签本身作为搜索词；优先通过 pendingQuestion.optionEffects 或历史上下文恢复被澄清的原始目标。
15. 否定条件、口味限制、排除项、开放授权和软偏好都不是搜索目标，不能进入 primaryKeywords、requestedItems 或 acceptableCategories。类似“不要辣的，其他都可以”应表达为硬约束/开放授权，并在缺少正向餐饮目标时追问，不要输出“不辣”“都可以”作为关键词。

需求归类：
1. requestedItems 只放用户想吃的具体菜品、餐食或必须命中的食物目标；acceptableCategories 只放能满足需求的菜系/餐厅类型。
2. hardConstraints 只放可以用餐厅事实字段稳定验证的限制：distance、budget、open_now、exclude_category、avoid_spicy。用户明确排除、明确距离、明确预算、明确营业状态才是硬约束。
3. softPreferences 放体验、质量、氛围、人气、适用场景、排序倾向等偏好；它们不能阻塞主推荐。无法从餐厅事实字段稳定验证时，verifiable=false，并在 ambiguity 说明只能弱排序或提示。
4. 常见不可稳定验证的软偏好包括但不限于：人多、热闹、排队、网红、热门、人气高、环境好、氛围好、安静、适合聚餐、适合约会、服务好。即使用户说“想要/希望”，也不要写入 requestedItems 或 hardConstraints。
5. “评分高/评价好/人均低/营业中/距离近”只有在对应字段存在时才能作为可验证信息；作为用户目标时优先写入 softPreferences，明确数值预算/距离/营业中请求才写入 hardConstraints。
6. 如果用户坚持某个当前事实字段无法验证的条件“必须满足”，优先 ask_user 说明无法验证并让用户选择是否改为软偏好或调整需求。
7. 多轮追问回答也必须重新分类，不要把用户的普通补充文本默认塞进 requestedItems。`;

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
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for SearchSupervisorAgent');
  }

  try {
    return normalizeSupervisorOutput(input, await callSupervisorModel(input));
  } catch (error) {
    if (isTruncatedFunctionArgumentsError(error)) {
      try {
        logger.warn('SearchSupervisorAgent response was truncated, retrying with a larger token budget', {
          error: error instanceof Error ? error.message : String(error),
        });
        return normalizeSupervisorOutput(
          input,
          await callSupervisorModel(input, SUPERVISOR_RETRY_MAX_TOKENS)
        );
      } catch (retryError) {
        logger.warn('SearchSupervisorAgent retry unavailable', {
          error: retryError instanceof Error ? retryError.message : String(retryError),
        });
        throw retryError;
      }
    }

    logger.warn('SearchSupervisorAgent unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function normalizeSupervisorOutput(
  input: SearchSupervisorInput,
  output: SearchSupervisorOutput
): SearchSupervisorOutput {
  if (!input.previousGoal || !input.pendingQuestion) {
    return output;
  }

  if (output.patch) {
    return {
      patch: normalizePendingAnswerPatch(input.previousGoal, output.patch),
      nextAction: 'plan',
    };
  }

  if (output.goal) {
    return {
      goal: UserGoalSchema.parse({
        ...output.goal,
        clarificationNeeded: [],
      }),
      nextAction: 'plan',
    };
  }

  logger.warn('SearchSupervisorAgent returned no goal patch for a pending clarification answer', {
    question: input.pendingQuestion.question,
  });
  throw new Error('SearchSupervisorAgent returned no goal patch for a pending clarification answer');
}

function normalizePendingAnswerPatch(previousGoal: UserGoal, patch: GoalPatch): GoalPatch {
  const alreadyReplacesTargets = patch.replacePrimaryKeywords !== undefined
    || patch.replaceRequestedItems !== undefined
    || patch.replaceCategories !== undefined;
  const addedTargets = [
    ...(patch.addRequestedItems ?? []).map((item) => item.name),
    ...(patch.addCategories ?? []).map((category) => category.name),
  ].filter(Boolean);

  if (alreadyReplacesTargets || addedTargets.length === 0 || !hasPrimaryTargets(previousGoal)) {
    return patch;
  }

  return GoalPatchSchema.parse({
    ...patch,
    replaceRequestedItems: patch.addRequestedItems ?? [],
    replaceCategories: patch.addCategories ?? [],
    replacePrimaryKeywords: addedTargets,
    addRequestedItems: undefined,
    addCategories: undefined,
  });
}

export async function understandSearchGoal(input: AgentInput): Promise<UserGoal> {
  const output = await runSearchSupervisor({
    message: input.query,
    previousGoal: input.runtimeState?.goal,
    preferenceSummary: input.preferenceSummary,
    messages: input.messages,
  });

  if (output.goal) {
    return output.goal;
  }

  if (output.patch && input.runtimeState?.goal) {
    return applyGoalPatch(input.runtimeState.goal, output.patch, input.query);
  }

  throw new Error('SearchSupervisorAgent returned no goal or patch');
}

export function applyGoalPatch(goal: UserGoal, patch: GoalPatch, rawQuery = goal.rawQuery): UserGoal {
  const replacingPrimaryTargets = patch.replacePrimaryKeywords !== undefined
    || patch.replaceRequestedItems !== undefined
    || patch.replaceCategories !== undefined;
  const patched: UserGoal = {
    ...goal,
    rawQuery,
    poiType: replacingPrimaryTargets ? undefined : goal.poiType,
    requestedItems: patch.replaceRequestedItems
      ?? mergeByName(goal.requestedItems, patch.addRequestedItems ?? []),
    acceptableCategories: patch.replaceCategories
      ?? mergeCategories(goal.acceptableCategories, patch.addCategories ?? []),
    relatedKeywords: replacingPrimaryTargets ? [] : goal.relatedKeywords,
    broadenedKeywords: replacingPrimaryTargets ? [] : goal.broadenedKeywords,
    softPreferences: mergePreferences(goal.softPreferences, patch.addSoftPreferences ?? []),
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

  const primaryKeywordBase = patch.replacePrimaryKeywords
    ?? (replacingPrimaryTargets
      ? [
          ...(patch.replaceRequestedItems ?? []).map((item) => item.name),
          ...(patch.replaceCategories ?? []).map((category) => category.name),
        ]
      : patched.primaryKeywords);
  patched.primaryKeywords = mergeStrings(
    primaryKeywordBase,
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
  if (!effect) {
    session.pendingQuestion = undefined;
    return;
  }

  const patch = goalPatchFromClarificationEffect(effect);
  const rawQuery = normalized && !goal.rawQuery.includes(normalized)
    ? `${goal.rawQuery}，${normalized}`
    : goal.rawQuery;
  session.goal = applyGoalPatch(goal, patch, rawQuery);
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

function hasPrimaryTargets(goal: UserGoal): boolean {
  return [
    ...goal.primaryKeywords,
    ...goal.requestedItems.map((item) => item.name),
    ...goal.acceptableCategories.map((category) => category.name),
  ].some((item) => item.trim().length > 0);
}

function goalPatchFromClarificationEffect(effect: ClarificationEffect): GoalPatch {
  const addConstraints: Constraint[] = [];
  const replaceRequestedItems = effect.replaceRequestedItems?.filter(Boolean);
  const replaceCategories = effect.replaceCategories?.filter(Boolean);
  const replacePrimaryKeywords = effect.replacePrimaryKeywords?.filter(Boolean);
  const addRequestedItems = effect.addRequestedItems?.filter(Boolean);
  const addCategories = effect.addCategories?.filter(Boolean);

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
    replaceRequestedItems: replaceRequestedItems?.length
      ? replaceRequestedItems.map((item) => ({
          name: item,
          required: true,
          aliases: [],
        }))
      : undefined,
    replaceCategories: replaceCategories?.length
      ? replaceCategories.map((category) => ({
          name: category,
          confidence: 0.8,
        }))
      : undefined,
    replacePrimaryKeywords: replacePrimaryKeywords?.length ? replacePrimaryKeywords : undefined,
    addRequestedItems: addRequestedItems?.length
      ? addRequestedItems.map((item) => ({
          name: item,
          required: true,
          aliases: [],
        }))
      : undefined,
    addCategories: addCategories?.length
      ? addCategories.map((category) => ({
          name: category,
          confidence: 0.8,
        }))
      : undefined,
    addSoftPreferences: effect.addSoftPreferences,
    addConstraints,
    removeConstraints: effect.setDistanceMaxMeters !== undefined
      ? ['楼下500米内', '步行1公里内']
      : undefined,
    allowBroaden: effect.allowBroaden,
    reason: '根据用户追问选项更新目标。',
  });
}

async function callSupervisorModel(
  input: SearchSupervisorInput,
  maxTokens = SUPERVISOR_MAX_TOKENS
): Promise<SearchSupervisorOutput> {
  return callJsonFunctionAgent({
    agentName: 'SearchSupervisorAgent',
    apiKey: OPENAI_API_KEY!,
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    input: {
      message: input.message,
      previousGoal: input.previousGoal,
      pendingQuestion: input.pendingQuestion,
      messages: input.messages?.slice(-8),
      failureReason: input.failureReason,
      attempts: input.attempts,
      verdictSummary: input.verdictSummary,
      preferenceSummary: input.preferenceSummary,
    },
    functionDefinition: SUPERVISOR_FUNCTION,
    functionName: 'superviseRestaurantSearch',
    schema: SearchSupervisorOutputSchema,
    temperature: 0,
    maxTokens,
    timeoutMs: SUPERVISOR_TIMEOUT,
  }) as Promise<SearchSupervisorOutput>;
}

function isTruncatedFunctionArgumentsError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes('returned truncated function arguments');
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

function mergePreferences(left: UserGoal['softPreferences'], right: UserGoal['softPreferences']): UserGoal['softPreferences'] {
  const byName = new Map<string, UserGoal['softPreferences'][number]>();
  for (const preference of [...left, ...right]) {
    const existing = byName.get(preference.name);
    byName.set(preference.name, {
      name: preference.name,
      weight: existing ? Math.max(existing.weight, preference.weight) : preference.weight,
      verifiable: existing ? existing.verifiable || preference.verifiable : preference.verifiable,
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
    additionalProperties: false,
    properties: {
      intent: { type: 'string', enum: ['find_restaurants'] },
      rawQuery: { type: 'string' },
      poiType: {
        type: 'string',
        description: '只有已有上下文非常确定时才保留；Supervisor 不要自行生成新的高德 POI typecode。',
      },
      requestedItems: {
        type: 'array',
        description: '必须命中的具体菜品、餐食或食物目标；不要放体验、氛围、人气、评分、环境、场景偏好。',
        items: requestedItemJsonSchema(),
      },
      acceptableCategories: {
        type: 'array',
        description: '能满足用户餐饮目标的菜系或餐厅类型，例如火锅、日料、西餐。',
        items: goalCategoryJsonSchema(),
      },
      alternativeGroups: {
        type: 'array',
        description: '多意图组，例如“日料或韩餐”为 any_of。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['any_of', 'all_of'] },
            items: { type: 'array', items: { type: 'string' } },
            minPerGroup: { type: 'number' },
          },
          required: ['mode', 'items'],
        },
      },
      primaryKeywords: {
        type: 'array',
        description: '搜索主关键词，只放适合高德 keywords 的单个菜品、菜系、餐厅类型；不要放整句、组合词或软偏好词。',
        items: { type: 'string' },
      },
      relatedKeywords: { type: 'array', items: { type: 'string' } },
      broadenedKeywords: {
        type: 'array',
        description: '上位或放宽关键词；只有用户授权 allowBroaden 后才能进入主推荐。',
        items: { type: 'string' },
      },
      hardConstraints: {
        type: 'array',
        description: '只放可由距离、预算、营业状态、排除项、不吃辣等事实字段稳定验证的硬限制。',
        items: constraintJsonSchema(),
      },
      softPreferences: {
        type: 'array',
        description: '体验、质量、氛围、人气、场景和排序倾向。不可稳定验证时 verifiable=false，且不能阻塞主推荐。',
        items: preferenceJsonSchema(),
      },
      exclusions: {
        type: 'array',
        description: '用户明确排除的菜系/品类。',
        items: { type: 'string' },
      },
      ambiguity: {
        type: 'array',
        description: '记录不可验证、歧义或需要提示用户的点。',
        items: { type: 'string' },
      },
      clarificationNeeded: {
        type: 'array',
        items: clarificationNeedJsonSchema(),
      },
      allowBroaden: {
        type: 'boolean',
        description: '只有用户明确允许放宽、候补、随便推荐等开放需求时才为 true。',
      },
    },
    required: [
      'intent',
      'rawQuery',
      'requestedItems',
      'acceptableCategories',
      'alternativeGroups',
      'primaryKeywords',
      'relatedKeywords',
      'broadenedKeywords',
      'hardConstraints',
      'softPreferences',
      'exclusions',
      'ambiguity',
      'clarificationNeeded',
      'allowBroaden',
    ],
  };
}

function goalPatchJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      replaceRequestedItems: {
        type: 'array',
        description: '当用户在澄清回答中改了主目标时，用新的具体菜品/餐食替换旧主目标。',
        items: requestedItemJsonSchema(),
      },
      replaceCategories: {
        type: 'array',
        description: '当用户在澄清回答中改了主目标时，用新的菜系或餐厅类型替换旧主目标。',
        items: goalCategoryJsonSchema(),
      },
      replacePrimaryKeywords: {
        type: 'array',
        description: '替换后的高德 keywords 主搜索词；只放单个餐饮意图词。',
        items: { type: 'string' },
      },
      addRequestedItems: {
        type: 'array',
        description: '新增必须命中的具体菜品/餐食；不要用于软偏好。',
        items: requestedItemJsonSchema(),
      },
      addCategories: {
        type: 'array',
        description: '新增可接受菜系或餐厅类型。',
        items: goalCategoryJsonSchema(),
      },
      addSoftPreferences: {
        type: 'array',
        description: '新增软偏好；人气、氛围、环境、适合场景、评价倾向等都放这里。',
        items: preferenceJsonSchema(),
      },
      addConstraints: {
        type: 'array',
        description: '新增可稳定验证的硬约束。',
        items: constraintJsonSchema(),
      },
      removeConstraints: { type: 'array', items: { type: 'string' } },
      allowBroaden: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['reason'],
  };
}

function pendingQuestionJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reason: { type: 'string' },
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      allowFreeText: { type: 'boolean' },
      optionEffects: {
        type: 'object',
        additionalProperties: clarificationEffectJsonSchema(),
      },
    },
    required: ['question'],
  };
}

function requestedItemJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      required: { type: 'boolean' },
      aliases: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'required', 'aliases'],
  };
}

function goalCategoryJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['name', 'confidence'],
  };
}

function preferenceJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      weight: { type: 'number' },
      verifiable: {
        type: 'boolean',
        description: '只有当前事实字段能稳定验证该偏好时为 true；人气/氛围/环境/适合场景通常为 false。',
      },
    },
    required: ['name', 'weight', 'verifiable'],
  };
}

function constraintJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['distance', 'avoid_spicy', 'exclude_category', 'budget', 'open_now'] },
      label: { type: 'string' },
      value: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'array', items: { type: 'string' } },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
            },
          },
        ],
      },
      strict: { type: 'boolean' },
      maxMeters: { type: 'number' },
      values: { type: 'array', items: { type: 'string' } },
      min: { type: 'number' },
      max: { type: 'number' },
    },
    required: ['kind', 'label'],
  };
}

function clarificationNeedJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      reason: { type: 'string' },
      question: { type: 'string' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
            effect: clarificationEffectJsonSchema(),
          },
          required: ['label', 'value'],
        },
      },
      allowFreeText: { type: 'boolean' },
    },
    required: ['reason', 'question', 'allowFreeText'],
  };
}

function clarificationEffectJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      replaceRequestedItems: { type: 'array', items: { type: 'string' } },
      replaceCategories: { type: 'array', items: { type: 'string' } },
      replacePrimaryKeywords: { type: 'array', items: { type: 'string' } },
      addRequestedItems: { type: 'array', items: { type: 'string' } },
      addCategories: { type: 'array', items: { type: 'string' } },
      addSoftPreferences: { type: 'array', items: preferenceJsonSchema() },
      setDistanceMaxMeters: { type: 'number' },
      allowBroaden: { type: 'boolean' },
    },
  };
}
