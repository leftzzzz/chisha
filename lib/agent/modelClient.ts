import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { recordModelCall, type MetricsSink, type ModelCallMetrics } from './metrics';
import {
  extractModelFunctionArguments,
  isModelFunctionOutputTruncated,
  parseModelJsonArguments,
  type ChatCompletionFunctionResponse,
} from './modelJson';

interface ChatFunctionDefinition {
  name: string;
  description?: string;
  parameters: unknown;
}

type ChatToolCallMode = 'tools' | 'functions';

interface ChatCompletionRequestBody {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  tools?: Array<{
    type: 'function';
    function: ChatFunctionDefinition;
  }>;
  tool_choice?: {
    type: 'function';
    function: { name: string };
  };
  functions?: ChatFunctionDefinition[];
  function_call?: { name: string };
  temperature?: number;
  max_completion_tokens?: number;
  max_tokens?: number;
  enable_thinking?: boolean;
}

export interface JsonFunctionAgentInputEnvelope {
  trustedContext?: unknown;
  userMessage?: unknown;
  toolObservations?: unknown;
  policy?: unknown;
}

export const JSON_FUNCTION_MAX_TOKENS = 4096;
export const JSON_FUNCTION_RETRY_MAX_TOKENS = 8192;
const SCHEMA_REPAIR_PROMPT = `上一轮函数参数没有通过运行时 schema 校验。你必须重新调用同一个函数，只修复字段结构，不改变用户目标。
- 不要省略 required 字段。
- required 字符串字段必须是非空文本。
- 如果输出追问，question.question 必须是一句可直接展示给用户的中文问题，不能留空或省略。`;

export interface JsonFunctionAgentOptions<T> {
  agentName: string;
  /** 可选指标容器；传入后每次模型调用都会记录耗时、token、重试与降级情况。 */
  metricsSink?: MetricsSink;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  input: JsonFunctionAgentInputEnvelope | unknown;
  functionDefinition: ChatFunctionDefinition;
  functionName: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  temperature: number;
  maxTokens: number;
  retryMaxTokens?: number;
  timeoutMs: number;
}

export interface JsonFunctionParsingOptions<T> {
  agentName: string;
  functionName: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

export interface JsonFunctionParseResult<T> {
  ok: boolean;
  truncated: boolean;
  data?: T;
  error?: Error;
}

export async function callJsonFunctionAgent<T>(
  options: JsonFunctionAgentOptions<T>
): Promise<T> {
  const tracker = createMetricsTracker(options);

  try {
    const result = await runJsonFunctionAgent(options, tracker);
    tracker.finish(true);
    return result;
  } catch (error) {
    tracker.finish(false);
    throw error;
  }
}

async function runJsonFunctionAgent<T>(
  options: JsonFunctionAgentOptions<T>,
  tracker: MetricsTracker
): Promise<T> {
  const first = parseJsonFunctionAgentResponse(
    tracker.track(await requestJsonFunctionAgent(options, options.maxTokens)),
    options
  );

  if (first.ok && !first.truncated) {
    return first.data as T;
  }

  if (shouldRetryTruncatedFunctionArguments(options, first)) {
    logger.warn(`${options.agentName} response was truncated, retrying with a larger token budget`, {
      maxTokens: options.maxTokens,
      retryMaxTokens: options.retryMaxTokens,
    });

    const retry = parseJsonFunctionAgentResponse(
      tracker.track(await requestJsonFunctionAgent(options, options.retryMaxTokens!)),
      options
    );

    if (retry.ok) {
      if (retry.truncated) {
        logger.warn(`${options.agentName} retry response was still truncated; using repaired function arguments`, {
          retryMaxTokens: options.retryMaxTokens,
        });
      }
      return retry.data as T;
    }

    if (first.ok) {
      logger.warn(`${options.agentName} retry failed; using repaired first function arguments`, {
        error: retry.error?.message,
      });
      return first.data as T;
    }

    throw retry.error ?? first.error ?? truncatedFunctionArgumentsError(options.agentName);
  }

  if (shouldRetryInvalidFunctionArguments(first)) {
    logger.warn(`${options.agentName} returned invalid function arguments, retrying with a schema repair instruction`, {
      error: first.error?.message,
    });

    const retry = parseJsonFunctionAgentResponse(
      tracker.track(await requestJsonFunctionAgent(
        withSchemaRepairInstruction(options, first.error),
        options.maxTokens
      )),
      options
    );

    if (retry.ok) {
      return retry.data as T;
    }

    throw retry.error ?? first.error ?? new Error(`${options.agentName} returned invalid function arguments`);
  }

  if (first.ok) {
    return first.data as T;
  }

  throw first.error ?? new Error(`${options.agentName} returned invalid function arguments`);
}

interface MetricsTracker {
  /** 记录一次 HTTP 往返，并原样返回响应体供后续解析。 */
  track(outcome: RequestOutcome): ChatCompletionFunctionResponse;
  finish(ok: boolean): void;
}

function createMetricsTracker<T>(options: JsonFunctionAgentOptions<T>): MetricsTracker {
  const startedAt = Date.now();
  const state: Omit<ModelCallMetrics, 'durationMs' | 'ok'> = {
    agentName: options.agentName,
    model: options.model,
    promptTokens: undefined,
    completionTokens: undefined,
    attempts: 0,
    mode: 'tools',
    truncated: false,
  };

  return {
    track(outcome) {
      state.attempts += outcome.attempts;
      state.mode = outcome.mode;
      state.promptTokens = addTokens(state.promptTokens, outcome.data.usage?.prompt_tokens);
      state.completionTokens = addTokens(state.completionTokens, outcome.data.usage?.completion_tokens);
      if (outcome.data.choices?.[0]?.finish_reason === 'length') {
        state.truncated = true;
      }
      return outcome.data;
    },
    finish(ok) {
      recordModelCall(options.metricsSink, {
        ...state,
        durationMs: Date.now() - startedAt,
        ok,
      });
    },
  };
}

function addTokens(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) {
    return current;
  }

