import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from './server.js';

const originalEnv = { ...process.env };

describe('createServer production CORS', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows configured web origins in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_WEB_ORIGIN = 'https://atoms.example.com';
    process.env.PUBLIC_API_ORIGIN = 'https://atoms-api.example.com';
    process.env.ALLOWED_CORS_ORIGINS = 'https://atoms.example.com';
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'prod-github-token-key-32-characters';
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = 'prod-connector-token-key-32-chars';
    process.env.PREVIEW_ACCESS_SECRET = 'prod-preview-access-secret-32-chars';
    const app = await createServer({ logger: false });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://atoms.example.com'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('https://atoms.example.com');
    } finally {
      await app.close();
    }
  });

  it('does not emit CORS allow headers for unknown production origins', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_WEB_ORIGIN = 'https://atoms.example.com';
    process.env.PUBLIC_API_ORIGIN = 'https://atoms-api.example.com';
    process.env.ALLOWED_CORS_ORIGINS = 'https://atoms.example.com';
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = 'prod-github-token-key-32-characters';
    process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY = 'prod-connector-token-key-32-chars';
    process.env.PREVIEW_ACCESS_SECRET = 'prod-preview-access-secret-32-chars';
    const app = await createServer({ logger: false });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: {
          origin: 'https://evil.example.com'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
