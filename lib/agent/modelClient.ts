import type { z } from 'zod';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { parseModelJsonArguments } from './modelJson';

interface ChatFunctionDefinition {
  name: string;
  description?: string;
  parameters: unknown;
}

export interface JsonFunctionAgentOptions<T> {
  agentName: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  input: unknown;
  functionDefinition: ChatFunctionDefinition;
  functionName: string;
  schema: z.ZodType<T>;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export async function callJsonFunctionAgent<T>(
  options: JsonFunctionAgentOptions<T>
): Promise<T> {
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
            role: 'user',
            content: `${options.systemPrompt}\n\n${JSON.stringify(options.input)}`,
          },
        ],
        functions: [options.functionDefinition],
        function_call: { name: options.functionName },
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    },
    options.timeoutMs
  );

  if (!response.ok) {
    throw new Error(`${options.agentName} API failed: ${response.status}`);
  }

  const data = await response.json();
  const args = extractFunctionArguments(data);
  if (!args) {
    throw new Error(`${options.agentName} returned no function arguments`);
  }

  if (data.choices?.[0]?.finish_reason === 'length' || !hasCompleteJsonStructure(args)) {
    throw new Error(`${options.agentName} returned truncated function arguments`);
  }

  const parsed = options.schema.safeParse(
    parseModelJsonArguments(args, options.agentName)
  );
  if (!parsed.success) {
    throw new Error(`${options.agentName} returned invalid schema: ${parsed.error.message}`);
  }

  return parsed.data;
}

function extractFunctionArguments(data: {
  choices?: Array<{
    finish_reason?: string;
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

function hasCompleteJsonStructure(content: string): boolean {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of content.trim()) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) {
        return false;
      }
    }
  }

  return !inString && stack.length === 0;
}

function extractJsonObjectFromText(content: string): string | null {
  const start = content.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index++) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

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
