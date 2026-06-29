import { createHmac } from 'node:crypto';

const TOKEN_VERSION = 'v1';

export function createPreviewAccessToken(input: { buildJobId: string; secret: string }): string {
  return [
    TOKEN_VERSION,
    createHmac('sha256', input.secret)
      .update(`${TOKEN_VERSION}:preview:${input.buildJobId}`)
      .digest('base64url')
  ].join('.');
}
