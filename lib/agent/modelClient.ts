import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { recordModelCall, type MetricsSink, type ModelCallMetrics } from './metrics';
import { AgentError, isAgentError } from './types';
import type { AgentErrorCode } from './types';
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

export interface StructuredModelInputEnvelope {
  trustedContext?: unknown;
  userMessage?: unknown;
  toolObservations?: unknown;
  policy?: unknown;
}

export const STRUCTURED_MODEL_MAX_TOKENS = 4096;
export const STRUCTURED_MODEL_RETRY_MAX_TOKENS = 8192;
const SCHEMA_REPAIR_PROMPT = `上一轮函数参数没有通过运行时 schema 校验。你必须重新调用同一个函数，只修复字段结构，不改变用户目标。
- 不要省略 required 字段。
- required 字符串字段必须是非空文本。
- 如果输出追问，question.question 必须是一句可直接展示给用户的中文问题，不能留空或省略。`;

export interface StructuredModelOptions<T> {
  modelRole: string;
  /** 可选指标容器；传入后每次模型调用都会记录耗时、token、重试与降级情况。 */
  metricsSink?: MetricsSink;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  input: StructuredModelInputEnvelope | unknown;
  functionDefinition: ChatFunctionDefinition;
  functionName: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  temperature: number;
  maxTokens: number;
  retryMaxTokens?: number;
  timeoutMs: number;
}

