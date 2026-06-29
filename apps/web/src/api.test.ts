import { describe, expect, it } from 'vitest';
import { buildApiUrl, resolveApiBaseUrl } from './api';

describe('api URL resolution', () => {
  it('uses same-origin relative API paths when no explicit API origin is configured', () => {
    expect(resolveApiBaseUrl(undefined)).toBe('');
    expect(buildApiUrl('/api/auth/me', undefined)).toBe('/api/auth/me');
  });

  it('uses the configured API origin without duplicating trailing slashes', () => {
    expect(resolveApiBaseUrl('https://atoms-api.example.com/')).toBe('https://atoms-api.example.com');
    expect(buildApiUrl('/api/auth/me', 'https://atoms-api.example.com/')).toBe('https://atoms-api.example.com/api/auth/me');
  });
});
