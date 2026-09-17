import { AgentError } from '@/lib/agent/types';

export type EvalMode = 'offline' | 'live';

export function resolveEvalMode(
  env: NodeJS.ProcessEnv = process.env
): EvalMode {
  const mode = env.EVAL_MODE ?? 'offline';

  if (mode === 'offline' || mode === 'live') {
    return mode;
  }

  throw new AgentError(
    `unsupported eval mode: ${mode}`,
    'CONFIG_MISSING',
    false
  );
}
