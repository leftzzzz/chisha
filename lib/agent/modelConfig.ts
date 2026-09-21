export type StructuredModelRole = 'supervisor' | 'planner' | 'evaluation' | 'keyword';

export interface StructuredModelConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

type ModelEnvironment = Record<string, string | undefined>;

export const DEFAULT_BAILIAN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const ROLE_CONFIG: Record<StructuredModelRole, {
  defaultModel: string;
  environmentVariable: string;
}> = {
  supervisor: {
    defaultModel: 'qwen3.7-flash',
    environmentVariable: 'OPENAI_MODEL_SUPERVISOR',
  },
  planner: {
    defaultModel: 'qwen3.7-flash',
    environmentVariable: 'OPENAI_MODEL_PLANNER',
  },
  evaluation: {
    defaultModel: 'qwen-flash',
    environmentVariable: 'OPENAI_MODEL_EVALUATION',
  },
  keyword: {
    defaultModel: 'qwen-flash',
    environmentVariable: 'OPENAI_MODEL_KEYWORD',
  },
};

/** Resolve the provider endpoint and model for one structured model role. */
export function resolveStructuredModelConfig(
  role: StructuredModelRole,
  environment: ModelEnvironment = process.env
): StructuredModelConfig {
  const roleConfig = ROLE_CONFIG[role];

  return {
    apiKey: nonBlank(environment.OPENAI_API_KEY),
    baseUrl: normalizeBaseUrl(
      nonBlank(environment.OPENAI_BASE_URL) ?? DEFAULT_BAILIAN_BASE_URL
    ),
    model: nonBlank(environment[roleConfig.environmentVariable])
      ?? nonBlank(environment.OPENAI_MODEL)
      ?? roleConfig.defaultModel,
  };
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
