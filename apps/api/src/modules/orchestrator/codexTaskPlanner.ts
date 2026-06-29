import type { AppSpec, CodexTaskRecord, CodexTaskSpec, DesignProfile, ProjectDetail } from '@atoms-cp/shared';

export type CodexTaskPlan = Pick<
  CodexTaskRecord,
  'taskType' | 'objective' | 'inputSummary' | 'allowedPaths' | 'forbiddenPaths' | 'validationCommands'
> & {
  taskSpec: CodexTaskSpec;
};

interface CreateInitialCodexTaskPlanInput {
  project: ProjectDetail;
  appSpec: AppSpec;
  designProfile: DesignProfile;
}

function sanitizeRawPrompt(value: string, rawPrompt: string): string {
  if (!rawPrompt || !value.includes(rawPrompt)) {
    return value;
  }

  return value.replaceAll(rawPrompt, '用户需求已整理为结构化产品规格。');
}

function sanitizeStructuredContext<T>(value: T, rawPrompt: string): T {
  if (typeof value === 'string') {
    return sanitizeRawPrompt(value, rawPrompt) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredContext(item, rawPrompt)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeStructuredContext(item, rawPrompt)])
    ) as T;
  }

  return value;
}

export function createInitialCodexTaskPlan(input: CreateInitialCodexTaskPlanInput): CodexTaskPlan {
  const taskAppSpec = sanitizeStructuredContext(input.appSpec, input.project.prompt);
  const taskDesignProfile = sanitizeStructuredContext(input.designProfile, input.project.prompt);
  const pageRoutes = taskAppSpec.pages.map((page) => page.route).join(', ');
  const dataModelNames = taskAppSpec.dataModels.map((model) => model.name).join(', ') || 'none';
  const integrationNames = taskAppSpec.integrations.join(', ') || 'none';
  const isMiniProgram = input.project.target === 'mini_program';
  const allowedPaths = isMiniProgram
    ? [
        'src/**',
        'ai-manifest.json'
      ]
    : [
        'src/**',
        'public/**',
        'index.html',
        'ai-manifest.json'
      ];
  const forbiddenPaths = [
    '.env',
    '.env.*',
    'package.json',
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'vite.config.ts',
    'node_modules/**',
    'dist/**',
    '../**',
    'apps/**',
    'packages/**',
    'infra/**'
  ];
  const validationCommands = ['platform preview build', 'ai-manifest validation'];

  return {
    taskType: 'initial_generate',
    objective: `Create the first runnable ${input.project.target} app for ${input.appSpec.appName}.`,
    inputSummary: [
      `应用: ${taskAppSpec.appName}`,
      `目标用户: ${taskAppSpec.targetUser}`,
      `应用目标: ${taskAppSpec.appGoal}`,
      `页面: ${taskAppSpec.pages.length} (${pageRoutes})`,
      `数据模型: ${dataModelNames}`,
      `集成: ${integrationNames}`,
      `视觉方向: ${taskDesignProfile.name} - ${taskDesignProfile.description}`,
      `验收重点: ${taskAppSpec.acceptanceCriteria.join('；')}`
    ].join('\n'),
    taskSpec: {
      goal: `Create the first runnable ${input.project.target} app for ${input.appSpec.appName}.`,
      appSpec: taskAppSpec,
      designProfile: taskDesignProfile,
      targetChange: {
        type: 'initial_generate',
        summary: `Generate the initial ${input.project.target} app from confirmed AppSpec and DesignProfile.`
      },
      allowedPaths,
      forbiddenPaths,
      dependencyPolicy: 'forbid_new_dependencies',
      validationCommands,
      platform: input.project.target,
      expectedOutputs: isMiniProgram
        ? ['Controlled Taro mini program files', 'ai-manifest.json', 'Versioned workspace files']
        : ['Controlled React/Vite app files', 'ai-manifest.json', 'Versioned workspace files']
    },
    allowedPaths,
    forbiddenPaths,
    validationCommands
  };
}
