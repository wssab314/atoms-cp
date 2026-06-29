import { describe, expect, it } from 'vitest';
import { agentPurposeSchema, agentRunSchema, modelInvocationSchema } from './agent.js';

describe('agent observability schemas', () => {
  it('includes selector patch runs in agent purpose observability', () => {
    expect(agentPurposeSchema.parse('selector_patch')).toBe('selector_patch');
  });

  it('accepts an AppSpec generation run record', () => {
    const run = agentRunSchema.parse({
      id: 'agent-run-1',
      projectId: 'project-1',
      purpose: 'app_spec_generation',
      provider: 'volcengine',
      status: 'succeeded',
      inputSnapshot: {
        promptLength: 42
      },
      outputSnapshot: {
        appSpecId: 'spec-1'
      },
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    });

    expect(run.status).toBe('succeeded');
  });

  it('accepts a model invocation budget envelope', () => {
    const invocation = modelInvocationSchema.parse({
      id: 'model-invocation-1',
      projectId: 'project-1',
      agentRunId: 'agent-run-1',
      provider: 'volcengine',
      model: 'doubao-seed-2-1-turbo-260628',
      purpose: 'app_spec_generation',
      status: 'succeeded',
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 20,
      estimatedCostCny: 0,
      budgetLimitCny: 25,
      createdAt: '2026-06-27T00:00:00.000Z'
    });

    expect(invocation.budgetLimitCny).toBe(25);
  });
});
