export interface D1RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 50;
const DEFAULT_MAX_DELAY_MS = 1_000;

const RETRYABLE_ERROR_MARKERS = [
  'storage caused object to be reset',
  'reset because its code was updated',
  'network connection lost',
  'replica disconnected from primary',
  'cannot resolve d1 db due to transient issue on remote node',
];

export function isRetryableD1Error(error: unknown): boolean {
  const message = collectErrorText(error).toLowerCase();
  return RETRYABLE_ERROR_MARKERS.some((marker) => message.includes(marker));
}

export async function withD1Retry<T>(
  operation: () => Promise<T>,
  options: D1RetryOptions = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableD1Error(error)) {
        throw error;
      }

      const backoffMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = 0.5 + Math.min(1, Math.max(0, random())) * 0.5;
      await sleep(Math.round(backoffMs * jitter));
    }
  }

  throw new Error('D1 operation exhausted retry attempts');
}

function collectErrorText(error: unknown, depth = 0): string {
  if (depth > 3 || error == null) {
    return '';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error !== 'object') {
    return String(error);
  }

  const candidate = error as { message?: unknown; cause?: unknown };
  return [candidate.message, candidate.cause]
    .map((value) => collectErrorText(value, depth + 1))
    .filter(Boolean)
    .join(' ');
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
