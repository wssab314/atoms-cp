import { describe, expect, it } from 'vitest';
import { createProjectInputSchema, projectDetailSchema, updateProjectInputSchema } from './project.js';

describe('project schemas', () => {
  it('normalizes create input with a web target default', () => {
    const input = createProjectInputSchema.parse({
      name: '健身预约应用',
      prompt: '为健身工作室生成一个可以预约课程和管理订单的 Web 应用。'
    });

    expect(input.target).toBe('web');
  });

  it('rejects empty project creation prompts', () => {
    expect(() =>
      createProjectInputSchema.parse({
        name: '空项目',
        prompt: ''
      })
    ).toThrow();
  });

  it('accepts project detail records used by the API', () => {
    const project = projectDetailSchema.parse({
      id: 'project-1',
      ownerId: 'user-1',
      name: '健身预约应用',
      prompt: '为健身工作室生成一个可以预约课程和管理订单的 Web 应用。',
      status: 'draft',
      target: 'web',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    });

    expect(project.status).toBe('draft');
  });

  it('allows partial project updates without mutable payloads', () => {
    const update = updateProjectInputSchema.parse({
      name: '新的项目名',
      status: 'spec_ready'
    });

    expect(update).toEqual({
      name: '新的项目名',
      status: 'spec_ready'
    });
  });
});
