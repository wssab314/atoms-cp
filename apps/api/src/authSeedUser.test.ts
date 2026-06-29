import { describe, expect, it } from 'vitest';
import { parseSeedUserArgs } from './authSeedUser.js';

describe('parseSeedUserArgs', () => {
  it('normalizes email and defaults to creator role', () => {
    expect(parseSeedUserArgs(['--email', ' Test@AtsLab.Top '])).toMatchObject({
      email: 'test@atslab.top',
      role: 'creator'
    });
  });

  it('supports a password file without exposing the password in env', () => {
    expect(parseSeedUserArgs([
      '--email',
      'test@atslab.top',
      '--role',
      'admin',
      '--password-file',
      '/run/atoms-cp-secrets/test_account_password'
    ])).toEqual({
      email: 'test@atslab.top',
      role: 'admin',
      passwordFile: '/run/atoms-cp-secrets/test_account_password',
      name: undefined,
      password: undefined
    });
  });

  it('rejects ambiguous password inputs', () => {
    expect(() => parseSeedUserArgs([
      '--email',
      'test@atslab.top',
      '--password',
      'secret-password',
      '--password-file',
      '/tmp/password'
    ])).toThrow(/either --password or --password-file/);
  });
});