export interface StructuredModelParsingOptions<T> {
  modelRole: string;
  functionName: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

export interface StructuredModelParseResult<T> {
  ok: boolean;
  truncated: boolean;
  data?: T;
  error?: Error;
}

export async function callStructuredModel<T>(
  options: StructuredModelOptions<T>
): Promise<T> {
  const tracker = createMetricsTracker(options);

  try {
    const result = await runStructuredModelCall(options, tracker);
    tracker.finish(true);
    return result;
  } catch (error) {
    tracker.finish(false);
    // 走到这里还不是 AgentError 的，只可能是"模型可达但输出不合法/被截断"，
    // 传输层异常已经在 requestStructuredModel 里定过码了。
    throw isAgentError(error)
      ? error
      : new AgentError(
          error instanceof Error ? error.message : String(error),
          'MODEL_INVALID_OUTPUT',
          true,
          { cause: error }
        );
  }
}

async function runStructuredModelCall<T>(
  options: StructuredModelOptions<T>,
  tracker: MetricsTracker
): Promise<T> {
  const first = parseStructuredModelResponse(
    tracker.track(await requestStructuredModel(options, options.maxTokens)),
    options
  );

  if (first.ok && !first.truncated) {
    return first.data as T;
  }

  if (shouldRetryTruncatedFunctionArguments(options, first)) {
    logger.warn(`${options.modelRole} response was truncated, retrying with a larger token budget`, {
      maxTokens: options.maxTokens,
      retryMaxTokens: options.retryMaxTokens,
    });

    const retry = parseStructuredModelResponse(
      tracker.track(await requestStructuredModel(options, options.retryMaxTokens!)),
      options
    );

    if (retry.ok) {
      if (retry.truncated) {
        logger.warn(`${options.modelRole} retry response was still truncated; using repaired function arguments`, {
          retryMaxTokens: options.retryMaxTokens,
        });
      }
      return retry.data as T;
    }

    if (first.ok) {
      logger.warn(`${options.modelRole} retry failed; using repaired first function arguments`, {
        error: retry.error?.message,
      });
      return first.data as T;
    }

    throw retry.error ?? first.error ?? truncatedFunctionArgumentsError(options.modelRole);
  }

  if (shouldRetryInvalidFunctionArguments(first)) {
    logger.warn(`${options.modelRole} returned invalid function arguments, retrying with a schema repair instruction`, {
      error: first.error?.message,
    });

    const retry = parseStructuredModelResponse(
      tracker.track(await requestStructuredModel(
        withSchemaRepairInstruction(options, first.error),
        options.maxTokens
      )),
      options
    );

    if (retry.ok) {
      return retry.data as T;
    }

    throw retry.error ?? first.error ?? new Error(`${options.modelRole} returned invalid function arguments`);
  }

  if (first.ok) {
    return first.data as T;
  }

  throw first.error ?? new Error(`${options.modelRole} returned invalid function arguments`);
}

interface MetricsTracker {
  /** 记录一次 HTTP 往返，并原样返回响应体供后续解析。 */
  track(outcome: RequestOutcome): ChatCompletionFunctionResponse;
  finish(ok: boolean): void;
}

function createMetricsTracker<T>(options: StructuredModelOptions<T>): MetricsTracker {
  const startedAt = Date.now();
  const state: Omit<ModelCallMetrics, 'durationMs' | 'ok'> = {
    modelRole: options.modelRole,
    model: options.model,
    startedAt,
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

export function parseStructuredModelResponse<T>(
  data: ChatCompletionFunctionResponse,
  options: StructuredModelParsingOptions<T>
): StructuredModelParseResult<T> {
  const args = extractModelFunctionArguments(data, options.functionName);
  const truncated = isModelFunctionOutputTruncated(data, args);

  if (!args) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.modelRole)
        : new Error(`${options.modelRole} returned no function arguments`),
    };
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = parseModelJsonArguments(args, options.modelRole);
  } catch (error) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.modelRole)
        : asError(error),
    };
  }

  const parsed = options.schema.safeParse(parsedArgs);
  if (!parsed.success) {
    return {
      ok: false,
      truncated,
      error: truncated
        ? truncatedFunctionArgumentsError(options.modelRole)
        : new Error(`${options.modelRole} returned invalid schema: ${parsed.error.message}`),
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

async function requestStructuredModel<T>(
  options: StructuredModelOptions<T>,
  maxTokens: number
): Promise<RequestOutcome> {
  const modes = preferredToolCallModes();
  let lastError: Error | undefined;
  let attempts = 0;

  for (const mode of modes) {
    attempts += 1;
    const response = await requestChatCompletion(options, maxTokens, mode);

    if (response.ok) {
      return { data: await response.json(), mode, attempts };
    }

    const error = await buildChatCompletionError(options.modelRole, options.model, mode, response);
    if (mode === 'tools' && response.status === 400 && modes.includes('functions')) {
      logger.warn(`${options.modelRole} modern tool call request failed; retrying legacy function_call format`, {
        error: error.message,
        model: options.model,
      });
      lastError = error;
      continue;
    }

    throw error;
  }

  throw lastError ?? new Error(`${options.modelRole} API failed`);
}

/**
 * 发一次 chat/completions。
 *
 * 传输层异常（超时、DNS、连接重置）在这里定码：它们不经过 HTTP 状态分类，
 * 不定码的话下游只能看到 UNKNOWN，无法判断该不该让用户重试。
 */
async function requestChatCompletion<T>(
  options: StructuredModelOptions<T>,
  maxTokens: number,
  mode: ChatToolCallMode
): Promise<Response> {
  try {
    return await fetchWithTimeout(
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
  } catch (error) {
    throw new AgentError(
      `${options.modelRole} API request failed: ${error instanceof Error ? error.message : String(error)}`,
      'MODEL_UNAVAILABLE',
      true,
      { cause: error }
    );
  }
}

function buildChatCompletionRequestBody<T>(
  options: StructuredModelOptions<T>,
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

function shouldDisableQwenThinkingForForcedTool<T>(options: StructuredModelOptions<T>): boolean {
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
  modelRole: string,
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

  // 错误码在这里定：HTTP 状态是最可靠的信号，比下游对文案做子串匹配准。
  const { code, retryable } = classifyChatCompletionStatus(response.status);

  return new AgentError(
    `${modelRole} API failed: ${response.status}${details ? ` - ${details}` : ''}`,
    code,
    retryable
  );
}

/**
 * HTTP 状态 → 错误码与可恢复性。
 *
 * 可恢复性直接决定前端给不给"重试"按钮，所以配额耗尽（402/403）必须与
 * 限流（429）分开：前者重试一万次也不会成功，给重试入口是错误引导。
 */
function classifyChatCompletionStatus(status: number): {
  code: AgentErrorCode;
  retryable: boolean;
} {
  if (status === 401) {
    return { code: 'CONFIG_MISSING', retryable: false };
  }

  if (status === 402 || status === 403) {
    return { code: 'MODEL_QUOTA_EXHAUSTED', retryable: false };
  }

  if (status === 429) {
    return { code: 'RATE_LIMITED', retryable: true };
  }

  if (status >= 500) {
    return { code: 'MODEL_UNAVAILABLE', retryable: true };
  }

  return { code: 'UNKNOWN', retryable: false };
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

function normalizeAgentInput(input: StructuredModelInputEnvelope | unknown): StructuredModelInputEnvelope {
  if (isRecord(input) && hasEnvelopeKeys(input)) {
    return input as StructuredModelInputEnvelope;
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
  options: StructuredModelOptions<T>,
  result: StructuredModelParseResult<T>
): boolean {
  return result.truncated
    && typeof options.retryMaxTokens === 'number'
    && options.retryMaxTokens > options.maxTokens;
}

function shouldRetryInvalidFunctionArguments<T>(
  result: StructuredModelParseResult<T>
): boolean {
  return !result.ok && !result.truncated;
}

function withSchemaRepairInstruction<T>(
  options: StructuredModelOptions<T>,
  error: Error | undefined
): StructuredModelOptions<T> {
  return {
    ...options,
    systemPrompt: `${options.systemPrompt}\n\n${SCHEMA_REPAIR_PROMPT}`,
    input: buildSchemaRepairInput(options.input, error),
  };
}

function buildSchemaRepairInput(
  input: StructuredModelInputEnvelope | unknown,
  error: Error | undefined
): StructuredModelInputEnvelope {
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

function truncatedFunctionArgumentsError(modelRole: string): Error {
  return new Error(`${modelRole} returned truncated function arguments`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
