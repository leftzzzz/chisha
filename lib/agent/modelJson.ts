export function parseModelJsonArguments(args: string, agentName: string): unknown {
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

  throw new Error(`${agentName} returned malformed function arguments JSON`);
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
