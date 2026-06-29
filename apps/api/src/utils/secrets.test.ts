import { describe, expect, it } from 'vitest';
import { maskSecrets } from './secrets.js';

describe('maskSecrets', () => {
  it('masks known secret values', () => {
    const masked = maskSecrets('token=local-secret-value', ['local-secret-value']);

    expect(masked).toBe('token=[masked-secret]');
  });

  it('masks common API key patterns', () => {
    const syntheticKey = ['sk', 'testvalue1234567890'].join('-');
    const masked = maskSecrets(`MODEL_API_KEY=${syntheticKey}`);

    expect(masked).toBe('MODEL_API_KEY=[masked-secret]');
  });
});