  return (current ?? 0) + next;
}

export function parseJsonFunctionAgentResponse<T>(
  data: ChatCompletionFunctionResponse,
  options: JsonFunctionParsingOptions<T>
): JsonFunctionParseResult<T> {
  const args = extractModelFunctionArguments(data, options.functionName);
  const truncated = isModelFunctionOutputTruncated(data, args);

  if (!args) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.agentName)
        : new Error(`${options.agentName} returned no function arguments`),
    };
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = parseModelJsonArguments(args, options.agentName);
  } catch (error) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.agentName)
        : asError(error),
    };
  }

  const parsed = options.schema.safeParse(parsedArgs);
  if (!parsed.success) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.agentName)
        : new Error(`${options.agentName} returned invalid schema: ${parsed.error.message}`),
    };
  }

  return {
    ok: true,
    truncated,
    data: parsed.data,
  };
}

interface RequestOutcome {
  data: ChatCompletionFunctionResponse;
  mode: ChatToolCallMode;
  attempts: number;
}

async function requestJsonFunctionAgent<T>(
  options: JsonFunctionAgentOptions<T>,
  maxTokens: number
): Promise<RequestOutcome> {
  const modes = preferredToolCallModes();
  let lastError: Error | undefined;
  let attempts = 0;

  for (const mode of modes) {
    attempts += 1;
    const response = await fetchWithTimeout(
      `${options.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(buildChatCompletionRequestBody(options, maxTokens, mode)),
      },
      options.timeoutMs
    );

    if (response.ok) {
      return { data: await response.json(), mode, attempts };
    }

    const error = await buildChatCompletionError(options.agentName, options.model, mode, response);
    if (mode === 'tools' && response.status === 400 && modes.includes('functions')) {
      logger.warn(`${options.agentName} modern tool call request failed; retrying legacy function_call format`, {
        error: error.message,
        model: options.model,
      });
      lastError = error;
      continue;
    }

    throw error;
  }

  throw lastError ?? new Error(`${options.agentName} API failed`);
}

function buildChatCompletionRequestBody<T>(
  options: JsonFunctionAgentOptions<T>,
  maxTokens: number,
  mode: ChatToolCallMode
): ChatCompletionRequestBody {
  const body: ChatCompletionRequestBody = {
    model: options.model,
    messages: [
      {
        role: 'system',
        content: options.systemPrompt,
      },
      {
        role: 'user',
        content: JSON.stringify(normalizeAgentInput(options.input)),
      },
    ],
  };

  if (mode === 'tools') {
    body.tools = [{
      type: 'function',
      function: options.functionDefinition,
    }];
    body.tool_choice = {
      type: 'function',
      function: { name: options.functionName },
    };
    body.max_completion_tokens = maxTokens;
  } else {
    body.functions = [options.functionDefinition];
    body.function_call = { name: options.functionName };
    body.max_tokens = maxTokens;
  }

  if (shouldIncludeTemperature(options.model)) {
    body.temperature = options.temperature;
  }

  if (shouldDisableQwenThinkingForForcedTool(options)) {
    body.enable_thinking = false;
  }

  return body;
}

function preferredToolCallModes(): ChatToolCallMode[] {
  return process.env.OPENAI_TOOL_CALL_MODE === 'functions'
    ? ['functions']
    : ['tools', 'functions'];
}

function shouldIncludeTemperature(model: string): boolean {
  return !isReasoningChatModel(model);
}

function isReasoningChatModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return /^o\d/.test(normalized) || normalized.startsWith('gpt-5');
}

function shouldDisableQwenThinkingForForcedTool<T>(options: JsonFunctionAgentOptions<T>): boolean {
  const override = process.env.QWEN_ENABLE_THINKING?.toLowerCase();
  if (override === 'true') {
    return false;
  }

  if (override === 'false') {
    return true;
  }

  return isQwenCompatibleRequest(options.model, options.baseUrl);
}

function isQwenCompatibleRequest(model: string, baseUrl: string): boolean {
  const normalizedModel = model.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();
  return normalizedModel.startsWith('qwen')
    || normalizedBaseUrl.includes('dashscope')
    || normalizedBaseUrl.includes('qwen');
}

async function buildChatCompletionError(
  agentName: string,
  model: string,
  mode: ChatToolCallMode,
  response: Response
): Promise<Error> {
  const responseBody = await readResponseBody(response);
  const apiMessage = extractApiErrorMessage(responseBody);
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('openai-request-id');
  const details = [
    apiMessage,
    requestId ? `request_id=${requestId}` : undefined,
    `model=${model}`,
    `tool_call_mode=${mode}`,
  ].filter(Boolean).join('; ');

  return new Error(`${agentName} API failed: ${response.status}${details ? ` - ${details}` : ''}`);
}

async function readResponseBody(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function extractApiErrorMessage(responseBody: string | null): string | undefined {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(responseBody) as {
      error?: {
        message?: string;
        type?: string;
        code?: string;
      };
      message?: string;
    };
    const message = parsed.error?.message ?? parsed.message;
    const type = parsed.error?.type;
    const code = parsed.error?.code;
    return [
      message,
      type ? `type=${type}` : undefined,
      code ? `code=${code}` : undefined,
    ].filter(Boolean).join('; ');
  } catch {
    return responseBody.slice(0, 500);
  }
}

function normalizeAgentInput(input: JsonFunctionAgentInputEnvelope | unknown): JsonFunctionAgentInputEnvelope {
  if (isRecord(input) && hasEnvelopeKeys(input)) {
    return input as JsonFunctionAgentInputEnvelope;
  }

  return { trustedContext: input };
}

function hasEnvelopeKeys(input: Record<string, unknown>): boolean {
  return [
    'trustedContext',
    'userMessage',
    'toolObservations',
    'policy',
  ].some((key) => key in input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldRetryTruncatedFunctionArguments<T>(
  options: JsonFunctionAgentOptions<T>,
  result: JsonFunctionParseResult<T>
): boolean {
  return result.truncated
    && typeof options.retryMaxTokens === 'number'
    && options.retryMaxTokens > options.maxTokens;
}

function shouldRetryInvalidFunctionArguments<T>(
  result: JsonFunctionParseResult<T>
): boolean {
  return !result.ok && !result.truncated;
}

function withSchemaRepairInstruction<T>(
  options: JsonFunctionAgentOptions<T>,
  error: Error | undefined
): JsonFunctionAgentOptions<T> {
  return {
    ...options,
    systemPrompt: `${options.systemPrompt}\n\n${SCHEMA_REPAIR_PROMPT}`,
    input: buildSchemaRepairInput(options.input, error),
  };
}

function buildSchemaRepairInput(
  input: JsonFunctionAgentInputEnvelope | unknown,
  error: Error | undefined
): JsonFunctionAgentInputEnvelope {
  const normalized = normalizeAgentInput(input);
  const previousPolicy = isRecord(normalized.policy) ? normalized.policy : {};

  return {
    ...normalized,
    policy: {
      ...previousPolicy,
      schemaRepair: {
        previousError: error?.message ?? 'Unknown schema validation error',
      },
    },
  };
}

function truncatedFunctionArgumentsError(agentName: string): Error {
  return new Error(`${agentName} returned truncated function arguments`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
