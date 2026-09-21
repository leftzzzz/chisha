import {
  DEFAULT_BAILIAN_BASE_URL,
  resolveStructuredModelConfig,
} from '@/lib/agent/modelConfig';

describe('structured model config', () => {
  it('uses the accepted Bailian role defaults', () => {
    expect(resolveStructuredModelConfig('supervisor', {})).toEqual({
      apiKey: undefined,
      baseUrl: DEFAULT_BAILIAN_BASE_URL,
      model: 'qwen3.7-flash',
    });
    expect(resolveStructuredModelConfig('planner', {}).model).toBe('qwen3.7-flash');
    expect(resolveStructuredModelConfig('keyword', {}).model).toBe('qwen-flash');
    expect(resolveStructuredModelConfig('evaluation', {}).model).toBe('qwen-flash');
  });

  it('lets the global model override every role default', () => {
    expect(resolveStructuredModelConfig('evaluation', {
      OPENAI_MODEL: 'qwen3.5-flash',
    }).model).toBe('qwen3.5-flash');
  });

  it('gives a role override precedence over the global model', () => {
    expect(resolveStructuredModelConfig('evaluation', {
      OPENAI_MODEL: 'qwen3.7-flash',
      OPENAI_MODEL_EVALUATION: 'qwen-flash',
    }).model).toBe('qwen-flash');
  });

  it('treats blank values as missing and trims configured values', () => {
    expect(resolveStructuredModelConfig('keyword', {
      OPENAI_API_KEY: '  test-key  ',
      OPENAI_BASE_URL: ' https://workspace.example/v1/// ',
      OPENAI_MODEL: ' qwen3.5-flash ',
      OPENAI_MODEL_KEYWORD: '   ',
    })).toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://workspace.example/v1',
      model: 'qwen3.5-flash',
    });
  });
});
