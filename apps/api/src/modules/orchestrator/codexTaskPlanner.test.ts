import { describe, expect, it } from 'vitest';
import type { AppSpec, DesignProfile, ProjectDetail } from '@atoms-cp/shared';
import { createInitialCodexTaskPlan } from './codexTaskPlanner.js';

const appSpec: AppSpec = {
  appName: '客户成功工作台',
  appGoal: '帮助客户成功团队跟进重点账户',
  targetUser: '客户成功经理',
  pages: [
    {
      id: 'dashboard',
      name: '工作台',
      route: '/',
      purpose: '查看客户健康度',
      sections: [
        {
          id: 'hero',
          kind: 'stats',
          title: '关键指标',
          content: '展示续费风险、活跃度和待办事项。'
        }
      ],
      actions: []
    }
  ],
  dataModels: [
    {
      name: 'Account',
      fields: [
        {
          name: 'name',
          type: 'string',
          required: true
        }
      ]
    }
  ],
  integrations: ['Supabase'],
  styleIntent: {
    tone: 'calm',
    layoutDensity: 'comfortable'
  },
  constraints: ['桌面优先'],
  nonGoals: [],
  acceptanceCriteria: ['可以看到账户健康度']
};

const designProfile: DesignProfile = {
  id: 'quiet-builder',
  name: 'Quiet Builder',
  description: '安静、清晰、低干扰的工作台视觉。',
  bestFor: '生产力工具',
  designTokens: {
    colors: {
      background: '#F8F8F6',
      foreground: '#17181C',
      primary: '#315CF6',
      secondary: '#EEF2FF',
      muted: '#6B7280',
      border: '#E7E8EC',
      accent: '#16A34A'
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
  layoutGuidelines: ['使用清晰的导航和内容层级。'],
  componentGuidelines: ['卡片使用轻边框和轻阴影。'],
  previewDescription: '安静的应用构建器界面。'
};

const project: ProjectDetail = {
  id: 'project-1',
  ownerId: 'user-creator',
  name: '客户成功工作台',
  prompt: 'RAW_PROMPT_SHOULD_NOT_LEAK: 帮我做一个完整的客户成功系统。',
  status: 'design_ready',
  target: 'web',
  createdAt: '2026-06-28T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z'
};

describe('createInitialCodexTaskPlan', () => {
  it('creates a structured CodexTask without forwarding the raw project prompt', () => {
    const plan = createInitialCodexTaskPlan({
      project,
      appSpec,
      designProfile
    });

    expect(plan.taskType).toBe('initial_generate');
    expect(plan.objective).toContain('客户成功工作台');
    expect(plan.allowedPaths).toContain('src/**');
    expect(plan.forbiddenPaths).toContain('.env');
    expect(plan.validationCommands).toEqual(['pnpm typecheck', 'pnpm build']);
    expect(plan.inputSummary).toContain('页面: 1');
    expect(JSON.stringify(plan)).not.toContain('RAW_PROMPT_SHOULD_NOT_LEAK');
  });
});
