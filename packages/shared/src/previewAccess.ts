import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PreviewAccessTokenInput {
  buildJobId: string;
  secret: string;
}

export interface PreviewAccessVerificationInput extends PreviewAccessTokenInput {
  token: string;
}

const TOKEN_VERSION = 'v1';

export function createPreviewAccessToken(input: PreviewAccessTokenInput): string {
  return [
    TOKEN_VERSION,
    createPreviewSignature(input)
  ].join('.');
}

export function verifyPreviewAccessToken(input: PreviewAccessVerificationInput): boolean {
  const expected = createPreviewAccessToken(input);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(input.token, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function createPreviewSignature(input: PreviewAccessTokenInput): string {
  return createHmac('sha256', input.secret)
    .update(`${TOKEN_VERSION}:preview:${input.buildJobId}`)
    .digest('base64url');
}
