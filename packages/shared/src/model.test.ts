import { describe, expect, it } from 'vitest';
import { modelRuntimeConfigSchema } from './model.js';

describe('modelRuntimeConfigSchema', () => {
  it('accepts a Volcengine model runtime configuration', () => {
    const result = modelRuntimeConfigSchema.parse({
      provider: 'volcengine',
      apiKeyConfigured: true,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-1-turbo-260628'
    });

    expect(result.provider).toBe('volcengine');
  });

  it('rejects unsupported model providers', () => {
    expect(() =>
      modelRuntimeConfigSchema.parse({
        provider: 'unknown',
        apiKeyConfigured: true,
        model: 'deepseek-v4-pro'
      })
    ).toThrow();
  });
});
