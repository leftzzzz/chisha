import { z } from 'zod';
import {
  callStructuredModel,
  parseStructuredModelResponse,
} from '@/lib/agent/modelClient';
import { fetchWithTimeout } from '@/lib/withTimeout';
import { AgentError } from '@/lib/agent/types';
import { summarizeTurnMetrics, type MetricsSink } from '@/lib/agent/metrics';

jest.mock('@/lib/withTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const fetchWithTimeoutMock = fetchWithTimeout as jest.Mock;
const TestSchema = z.object({
  value: z.string(),
  items: z.array(z.string()).default([]),
});

describe('modelClient', () => {
  let warnSpy: jest.SpyInstance;
  const originalQwenEnableThinking = process.env.QWEN_ENABLE_THINKING;

  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
    delete process.env.QWEN_ENABLE_THINKING;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (originalQwenEnableThinking === undefined) {
      delete process.env.QWEN_ENABLE_THINKING;
    } else {
      process.env.QWEN_ENABLE_THINKING = originalQwenEnableThinking;
    }
    warnSpy.mockRestore();
  });

  it('parses repairable truncated function arguments before surfacing an error', () => {
    const parsed = parseStructuredModelResponse(
      {
        choices: [{
          finish_reason: 'length',
          message: {
            function_call: {
              name: 'testFunction',
              arguments: '{"value":"ok"',
            },
          },
        }],
      },
      {
        modelRole: 'TestAgent',
        functionName: 'testFunction',
        schema: TestSchema,
      }
    );

    expect(parsed.ok).toBe(true);
    expect(parsed.truncated).toBe(true);
    expect(parsed.data).toEqual({ value: 'ok', items: [] });
  });

  it('retries truncated responses and accepts a repaired retry response', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(modelResponse('{"value":"first"', 'length'))
      .mockResolvedValueOnce(modelResponse('{"value":"retry"', 'length'));

    const result = await callStructuredModel({
      modelRole: 'TestAgent',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      systemPrompt: 'Return JSON.',
      input: { query: 'test' },
      functionDefinition: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
      functionName: 'testFunction',
      schema: TestSchema,
      temperature: 0,
      maxTokens: 10,
      retryMaxTokens: 20,
      timeoutMs: 1000,
    });

    expect(result).toEqual({ value: 'retry', items: [] });
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(fetchWithTimeoutMock.mock.calls[0][1].body);
    const retryBody = JSON.parse(fetchWithTimeoutMock.mock.calls[1][1].body);
    expect(firstBody.max_completion_tokens).toBe(10);
    expect(retryBody.max_completion_tokens).toBe(20);
    expect(firstBody.tools).toEqual([{
      type: 'function',
      function: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
    }]);
    expect(firstBody.tool_choice).toEqual({
      type: 'function',
      function: { name: 'testFunction' },
    });
    expect(firstBody.messages).toEqual([
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: JSON.stringify({ trustedContext: { query: 'test' } }) },
    ]);
  });

  it('retries invalid schema responses with a repair instruction', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(modelResponse('{}'))
      .mockResolvedValueOnce(modelResponse('{"value":"ok"}'));

    const result = await callStructuredModel({
      modelRole: 'TestAgent',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      systemPrompt: 'Return JSON.',
      input: { query: 'test' },
      functionDefinition: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
      functionName: 'testFunction',
      schema: TestSchema,
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 1000,
    });

    expect(result).toEqual({ value: 'ok', items: [] });
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(2);

    const retryBody = JSON.parse(fetchWithTimeoutMock.mock.calls[1][1].body);
    expect(retryBody.messages[0].content).toContain('schema 校验');
    expect(JSON.parse(retryBody.messages[1].content).policy.schemaRepair.previousError)
      .toContain('TestAgent returned invalid schema');
  });

  it('omits temperature for GPT-5 reasoning models', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(modelResponse('{"value":"ok"}'));

    await callStructuredModel({
      modelRole: 'TestAgent',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'gpt-5.2',
      systemPrompt: 'Return JSON.',
      input: { query: 'test' },
      functionDefinition: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
      functionName: 'testFunction',
      schema: TestSchema,
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 1000,
    });

    const requestBody = JSON.parse(fetchWithTimeoutMock.mock.calls[0][1].body);
    expect(requestBody.temperature).toBeUndefined();
  });

  it('disables Qwen thinking mode when forcing a tool call', async () => {
    fetchWithTimeoutMock.mockResolvedValueOnce(modelResponse('{"value":"ok"}'));

    await callStructuredModel({
      modelRole: 'TestAgent',
      apiKey: 'test-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.6-flash-2026-04-16',
      systemPrompt: 'Return JSON.',
      input: { query: 'test' },
      functionDefinition: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
      functionName: 'testFunction',
      schema: TestSchema,
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 1000,
    });

    const requestBody = JSON.parse(fetchWithTimeoutMock.mock.calls[0][1].body);
    expect(requestBody.enable_thinking).toBe(false);
  });

  it('includes API error details when a chat completion request fails', async () => {
    fetchWithTimeoutMock
      .mockResolvedValueOnce(errorResponse({
        error: {
          message: "Unsupported parameter: 'temperature'",
          type: 'invalid_request_error',
          code: 'unsupported_parameter',
        },
      }))
      .mockResolvedValueOnce(errorResponse({
        error: {
          message: "Legacy function_call is also unsupported",
          type: 'invalid_request_error',
          code: 'unsupported_parameter',
        },
      }));

    await expect(callStructuredModel({
      modelRole: 'TestAgent',
      apiKey: 'test-key',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      systemPrompt: 'Return JSON.',
      input: { query: 'test' },
      functionDefinition: {
        name: 'testFunction',
        parameters: { type: 'object' },
      },
      functionName: 'testFunction',
      schema: TestSchema,
      temperature: 0,
      maxTokens: 10,
      timeoutMs: 1000,
    })).rejects.toThrow(
      "TestAgent API failed: 400 - Legacy function_call is also unsupported; type=invalid_request_error; code=unsupported_parameter"
    );
  });

  it('counts failed transport attempts without inventing usage', async () => {
    const metricsSink: MetricsSink = {};
    fetchWithTimeoutMock.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(callStructuredModel({ ...agentOptions(), metricsSink })).rejects.toThrow();
    expect(metricsSink.modelCallMetrics?.[0]).toMatchObject({
      attempts: 1, ok: false, usageComplete: false,
    });
    expect(summarizeTurnMetrics(metricsSink)).toMatchObject({
      modelCalls: 1, failedModelCalls: 1, totalTokens: null, missingUsageCalls: 1,
    });
  });

  it('keeps incomplete retry usage unknown and preserves the known subtotal', async () => {
    const metricsSink: MetricsSink = {};
    const response = modelResponse('{"value":"ok"}');
    fetchWithTimeoutMock.mockResolvedValueOnce(modelResponse('{}')).mockResolvedValueOnce({
      ...response,
      json: async () => ({ ...await response.json(), usage: { prompt_tokens: 5, completion_tokens: 2 } }),
    });
    await callStructuredModel({ ...agentOptions(), metricsSink });
    expect(summarizeTurnMetrics(metricsSink)).toMatchObject({
      retries: 1, totalTokens: null, knownPromptTokens: 5, knownCompletionTokens: 2,
    });
  });

  /**
   * 错误码在抛出点决定，不再靠下游对 message 做正则猜测。
   */
  describe('结构化错误码', () => {
    it('marks a 429 as a retryable rate limit', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        errorResponse({ error: { message: 'Rate limit reached' } }, 429)
      );

      const error = await callStructuredModel(agentOptions()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AgentError);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
    });

    it('marks a 500 as retryable but not a rate limit', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        errorResponse({ error: { message: 'upstream exploded' } }, 500)
      );

      const error = await callStructuredModel(agentOptions()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AgentError);
      expect(error.code).toBe('MODEL_UNAVAILABLE');
      expect(error.retryable).toBe(true);
    });

    // 配额耗尽重试 100% 失败，必须与限流分开：前端据此不给重试入口。
    it('marks a 403 quota error as non-retryable', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        errorResponse({ error: { message: 'Free quota exhausted' } }, 403)
      );

      const error = await callStructuredModel(agentOptions()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AgentError);
      expect(error.code).toBe('MODEL_QUOTA_EXHAUSTED');
      expect(error.retryable).toBe(false);
    });

    it('marks a 401 as a configuration problem', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        errorResponse({ error: { message: 'invalid api key' } }, 401)
      );

      const error = await callStructuredModel(agentOptions()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AgentError);
      expect(error.code).toBe('CONFIG_MISSING');
      expect(error.retryable).toBe(false);
    });

    it('marks a 400 as not retryable', async () => {
      fetchWithTimeoutMock.mockResolvedValue(
        errorResponse({ error: { message: 'bad request' } }, 400)
      );

      const error = await callStructuredModel(agentOptions()).catch((caught) => caught);

      expect(error).toBeInstanceOf(AgentError);
      expect(error.retryable).toBe(false);
    });
  });
});

function agentOptions() {
  return {
    modelRole: 'TestAgent',
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    systemPrompt: 'Return JSON.',
    input: { query: 'test' },
    functionDefinition: { name: 'testFunction', parameters: { type: 'object' } },
    functionName: 'testFunction',
    schema: TestSchema,
    temperature: 0,
    maxTokens: 10,
    timeoutMs: 1000,
  };
}

function modelResponse(argumentsJson: string, finishReason?: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{
        finish_reason: finishReason,
        message: {
          function_call: {
            name: 'testFunction',
            arguments: argumentsJson,
          },
        },
      }],
    }),
  };
}

function errorResponse(body: unknown, status = 400) {
  return {
    ok: false,
    status,
    headers: {
      get: () => null,
    },
    text: async () => JSON.stringify(body),
  };
}
