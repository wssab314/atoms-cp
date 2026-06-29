import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const algorithm = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

export function decryptToken(payload: string, secret: string): string {
  const [version, ivText, tagText, encryptedText] = payload.split('.');

  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new Error('Invalid encrypted token payload');
  }

  const decipher = createDecipheriv(algorithm, deriveKey(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}
