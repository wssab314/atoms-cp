import type { ModelRuntimeConfig } from '@atoms-cp/shared';

export interface GenerateTextRequest {
  system: string;
  user: string;
  responseFormat?: 'text' | 'json';
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  maxOutputTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ModelClient {
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
}

const defaultModelRequestTimeoutMs = 60_000;

function jsonSchemaResponseFormat(jsonSchema?: GenerateTextRequest['jsonSchema']) {
  const schema = jsonSchema?.schema ?? {
    type: 'object',
    additionalProperties: true
  };

  return {
    type: 'json_schema',
    json_schema: {
      name: jsonSchema?.name ?? 'structured_response',
      ...(jsonSchema ? { strict: true } : {}),
      schema
    }
  };
}

async function fetchJsonWithTimeout<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  init: RequestInit;
  timeoutMs: number;
  providerName: string;
}): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${input.providerName} request timed out after ${input.timeoutMs}ms`));
    }, input.timeoutMs);
  });

  try {
    return await Promise.race([
      (async () => {
        const response = await input.fetchImpl(input.url, {
          ...input.init,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`${input.providerName} request failed with status ${response.status}`);
        }

        return await response.json() as T;
      })(),
      timeout
    ]);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${input.providerName} request timed out after ${input.timeoutMs}ms`);
    }

    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export class DeepSeekModelClient implements ModelClient {
  constructor(
    private readonly config: ModelRuntimeConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = defaultModelRequestTimeoutMs
  ) {}

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    if (!this.config.baseUrl) {
      throw new Error('DeepSeek base URL is not configured');
    }

    const payload = await fetchJsonWithTimeout<{
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>({
      fetchImpl: this.fetchImpl,
      url: `${this.config.baseUrl}/chat/completions`,
      timeoutMs: this.timeoutMs,
      providerName: 'DeepSeek',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxOutputTokens,
          stream: false,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user }
          ],
          response_format: request.responseFormat === 'json'
            ? { type: 'json_object' }
            : undefined
        })
      }
    });

    return {
      text: payload.choices?.[0]?.message?.content ?? '',
      model: payload.model ?? this.config.model,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0
      }
    };
  }
}

export class VolcengineModelClient implements ModelClient {
  constructor(
    private readonly config: ModelRuntimeConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = defaultModelRequestTimeoutMs
  ) {}

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    if (!this.config.baseUrl) {
      throw new Error('Volcengine base URL is not configured');
    }

    const payload = await fetchJsonWithTimeout<{
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>({
      fetchImpl: this.fetchImpl,
      url: `${this.config.baseUrl}/chat/completions`,
      timeoutMs: this.timeoutMs,
      providerName: 'Volcengine',
      init: {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: request.maxOutputTokens,
          stream: false,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user }
          ],
          response_format: request.responseFormat === 'json'
            ? jsonSchemaResponseFormat(request.jsonSchema)
            : undefined
        })
      }
    });

    return {
      text: payload.choices?.[0]?.message?.content ?? '',
      model: payload.model ?? this.config.model,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0
      }
    };
  }
}

export function createModelClient(config: ModelRuntimeConfig, apiKey?: string, timeoutMs = defaultModelRequestTimeoutMs): ModelClient {
  if (config.provider === 'deepseek') {
    if (!apiKey) {
      throw new Error('DeepSeek API key is required when MODEL_PROVIDER=deepseek');
    }

    return new DeepSeekModelClient(config, apiKey, fetch, timeoutMs);
  }

  if (config.provider === 'volcengine') {
    if (!apiKey) {
      throw new Error('Volcengine API key is required when MODEL_PROVIDER=volcengine');
    }

    return new VolcengineModelClient(config, apiKey, fetch, timeoutMs);
  }

  throw new Error('Unsupported model provider');
}
