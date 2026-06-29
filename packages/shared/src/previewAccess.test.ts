import { describe, expect, it } from 'vitest';
import { createPreviewAccessToken, verifyPreviewAccessToken } from './previewAccess.js';

describe('preview access tokens', () => {
  it('creates stable build-scoped tokens and verifies them with the same secret', () => {
    const token = createPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'preview-access-secret'
    });

    expect(token).toBe(createPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'preview-access-secret'
    }));
    expect(verifyPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'preview-access-secret',
      token
    })).toBe(true);
  });

  it('rejects tokens for other builds or secrets', () => {
    const token = createPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'preview-access-secret'
    });

    expect(verifyPreviewAccessToken({
      buildJobId: 'build-2',
      secret: 'preview-access-secret',
      token
    })).toBe(false);
    expect(verifyPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'other-preview-secret',
      token
    })).toBe(false);
    expect(verifyPreviewAccessToken({
      buildJobId: 'build-1',
      secret: 'preview-access-secret',
      token: 'bad-token'
    })).toBe(false);
  });
});
