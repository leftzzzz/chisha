import { AgentError } from '@/lib/agent/types';

export const EVAL_MODES = [
  'offline',
  'live-model-fixture-map',
  'live-model-live-map',
] as const;

export type EvalMode = (typeof EVAL_MODES)[number];

export interface EvalExecutionConfig {
  mode: EvalMode;
  model: 'stub' | 'live';
  map: 'fixture' | 'live';
  baseline: 'enabled' | 'disabled';
}

const EVAL_MODE_SET = new Set<string>(EVAL_MODES);

export function resolveEvalMode(
  env: NodeJS.ProcessEnv = process.env
): EvalMode {
  const mode = env.EVAL_MODE ?? 'offline';

  if (EVAL_MODE_SET.has(mode)) {
    return mode as EvalMode;
  }

  throw new AgentError(
    `unsupported eval mode: ${mode}`,
    'CONFIG_MISSING',
    false
  );
}

export function resolveEvalExecution(mode: EvalMode): EvalExecutionConfig {
  switch (mode) {
    case 'offline':
      return {
        mode,
        model: 'stub',
        map: 'fixture',
        baseline: 'enabled',
      };
    case 'live-model-fixture-map':
      return {
        mode,
        model: 'live',
        map: 'fixture',
        baseline: 'disabled',
      };
    case 'live-model-live-map':
      return {
        mode,
        model: 'live',
        map: 'live',
        baseline: 'disabled',
      };
  }
}

export function validateEvalConfiguration(
  mode: EvalMode,
  env: NodeJS.ProcessEnv = process.env
): EvalExecutionConfig {
  const config = resolveEvalExecution(mode);
  const missing: string[] = [];

  if (config.model === 'live' && !hasValue(env.OPENAI_API_KEY)) {
    missing.push('OPENAI_API_KEY');
  }
  if (config.map === 'live' && !hasValue(env.AMAP_API_KEY)) {
    missing.push('AMAP_API_KEY');
  }
  if (config.map === 'live' && env.EVAL_ALLOW_LIVE_PROVIDER !== '1') {
    missing.push('EVAL_ALLOW_LIVE_PROVIDER=1');
  }
  if (config.baseline === 'disabled' && env.EVAL_UPDATE_BASELINE === '1') {
    missing.push('EVAL_UPDATE_BASELINE must be unset outside offline mode');
  }

  if (missing.length > 0) {
    throw new AgentError(
      `${mode} eval configuration is incomplete: ${missing.join(', ')}`,
      'CONFIG_MISSING',
      false
    );
  }

  return config;
}

export function prepareEvalProcess(
  config: EvalExecutionConfig,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (config.model === 'stub') {
    env.AGENT_DETERMINISTIC = '1';
    return;
  }

  delete env.AGENT_DETERMINISTIC;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}
