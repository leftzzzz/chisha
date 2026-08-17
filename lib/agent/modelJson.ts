export interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionFunctionResponse {
  usage?: ChatCompletionUsage;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      function_call?: { name?: string; arguments?: string };
      tool_calls?: Array<{
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

export function parseModelJsonArguments(args: string, modelRole: string): unknown {
  const candidates = Array.from(new Set([
    args.trim(),
    extractJsonObject(args.trim()),
    repairJson(args.trim()),
    repairJson(extractJsonObject(args.trim())),
  ].filter((candidate): candidate is string => Boolean(candidate))));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next structural repair candidate.
    }
  }

  throw new Error(`${modelRole} returned malformed function arguments JSON`);
}

export function extractModelFunctionArguments(
  data: ChatCompletionFunctionResponse,
  functionName?: string
): string | null {
  const message = data.choices?.[0]?.message;
  const functionCall = message?.function_call;
  if (hasArguments(functionCall) && matchesFunctionName(functionCall.name, functionName)) {
    return functionCall.arguments;
  }

  const toolCalls = message?.tool_calls ?? [];
  const matchingToolCall = toolCalls.find((item) =>
    item.type === 'function'
    && hasArguments(item.function)
    && matchesFunctionName(item.function.name, functionName)
  );
  if (matchingToolCall?.function?.arguments) {
    return matchingToolCall.function.arguments;
  }

  const fallbackToolCall = toolCalls.find((item) =>
    item.type === 'function' && hasArguments(item.function)
  );
  if (fallbackToolCall?.function?.arguments) {
    return fallbackToolCall.function.arguments;
  }

  return extractJsonObject(message?.content ?? '');
}

export function getModelFinishReason(data: ChatCompletionFunctionResponse): string | undefined {
  return data.choices?.[0]?.finish_reason;
}

export function isModelFunctionOutputTruncated(
  data: ChatCompletionFunctionResponse,
  args = extractModelFunctionArguments(data)
): boolean {
  return getModelFinishReason(data) === 'length'
    || Boolean(args && !hasCompleteJsonStructure(args));
}

export function hasCompleteJsonStructure(content: string): boolean {
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

function hasArguments<T extends { arguments?: string } | undefined>(
  functionCall: T
): functionCall is T & { arguments: string } {
  return typeof functionCall?.arguments === 'string' && functionCall.arguments.length > 0;
}

function matchesFunctionName(actual: string | undefined, expected: string | undefined): boolean {
  return !expected || actual === expected;
}

function repairJson(input: string | null): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  return closeOpenJson(trimmed.replace(/,\s*([}\]])/g, '$1'));
}

function closeOpenJson(input: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of input) {
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
    } else if ((char === '}' || char === ']') && stack.at(-1) === char) {
      stack.pop();
    }
  }

  return `${input}${stack.reverse().join('')}`;
}

function extractJsonObject(content: string): string | null {
  const objectStart = content.indexOf('{');
  const arrayStart = content.indexOf('[');
  const start = objectStart === -1
    ? arrayStart
    : arrayStart === -1
      ? objectStart
      : Math.min(objectStart, arrayStart);
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

    if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      depth--;
      if (depth === 0) {
        return content.slice(start, index + 1);
      }
    }
  }

  return content.slice(start);
}
