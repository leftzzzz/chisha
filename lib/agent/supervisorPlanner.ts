/**
 * Supervisor 的模型入口。
 *
 * 常规轮次的动作决策已经完全交给 `policy.decideNextAction`——那些"下一个搜
 * 哪个词、够不够可以结束"的判断是可枚举的，代码算得比模型快也比模型稳。
 * 模型只保留两处：理解目标（runSearchSupervisor），以及确定性关键词全部试完
 * 仍然没有主推荐时重新构思方向（runSearchReplan）。后者一轮最多一次。
 */

import { logger } from '@/lib/logger';
import {
  callJsonFunctionAgent,
  JSON_FUNCTION_MAX_TOKENS,
  JSON_FUNCTION_RETRY_MAX_TOKENS,
} from './modelClient';
import type { MetricsSink } from './metrics';
import { ReplanOutputSchema } from './schemas/replan';
import {
  runSearchSupervisor,
  type SearchSupervisorInput,
  type SearchSupervisorOutput,
} from './supervisor';
import type {
  AgentAction,
  AgentActionRecord,
  AgentMessage,
  AgentObservation,
  PendingQuestion,
  SearchAttempt,
  SearchIntent,
  SearchKeywordTarget,
  UserGoal,
  UserPreferenceSummary,
} from './types';

export {
  applyGoalPatch,
  applySupervisorClarifyingAnswer,
  clarificationNeedToPendingQuestion,
  understandSearchGoal,
} from './supervisor';
export type { SearchSupervisorInput, SearchSupervisorOutput } from './supervisor';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL_PLANNER
  || process.env.OPENAI_MODEL
  || 'gpt-4o';
const REPLAN_TIMEOUT = 60000;

export type SupervisorPlannerInput = SearchSupervisorInput;
export type SupervisorPlannerOutput = SearchSupervisorOutput;

export interface SearchReplanInput {
  metricsSink?: MetricsSink;
  message: string;
  goal: UserGoal;
  messages: AgentMessage[];
  attempts: SearchAttempt[];
  observations: AgentObservation[];
  exhausted: {
    triedKeywords: string[];
    triedIntents: SearchIntent[];
  };
  preferenceSummary?: UserPreferenceSummary;
}

export interface SearchReplanOutput {
  targets?: SearchKeywordTarget[];
  question?: PendingQuestion;
  rationale?: string;
}

const REPLAN_SYSTEM_PROMPT = `你是餐厅搜索的 replan 助手。确定性策略已经把已知搜索词全部试完，仍然没有可推荐的餐厅。

你只有两个选择：
1. targets：给出 1-3 个还没试过的高德搜索词，让搜索继续。每个词必须是单个餐饮意图词（如"牛排""川菜""咖啡"），不能是整句、组合词或形容词。
2. question：如果确实没有值得再试的方向，提一个贴合当前上下文的中文问句，帮用户把需求改到可搜的方向上。

规则：
- 不要重复 triedKeywords 里已经试过的词。
- 不要输出用户明确排除的品类。
- 不要编造餐厅事实。
- 不要生成高德 typecode。
- 只输出其中一项；两项都给时以 targets 为准。
- 两项都想不出来时全部留空，不要硬凑。`;

const REPLAN_FUNCTION = {
  name: 'replanRestaurantSearch',
  description: 'Propose new search keywords or one clarifying question after deterministic strategies are exhausted.',
  parameters: {
    type: 'object',
    properties: {
      targets: {
        type: 'array',
        description: '还没试过的单意图搜索词，最多 3 个。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            keyword: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['keyword'],
        },
      },
      question: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reason: { type: 'string', minLength: 1, maxLength: 240 },
          question: { type: 'string', minLength: 1, maxLength: 160 },
          options: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 32 } },
          allowFreeText: { type: 'boolean' },
        },
        required: ['question'],
      },
      rationale: { type: 'string' },
    },
  },
};

