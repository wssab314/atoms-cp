import { describe, expect, it } from 'vitest';
import { userProfileSchema, userRoleSchema } from './user.js';

describe('user schemas', () => {
  it('accepts creator and admin roles', () => {
    expect(userRoleSchema.parse('creator')).toBe('creator');
    expect(userRoleSchema.parse('admin')).toBe('admin');
  });

  it('validates the local auth profile shape', () => {
    const user = userProfileSchema.parse({
      id: 'user-1',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    });

    expect(user.email).toBe('creator@example.local');
  });
});
