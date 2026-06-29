import { describe, expect, it } from 'vitest';
import {
  agentMessageRecordSchema,
  codexTaskTypeSchema,
  codexTaskSpecSchema,
  codexTaskRecordSchema,
  dependencyPolicySchema,
  previewSnapshotRecordSchema,
  traceEventRecordSchema,
  workspaceRecordSchema
} from './runtimeArtifacts.js';

describe('runtime artifact schemas', () => {
  it('validates workspace records with lock state', () => {
    const workspace = workspaceRecordSchema.parse({
      id: 'workspace-1',
      projectId: 'project-1',
      projectVersionId: 'project-version-1',
      path: '/var/lib/result-first/workspaces/user/project/version/project',
      status: 'locked',
      lockedBy: 'codex-worker-1',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z'
    });

    expect(workspace.status).toBe('locked');
    expect(workspace.lockedBy).toBe('codex-worker-1');
  });

  it('validates repair task type and persistent agent messages', () => {
    expect(codexTaskTypeSchema.parse('repair')).toBe('repair');
    expect(agentMessageRecordSchema.parse({
      id: 'agent-message-1',
      projectId: 'project-1',
      userId: 'user-1',
      content: '请把标题改得更醒目。',
      status: 'deferred',
      relatedTaskId: 'codex-task-1',
      createdAt: '2026-06-29T00:00:00.000Z',
      updatedAt: '2026-06-29T00:00:00.000Z'
    })).toMatchObject({
      status: 'deferred'
    });
  });

  it('rejects unsafe workspace paths', () => {
    expect(() =>
      workspaceRecordSchema.parse({
        id: 'workspace-1',
        projectId: 'project-1',
        path: '../other-user/project',
        status: 'ready',
        createdAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T00:00:00.000Z'
      })
    ).toThrow();
  });

  it('validates CodexTask records without raw prompts', () => {
    const taskSpec = codexTaskSpecSchema.parse({
      goal: 'Create the first runnable web app.',
      appSpec: {
        appName: '销售数据看板',
        appGoal: '帮助团队查看销售趋势',
        targetUser: '运营团队',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示销售指标',
            sections: [
              {
                id: 'hero',
                kind: 'stats',
                title: '销售总览',
                content: '展示核心销售指标。'
              }
            ],
            actions: []
          }
        ],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        acceptanceCriteria: ['可以看到销售指标']
      },
      designProfile: {
        id: 'quiet-dashboard',
        name: 'Quiet Dashboard',
        description: '低噪音运营看板。',
        bestFor: '运营后台',
        designTokens: {
          colors: {
            background: '#F8F8F6',
            foreground: '#171A1F',
            primary: '#315CF6',
            secondary: '#EEF3FF',
            muted: '#667085',
            border: '#E7E8EC',
            accent: '#20B26B'
          },
          typography: {
            headingFont: 'Inter',
            bodyFont: 'Inter',
            scale: 'comfortable'
          },
          radius: 'lg',
          shadow: 'subtle',
          density: 'balanced'
        },
        layoutGuidelines: ['Use quiet hierarchy.'],
        componentGuidelines: ['Use light cards.'],
        previewDescription: '安静的看板界面。'
      },
      targetChange: {
        type: 'initial_generate',
        summary: 'Generate the initial app.'
      },
      allowedPaths: ['src/**', 'index.html', 'ai-manifest.json'],
      forbiddenPaths: ['.env', 'node_modules/**', 'dist/**', '.git/**', '../**', '/**'],
      dependencyPolicy: 'forbid_new_dependencies',
      validationCommands: ['pnpm typecheck', 'pnpm build'],
      expectedOutputs: ['Vite app files', 'ai-manifest.json']
    });
    const task = codexTaskRecordSchema.parse({
      id: 'codex-task-1',
      projectId: 'project-1',
      projectVersionId: 'project-version-1',
      workspaceId: 'workspace-1',
      taskType: 'initial_generate',
      status: 'preparing_workspace',
      objective: 'Create a quiet dashboard application from the confirmed App Spec.',
      inputSummary: 'App Spec: 4 pages, selected design profile: Quiet Workspace.',
      taskSpec,
      allowedPaths: ['src/**', 'package.json', 'index.html'],
      forbiddenPaths: ['.env', 'node_modules/**', '../**'],
      validationCommands: ['pnpm typecheck', 'pnpm build'],
      attemptCount: 1,
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z'
    });

    expect(task.allowedPaths).toContain('src/**');
    expect(task.taskSpec?.dependencyPolicy).toBe('forbid_new_dependencies');
    expect(task.status).toBe('preparing_workspace');
    expect(task.attemptCount).toBe(1);
    expect(JSON.stringify(task)).not.toContain('rawPrompt');
  });

  it('rejects raw prompts in structured CodexTask specs', () => {
    expect(dependencyPolicySchema.parse('forbid_new_dependencies')).toBe('forbid_new_dependencies');
    expect(() =>
      codexTaskSpecSchema.parse({
        goal: 'Create app',
        rawPrompt: 'do not forward this raw user prompt',
        appSpec: {
          appName: 'Demo',
          appGoal: 'Demo goal',
          targetUser: 'Demo users',
          pages: [],
          styleIntent: {
            tone: 'calm',
            layoutDensity: 'comfortable'
          },
          acceptanceCriteria: ['Demo works']
        },
        designProfile: {},
        targetChange: {
          type: 'initial_generate',
          summary: 'Generate'
        },
        allowedPaths: ['src/**'],
        forbiddenPaths: ['.env'],
        dependencyPolicy: 'forbid_new_dependencies',
        validationCommands: ['pnpm build'],
        expectedOutputs: ['app']
      })
    ).toThrow();
  });

  it('requires CodexTask validation commands', () => {
    expect(() =>
      codexTaskRecordSchema.parse({
        id: 'codex-task-1',
        projectId: 'project-1',
        taskType: 'initial_generate',
        status: 'queued',
        objective: 'Create app',
        inputSummary: 'Confirmed app spec.',
        allowedPaths: ['src/**'],
        forbiddenPaths: ['.env'],
        validationCommands: [],
        createdAt: '2026-06-28T00:00:00.000Z',
        updatedAt: '2026-06-28T00:00:00.000Z'
      })
    ).toThrow();
  });

  it('validates preview snapshots and trace events', () => {
    const snapshot = previewSnapshotRecordSchema.parse({
      id: 'preview-snapshot-1',
      projectId: 'project-1',
      projectVersionId: 'project-version-1',
      buildJobId: 'build-job-1',
      status: 'ready',
      path: '/var/lib/result-first/previews/project-1/version-1',
      url: 'http://localhost:4000/preview/project-1/version-1/',
      active: true,
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z'
    });
    const trace = traceEventRecordSchema.parse({
      id: 'trace-event-1',
      projectId: 'project-1',
      codexTaskId: 'codex-task-1',
      type: 'selector_patch_created',
      visibility: 'admin',
      message: 'Selector patch requested.',
      payload: {
        aiId: 'home.hero.title'
      },
      createdAt: '2026-06-28T00:00:00.000Z'
    });

    expect(snapshot.active).toBe(true);
    expect(trace.visibility).toBe('admin');
  });
});
