import { z } from 'zod';
import {
  callJsonFunctionAgent,
  parseJsonFunctionAgentResponse,
} from '@/lib/agent/modelClient';
import { fetchWithTimeout } from '@/lib/withTimeout';

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

  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('parses repairable truncated function arguments before surfacing an error', () => {
    const parsed = parseJsonFunctionAgentResponse(
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
        agentName: 'TestAgent',
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

    const result = await callJsonFunctionAgent({
      agentName: 'TestAgent',
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
    expect(firstBody.max_tokens).toBe(10);
    expect(retryBody.max_tokens).toBe(20);
  });
});

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