export async function runSupervisorPlanner(
  input: SupervisorPlannerInput
): Promise<SupervisorPlannerOutput> {
  return runSearchSupervisor(input);
}

/**
 * 策略枯竭时重新构思搜索方向。
 *
 * 返回 null 表示模型不可用或没有给出可执行方向，调用方回落到模板追问。
 */
export async function runSearchReplan(
  input: SearchReplanInput
): Promise<SearchReplanOutput | null> {
  if (!OPENAI_API_KEY || isDeterministicMode()) {
    return null;
  }

  try {
    const output = await callJsonFunctionAgent({
      agentName: 'SearchReplanAgent',
      metricsSink: input.metricsSink,
      apiKey: OPENAI_API_KEY,
      baseUrl: OPENAI_BASE_URL,
      model: OPENAI_MODEL,
      systemPrompt: REPLAN_SYSTEM_PROMPT,
      input: buildReplanModelInput(input),
      functionDefinition: REPLAN_FUNCTION,
      functionName: 'replanRestaurantSearch',
      schema: ReplanOutputSchema,
      temperature: 0.2,
      maxTokens: JSON_FUNCTION_MAX_TOKENS,
      retryMaxTokens: JSON_FUNCTION_RETRY_MAX_TOKENS,
      timeoutMs: REPLAN_TIMEOUT,
    });

    return sanitizeReplanOutput(output, input);
  } catch (error) {
    logger.warn('SearchReplanAgent unavailable, falling back to a templated question', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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

/**
 * 是否强制走确定性分支。
 *
 * 用显式开关而不是 NODE_ENV==='test'：后者让模型决策路径在测试中完全不可达，
 * 覆盖率为 0。测试默认开启（jest.setup.js），需要测模型路径的用例自行关闭。
 */
function isDeterministicMode(): boolean {
  return process.env.AGENT_DETERMINISTIC === '1';
}

function buildReplanModelInput(input: SearchReplanInput) {
  return {
    userMessage: input.message,
    trustedContext: {
      goal: {
        rawQuery: input.goal.rawQuery,
        requestedItems: input.goal.requestedItems,
        acceptableCategories: input.goal.acceptableCategories,
        primaryKeywords: input.goal.primaryKeywords,
        hardConstraints: input.goal.hardConstraints,
        softPreferences: input.goal.softPreferences,
        exclusions: input.goal.exclusions,
        allowBroaden: input.goal.allowBroaden,
      },
      messages: input.messages.slice(-6),
      preferenceSummary: input.preferenceSummary,
      exhausted: input.exhausted,
    },
    toolObservations: {
      untrusted: true,
      attempts: input.attempts.map((attempt) => ({
        keywords: attempt.keywords,
        searchIntent: attempt.searchIntent,
        found: attempt.found,
        accepted: attempt.accepted,
      })),
      unmetConstraints: Array.from(new Set(
        input.observations.flatMap((observation) => observation.unmetConstraints)
      )).slice(0, 8),
    },
    policy: {
      toolObservationsAreUntrusted: true,
      doNotRepeatTriedKeywords: true,
      doNotInventRestaurantFacts: true,
    },
  };
}

/** 丢掉已试过的、命中排除项的和空词；模型给不出新东西时视为没有方向。 */
function sanitizeReplanOutput(
  output: { targets?: Array<{ keyword: string; reason?: string }>; question?: PendingQuestion; rationale?: string },
  input: SearchReplanInput
): SearchReplanOutput | null {
  const tried = new Set(input.exhausted.triedKeywords);
  const targets = (output.targets ?? [])
    .map((target) => target.keyword.trim())
    .filter((keyword) =>
      keyword.length > 0
      && !tried.has(keyword)
      && !input.goal.exclusions.some((exclusion) => exclusion && keyword.includes(exclusion))
    )
    .slice(0, 3)
    .map((keyword) => ({ keyword }));

  if (targets.length > 0) {
    return { targets, rationale: output.rationale };
  }

  return output.question ? { question: output.question, rationale: output.rationale } : null;
}

function createActionId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `action_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
