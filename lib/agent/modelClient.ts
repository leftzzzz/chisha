import type { z } from 'zod';
import { logger } from '@/lib/logger';
import { fetchWithTimeout } from '@/lib/withTimeout';
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

export interface JsonFunctionAgentInputEnvelope {
  trustedContext?: unknown;
  userMessage?: unknown;
  toolObservations?: unknown;
  policy?: unknown;
}

export const JSON_FUNCTION_MAX_TOKENS = 4096;
export const JSON_FUNCTION_RETRY_MAX_TOKENS = 8192;

export interface JsonFunctionAgentOptions<T> {
  agentName: string;
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
  const first = parseJsonFunctionAgentResponse(
    await requestJsonFunctionAgent(options, options.maxTokens),
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
      await requestJsonFunctionAgent(options, options.retryMaxTokens!),
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

  if (first.ok) {
    return first.data as T;
  }

  throw first.error ?? new Error(`${options.agentName} returned invalid function arguments`);
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

async function requestJsonFunctionAgent<T>(
  options: JsonFunctionAgentOptions<T>,
  maxTokens: number
): Promise<ChatCompletionFunctionResponse> {
  const response = await fetchWithTimeout(
    `${options.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
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
        functions: [options.functionDefinition],
        function_call: { name: options.functionName },
        temperature: options.temperature,
        max_tokens: maxTokens,
      }),
    },
    options.timeoutMs
  );

  if (!response.ok) {
    throw new Error(`${options.agentName} API failed: ${response.status}`);
  }

  return response.json();
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

function truncatedFunctionArgumentsError(agentName: string): Error {
  return new Error(`${agentName} returned truncated function arguments`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
