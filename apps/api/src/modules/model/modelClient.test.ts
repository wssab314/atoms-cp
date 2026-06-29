import { describe, expect, it } from 'vitest';
import { createModelClient } from './modelClient.js';

describe('createModelClient', () => {
  it('requires an API key for DeepSeek provider', () => {
    expect(() =>
      createModelClient({
        provider: 'deepseek',
        apiKeyConfigured: false,
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro'
      })
    ).toThrow('DeepSeek API key is required');
  });

  it('calls Volcengine Ark chat completions with json_schema output without leaking the key into request body', async () => {
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({
        model: 'doubao-seed-2-1-turbo-260628',
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as typeof fetch;
    const { VolcengineModelClient } = await import('./modelClient.js');
    const client = new VolcengineModelClient({
      provider: 'volcengine',
      apiKeyConfigured: true,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-1-turbo-260628'
    }, 'ark-test-secret', fetchImpl);

    const result = await client.generateText({
      system: 'Return JSON only.',
      user: '{"hello":"world"}',
      responseFormat: 'json',
      jsonSchema: {
        name: 'app_spec',
        schema: {
          type: 'object',
          required: ['appName', 'pages'],
          properties: {
            appName: { type: 'string' },
            pages: { type: 'array' }
          }
        }
      },
      maxOutputTokens: 256
    });

    expect(result.text).toBe('{"ok":true}');
    expect(fetchCalls[0]?.url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    expect(fetchCalls[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer ark-test-secret'
    });
    expect(String(fetchCalls[0]?.init.body)).not.toContain('ark-test-secret');
    expect(JSON.parse(String(fetchCalls[0]?.init.body))).toMatchObject({
      model: 'doubao-seed-2-1-turbo-260628',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'app_spec',
          strict: true,
          schema: {
            type: 'object',
            required: ['appName', 'pages'],
            properties: {
              appName: { type: 'string' },
              pages: { type: 'array' }
            }
          }
        }
      }
    });
  });

  it('times out stalled Volcengine requests instead of leaving generation hanging', async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;
    const { VolcengineModelClient } = await import('./modelClient.js');
    const client = new VolcengineModelClient({
      provider: 'volcengine',
      apiKeyConfigured: true,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-1-turbo-260628'
    }, 'ark-test-secret', fetchImpl, 1);

    await expect(client.generateText({
      system: 'Return JSON only.',
      user: '{"hello":"world"}',
      responseFormat: 'json',
      maxOutputTokens: 256
    })).rejects.toThrow(/timed out/);
  });

  it('times out stalled Volcengine response body reads as one full model call', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>(() => {})
    })) as unknown as typeof fetch;
    const { VolcengineModelClient } = await import('./modelClient.js');
    const client = new VolcengineModelClient({
      provider: 'volcengine',
      apiKeyConfigured: true,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-1-turbo-260628'
    }, 'ark-test-secret', fetchImpl, 1);

    await expect(client.generateText({
      system: 'Return JSON only.',
      user: '{"hello":"world"}',
      responseFormat: 'json',
      maxOutputTokens: 256
    })).rejects.toThrow(/timed out/);
  });

  it('requires an API key for Volcengine provider', () => {
    expect(() =>
      createModelClient({
        provider: 'volcengine',
        apiKeyConfigured: false,
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        model: 'doubao-seed-2-1-turbo-260628'
      })
    ).toThrow('Volcengine API key is required');
  });
});
