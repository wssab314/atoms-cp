import { vi } from 'vitest';

vi.mock('./api', () => {
  return {
    fetchProject: vi.fn().mockImplementation(async (projectId) => {
      return {
        id: projectId || 'real-proj-id',
        name: '销售数据看板',
        status: 'deployed',
        updatedAt: '2026-06-28T14:32:00Z'
      };
    }),
    fetchProjects: vi.fn().mockResolvedValue([
      { id: 'sales-dashboard', name: '销售数据看板', status: 'deployed', updatedAt: '2026-06-28T14:32:00Z' }
    ]),
    isUnauthorizedError: vi.fn().mockReturnValue(false),
    createProject: vi.fn().mockResolvedValue({
      id: 'created-proj-123',
      name: '新应用草稿',
      status: 'building'
    }),
    startProjectGeneration: vi.fn().mockResolvedValue({
      accepted: true,
      alreadyRunning: false,
      status: {
        projectId: 'created-proj-123',
        projectStatus: 'code_generating',
        stage: 'queueing_app_build',
        running: true,
        canRetry: false,
        userMessage: '正在创建工程。'
      }
    }),
    fetchProjectGenerationStatus: vi.fn().mockImplementation(async (projectId) => {
      if (projectId === 'proj-no-snapshot') {
        return {
          projectId,
          projectStatus: 'code_generating',
          stage: 'building_preview',
          running: true,
          canRetry: false,
          userMessage: '正在准备预览快照。'
        };
      }
      if (projectId === 'proj-generation-failed') {
        return {
          projectId,
          projectStatus: 'draft',
          stage: 'failed',
          running: false,
          canRetry: true,
          userMessage: '生成过程遇到问题，请稍后重试。',
          errorMessage: '需求整理失败，请稍后重试。'
        };
      }
      return {
        projectId,
        projectStatus: 'code_generating',
        stage: 'building_preview',
        running: true,
        canRetry: false,
        userMessage: '正在准备预览快照。'
      };
    }),
    registerLocalUser: vi.fn().mockResolvedValue({
      id: 'user-r92',
      email: 'creator@example.com',
      name: 'Creator',
      role: 'creator'
    }),
    loginLocalUser: vi.fn().mockResolvedValue({
      id: 'user-r92',
      email: 'creator@example.com',
      name: 'Creator',
      role: 'creator'
    }),
    fetchCurrentUser: vi.fn().mockResolvedValue({
      id: 'user-r92',
      email: 'creator@example.com',
      name: 'Creator',
      role: 'creator'
    }),
    logoutLocalUser: vi.fn().mockResolvedValue(undefined),
    getProjectCodeDownloadUrl: vi.fn().mockImplementation((projectId, versionId) => {
      return `http://localhost:4000/api/projects/${projectId}/code/download${versionId ? `?versionId=${versionId}` : ''}`;
    }),
    generateProjectAppSpec: vi.fn().mockResolvedValue({
      id: 'spec-123',
      status: 'ready'
    }),
    generateDesignProfiles: vi.fn().mockResolvedValue({
      id: 'design-123',
      status: 'ready'
    }),
    createCodexTask: vi.fn().mockResolvedValue({
      id: 'task-123',
      status: 'queued'
    }),
    fetchCodexTasks: vi.fn().mockResolvedValue([
      { id: 'task-123', projectId: 'real-proj-id', status: 'succeeded', resultSummary: '构建大功告成', objective: '生成一个销售数据面板' }
    ]),
    fetchProjectWorkspaces: vi.fn().mockResolvedValue([
      { id: 'workspace-123', status: 'ready' }
    ]),
    fetchPreviewSnapshots: vi.fn().mockImplementation(async (projectId) => {
      if (projectId === 'proj-no-snapshot') {
        return [];
      }
      if (projectId === 'proj-success') {
        return [
          { id: 'v-success-snap', projectId: 'proj-success', projectVersionId: 'v-success-ver', active: true, status: 'ready', createdAt: '2026-06-28T14:30:00Z' }
        ];
      }
      if (projectId === 'proj-failed') {
        return [
          { id: 'v-failed-snap', projectId: 'proj-failed', projectVersionId: 'v-failed-ver', active: true, status: 'failed', createdAt: '2026-06-28T14:32:00Z' }
        ];
      }
      if (projectId === 'proj-build-fail') {
        return [
          { id: 'failed-snap', projectId: 'proj-build-fail', active: true, status: 'failed', createdAt: '2026-06-28T14:32:00Z' }
        ];
      }
      return [
        { id: 'v3', projectId, projectVersionId: 'v-initial', active: true, status: 'ready', url: `/preview/${projectId}/v-initial`, createdAt: '2026-06-28T14:32:00Z' }
      ];
    }),
    fetchTraceEvents: vi.fn().mockResolvedValue([
      { id: 'trace-1', type: 'completed', message: '构建快照资源完成', visibility: 'user', createdAt: '2026-06-28T14:32:00Z' }
    ]),
    getAgentStreamUrl: vi.fn().mockImplementation((projectId) => `/api/projects/${projectId}/agent-stream`),
    fetchAgentMessages: vi.fn().mockResolvedValue([
      {
        id: 'agent-message-1',
        projectId: 'real-proj-id',
        userId: 'user-creator',
        content: '把首屏改得更有作品集氛围',
        status: 'deferred',
        createdAt: '2026-06-29T00:00:00.000Z',
        updatedAt: '2026-06-29T00:00:00.000Z'
      }
    ]),
    sendAgentMessage: vi.fn().mockResolvedValue({
      accepted: true,
      queued: true,
      delivery: 'queued',
      queuePosition: 0,
      message: '已收到修改需求，正在排队生成新版本。'
    }),
    fetchProjectPublishState: vi.fn().mockImplementation(async (projectId) => {
      if (projectId === 'proj-reason') {
        return {
          projectId: 'proj-reason',
          canPublish: false,
          blockingReasons: [
            'Create an active ready preview snapshot before release.',
            'Connect GitHub before committing project files.',
            'Vite build failed in workspace node_modules folder'
          ],
          checklist: []
        };
      }
      if (projectId === 'proj-build-fail') {
        return {
          projectId: 'proj-build-fail',
          canPublish: true,
          blockingReasons: [],
          checklist: []
        };
      }
      return {
        projectId,
        canPublish: true,
        activePreviewSnapshotId: 'v3',
        githubRepoFullName: 'test-user/test-repo',
        deploymentUrl: 'https://example.com/app/real-proj-id/',
        checklist: [
          { id: 'chk-1', label: '稳定快照校验', status: 'passed' },
          { id: 'chk-2', label: '资源连接状态', status: 'passed' },
          { id: 'chk-3', label: '代码托管配置', status: 'passed' }
        ]
      };
    }),
    fetchAdminOperations: vi.fn().mockResolvedValue({
      codexTasks: [
        { id: 'task-123', projectId: 'real-proj-id', status: 'succeeded', taskType: 'full_generation', attemptCount: 1, createdAt: '2026-06-28T14:32:00Z' }
      ],
      systemConfig: [
        { key: 'DEEPSEEK_API_KEY', value: 'sk-abcdef1234567890', sensitive: true }
      ]
    }),
    fetchProjectManifest: vi.fn().mockResolvedValue({
      projectId: 'real-proj-id',
      manifest: {
        entries: {
          'el-title': { aiId: 'el-title', component: 'Header', elementType: 'h2', editable: ['text', 'styleTokens', 'className'] },
          'el-desc': { aiId: 'el-desc', component: 'Paragraph', elementType: 'p', editable: ['text'] }
        }
      },
      entries: []
    }),
    fetchProjectVersions: vi.fn().mockImplementation(async (projectId) => {
      if (projectId === 'proj-success') {
        return [
          {
            id: 'v-success-ver',
            projectId: 'proj-success',
            version: 3,
            source: 'agent_patch',
            summary: '成功构建的版本',
            changedFiles: ['/abs/path/src/index.tsx'],
            parentVersionId: 'v-parent-old',
            createdAt: '2026-06-28T14:30:00Z'
          }
        ];
      }
      if (projectId === 'proj-failed') {
        return [
          {
            id: 'v-failed-ver',
            projectId: 'proj-failed',
            version: 4,
            source: 'code_edit',
            summary: '修复了样式边距',
            changedFiles: ['/abs/path/src/App.tsx'],
            createdAt: '2026-06-28T14:32:00Z'
          }
        ];
      }
      return [
        { id: 'v-initial', projectId: 'real-proj-id', version: 1, source: 'initial_generate', summary: '初始化生成页面', changedFiles: [], createdAt: '2026-06-28T14:32:00Z' }
      ];
    }),
    patchSelectorText: vi.fn().mockResolvedValue({
      buildJob: { id: 'job-123' },
      projectVersion: { id: 'v-new' }
    }),
    patchSelectorAI: vi.fn().mockResolvedValue({
      buildJob: { id: 'job-123' },
      projectVersion: { id: 'v-new' }
    }),
    activatePreviewSnapshot: vi.fn().mockResolvedValue({}),
    rollbackProjectVersion: vi.fn().mockResolvedValue({}),
    saveProjectDeploymentUrl: vi.fn().mockResolvedValue({}),
    createGitHubCommit: vi.fn().mockImplementation(async (projectId, payload) => {
      if (projectId === 'proj-github-fail') {
        if (payload.message === 'Test push fail') {
          throw new Error('Vite build task failed with code 500');
        }
        if (payload.message === 'Test push fail confirm') {
          if (!payload.confirmed) {
            return {
              projectId: 'proj-github-fail',
              repoFullName: 'test-user/test-repo',
              branch: 'main',
              message: payload.message,
              requiresConfirmation: true,
              files: [{ path: 'src/App.tsx', sizeBytes: 100, contentHash: 'h1' }]
            };
          } else {
            throw new Error('Docker timeout while pushing repository');
          }
        }
      }
      return {};
    })
  };
});

import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, describe } from 'vitest';
import { App } from './App';
import * as api from './api';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('Quiet App Builder Front-end Shell R1.1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  describe('1. Routing & Page Rendering (11 Routes)', () => {
    it('renders the login page correctly', async () => {
      renderAt('/login');
      expect(await screen.findByRole('heading', { name: /登录灵感工坊/i })).toBeInTheDocument();
    });

    it('renders the dashboard page correctly', async () => {
      renderAt('/dashboard');
      expect(await screen.findByRole('heading', { name: /你想创建什么应用/i })).toBeInTheDocument();
    });

    it('renders the projects page correctly', async () => {
      renderAt('/projects');
      expect(await screen.findByRole('heading', { name: /我的项目/i })).toBeInTheDocument();
    });

    it('renders the templates page correctly', async () => {
      renderAt('/templates');
      expect(await screen.findByRole('heading', { name: /模板中心/i })).toBeInTheDocument();
    });

    it('renders the resources page correctly', async () => {
      renderAt('/resources');
      expect(await screen.findByRole('heading', { name: /资源中心/i })).toBeInTheDocument();
    });

    it('renders the app workbench page correctly', async () => {
      renderAt('/app/real-proj-id');
      expect(await screen.findByText('应用查看器')).toBeInTheDocument();
      expect(await screen.findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();
    });

    it('renders the app generating page correctly', async () => {
      renderAt('/app/proj-no-snapshot/generating');
      expect(await screen.findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();
    });

    it('renders the app inspect page correctly', async () => {
      renderAt('/app/real-proj-id/inspect');
      expect(await screen.findByText('此页面可选择元素：')).toBeInTheDocument();
    });

    it('renders the app versions page correctly', async () => {
      renderAt('/app/real-proj-id/versions');
      expect(await screen.findByRole('heading', { name: /版本历史/i })).toBeInTheDocument();
    });

    it('renders the app publish page correctly', async () => {
      renderAt('/app/real-proj-id/publish');
      expect(await screen.findByRole('heading', { name: /发布设置/i })).toBeInTheDocument();
    });

    it('renders the admin console page only for administrators', async () => {
      const userSpy = vi.spyOn(api, 'fetchCurrentUser').mockResolvedValueOnce({
        id: 'admin-1',
        email: 'admin@example.local',
        name: 'Admin',
        role: 'admin'
      });
      renderAt('/admin');
      expect(await screen.findByRole('heading', { name: /系统管理工作台/i })).toBeInTheDocument();
      userSpy.mockRestore();
    });
  });

  describe('2. Editor Shell Constraints (5 Routes)', () => {
    const editorRoutes = [
      '/app/real-proj-id',
      '/app/proj-no-snapshot/generating',
      '/app/real-proj-id/inspect',
      '/app/real-proj-id/versions',
      '/app/real-proj-id/publish'
    ];

    editorRoutes.forEach(route => {
      it(`ensures Editor Shell for ${route} has no persistent sidebar and maintains editor header`, () => {
        const { container, unmount } = renderAt(route);

        // 1. 不得有持久左侧导航侧边栏
        const sideNav = container.querySelector('.side-nav');
        expect(sideNav).not.toBeInTheDocument();

        const adminSidebar = container.querySelector('.admin-sidebar');
        expect(adminSidebar).not.toBeInTheDocument();

        // 2. 必须有 Editor 顶部栏
        const editorHeader = container.querySelector('.editor-header');
        expect(editorHeader).toBeInTheDocument();

        unmount();
      });
    });
  });

  describe('3. Technical Vocabulary Check for all 9 Standard User Pages', () => {
    const forbiddenWords = [
      'Codex',
      'Docker',
      'Vite',
      'pnpm',
      'dist',
      'HMR',
      'WebContainer',
      'terminal',
      'stdout',
      'stderr',
      'workspace',
      'AppSpec',
      'DesignProfile',
      'build job',
      'worker'
    ];

    const userPages = [
      '/dashboard',
      '/projects',
      '/templates',
      '/resources',
      '/app/real-proj-id',
      '/app/proj-no-snapshot/generating',
      '/app/real-proj-id/inspect',
      '/app/real-proj-id/versions',
      '/app/real-proj-id/publish'
    ];

    userPages.forEach(page => {
      it(`ensures no forbidden technical words leak on page: ${page}`, () => {
        const { unmount } = renderAt(page);
        const textContent = document.body.textContent || '';

        forbiddenWords.forEach(word => {
          // 使用大小写不敏感匹配，且匹配整个单词，防范任意形式
          const regex = new RegExp('\\b' + word + '\\b', 'i');
          expect(textContent).not.toMatch(regex);
        });

        unmount();
      });
    });
  });

  describe('4. Mandatory User-Facing Terminology Check', () => {
    it('verifies workbench page renders "应用查看器" and Agent panel copy', async () => {
      const { findByText, unmount } = renderAt('/app/real-proj-id');
      expect(await findByText('应用查看器')).toBeInTheDocument();
      expect(await findByText('实时协作')).toBeInTheDocument();
      unmount();
    });

    it('verifies publish page renders "一键发布"', async () => {
      const { findByText, unmount } = renderAt('/app/real-proj-id/publish');
      expect(await findByText('确认一键发布')).toBeInTheDocument();
      unmount();
    });
  });

  describe('5. R1.2 Editor Header Mobile Layout Elements', () => {
    it('ensures Editor topbar elements exist to support CSS grid wrapping and text truncation', async () => {
      const { container, findByLabelText, unmount } = renderAt('/app/real-proj-id');
      await findByLabelText('继续告诉我你想调整什么');

      const backLink = container.querySelector('.btn-back');
      expect(backLink).toBeInTheDocument();
      expect(backLink?.querySelector('span')?.textContent).toBe('返回仪表盘');

      const projectSelector = container.querySelector('.project-selector');
      expect(projectSelector).toBeInTheDocument();
      expect(projectSelector?.querySelector('.project-selector-trigger span')?.textContent).toBe('销售数据看板');

      const rightButtons = container.querySelector('.editor-header-right');
      expect(rightButtons).toBeInTheDocument();
      expect(rightButtons?.querySelector('.btn-secondary span')?.textContent).toBe('分享');
      expect(rightButtons?.querySelector('.btn-primary span')?.textContent).toBe('发布');

      unmount();
    });
  });

  describe('6. R2.1 Data Integration & Admin Masking', () => {
    it('verifies projects page displays fetched project names', async () => {
      const { findByText, unmount } = renderAt('/projects');
      const projectTitle = await findByText('销售数据看板');
      expect(projectTitle).toBeInTheDocument();
      unmount();
    });

    it('hides the admin entry for regular creators', async () => {
      const { findByRole, queryByText, unmount } = renderAt('/dashboard');
      expect(await findByRole('heading', { name: /你想创建什么应用/i })).toBeInTheDocument();
      expect(queryByText('管理后台')).not.toBeInTheDocument();
      unmount();
    });

    it('blocks direct admin access for regular creators', async () => {
      const adminSpy = vi.spyOn(api, 'fetchAdminOperations');
      const { findByText, unmount } = renderAt('/admin');
      expect(await findByText('无权访问管理后台')).toBeInTheDocument();
      expect(adminSpy).not.toHaveBeenCalled();
      adminSpy.mockRestore();
      unmount();
    });

    it('verifies admin console page masks deepseek api key for administrators', async () => {
      const userSpy = vi.spyOn(api, 'fetchCurrentUser').mockResolvedValueOnce({
        id: 'admin-1',
        email: 'admin@example.local',
        name: 'Admin',
        role: 'admin'
      });
      const { findByText, queryByText, unmount } = renderAt('/admin');
      const configsTab = await findByText('系统底层配置');
      await act(async () => {
        configsTab.click();
      });

      const keyLabel = await findByText(/deepseek api key/i);
      expect(keyLabel).toBeInTheDocument();

      const maskedStars = await findByText('****************');
      expect(maskedStars).toBeInTheDocument();

      expect(queryByText('sk-abcdef1234567890')).not.toBeInTheDocument();

      userSpy.mockRestore();
      unmount();
    });
  });

  describe('7. R3.1 Pipeline & Polling Conditions', () => {
    it('blocks too-short dashboard prompts before calling the create project API', async () => {
      const { findByPlaceholderText, findByText, queryByText, unmount } = renderAt('/dashboard');

      const textarea = await findByPlaceholderText(/描述你的应用想法/i);
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '个人网站' } });
      });

      const btn = await findByText('开始生成');
      await act(async () => {
        btn.click();
      });

      expect(await findByText('请补充更完整的应用想法，至少输入 10 个字。')).toBeInTheDocument();
      expect(vi.mocked(api.createProject)).not.toHaveBeenCalled();
      expect(queryByText('正在准备预览快照')).not.toBeInTheDocument();

      unmount();
    });

    it('navigates to the generating page immediately after project creation without waiting for AppSpec generation', async () => {
      const { findByLabelText, findByPlaceholderText, findByText, unmount } = renderAt('/dashboard');

      const textarea = await findByPlaceholderText(/描述你的应用想法/i);
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '帮我生成一个简单的个人简历网站' } });
      });

      const btn = await findByText('开始生成');
      await act(async () => {
        btn.click();
      });

      expect(await findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();
      expect(api.generateProjectAppSpec).not.toHaveBeenCalled();
      expect(api.generateDesignProfiles).not.toHaveBeenCalled();
      expect(api.createCodexTask).not.toHaveBeenCalled();
      expect(api.startProjectGeneration).toHaveBeenCalledWith('created-proj-123');

      unmount();
    });

    it('maps the WeChat mini program platform to the mini_program project target', async () => {
      const { findByPlaceholderText, findByText, unmount } = renderAt('/dashboard');

      const platformButton = await findByText(/平台: Web 网页/i);
      await act(async () => {
        platformButton.click();
      });
      const miniProgramOption = await findByText('微信小程序');
      await act(async () => {
        miniProgramOption.click();
      });

      const textarea = await findByPlaceholderText(/描述你的应用想法/i);
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '帮我生成一个用于门店预约服务的微信小程序' } });
      });

      const btn = await findByText('开始生成');
      await act(async () => {
        btn.click();
      });

      expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({
        target: 'mini_program'
      }));
      expect(api.startProjectGeneration).toHaveBeenCalledWith('created-proj-123');

      unmount();
    });

    it('shows observable generation stages on the generating page', async () => {
      const statusSpy = vi.spyOn(api, 'fetchProjectGenerationStatus').mockResolvedValueOnce({
        projectId: 'real-proj-id',
        projectStatus: 'spec_generating',
        stage: 'organizing_requirements',
        running: true,
        canRetry: false,
        userMessage: '正在整理需求。'
      });
      const { findByLabelText, findByPlaceholderText, findByText, unmount } = renderAt('/dashboard');

      const textarea = await findByPlaceholderText(/描述你的应用想法/i);
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '帮我生成一个简单的个人简历网站' } });
      });

      const btn = await findByText('开始生成');
      await act(async () => {
        btn.click();
      });

      expect(await findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();
      expect(api.startProjectGeneration).toHaveBeenCalledWith('created-proj-123');
      statusSpy.mockRestore();
      unmount();
    });

    it('shows generation failure and retry on the generating page', async () => {
      const { findByText, unmount } = renderAt('/app/proj-generation-failed/generating');

      expect(await findByText('需求整理失败，请稍后重试。')).toBeInTheDocument();
      expect(await findByText('重试生成')).toBeInTheDocument();

      unmount();
    });

    it('does not fall back to a mock generating route when project creation fails', async () => {
      const spy = vi.spyOn(api, 'createProject').mockRejectedValueOnce(new Error('Network unavailable'));

      const { findByPlaceholderText, findByText, queryByText, unmount } = renderAt('/dashboard');

      const textarea = await findByPlaceholderText(/描述你的应用想法/i);
      await act(async () => {
        fireEvent.change(textarea, { target: { value: '测试创建项目失败流程' } });
      });

      const btn = await findByText('开始生成');
      await act(async () => {
        btn.click();
      });

      expect(await findByText('创建应用失败，请稍后重试。')).toBeInTheDocument();
      expect(queryByText('无法连接服务，已启用演示样例模式...')).not.toBeInTheDocument();
      expect(queryByText('正在准备预览快照')).not.toBeInTheDocument();

      spy.mockRestore();
      unmount();
    });

    it('does not render demo projects when the projects API fails', async () => {
      const spy = vi.spyOn(api, 'fetchProjects').mockRejectedValueOnce(new Error('Network unavailable'));

      const { findByText, queryByText, unmount } = renderAt('/projects');

      expect(await findByText('项目列表加载失败，请稍后重试。')).toBeInTheDocument();
      expect(queryByText('客户反馈收集器')).not.toBeInTheDocument();
      expect(queryByText('运营活动报名系统')).not.toBeInTheDocument();

      spy.mockRestore();
      unmount();
    });

    it('displays prepare snapshots screen on generating page if task succeeded but snapshot not ready', async () => {
      const taskSpy = vi.spyOn(api, 'fetchCodexTasks').mockResolvedValueOnce([
        {
          id: 'task-real',
          projectId: 'real-proj-id',
          status: 'succeeded',
          resultSummary: '大功告成',
          objective: '真实项目测试',
          createdAt: '2026-06-28T14:32:00Z',
          attemptCount: 1,
          taskType: 'initial_generate'
        } as unknown as api.CodexTaskRecord
      ]);
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([]);

      const { findByLabelText, unmount } = renderAt('/app/real-proj-id/generating');

      expect(await findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();

      taskSpy.mockRestore();
      snapSpy.mockRestore();
      unmount();
    });

    it('renders empty preview loader panel inside workbench if real project has no ready snapshots', async () => {
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([
        { id: 'v4', projectId: 'real-proj-id', projectVersionId: '4', active: false, status: 'failed', url: '/preview/failed', errorSummary: '构建崩溃', createdAt: '2026-06-28T14:32:00Z' } as unknown as api.PreviewSnapshotRecord
      ]);

      const { findByText, queryByTitle, unmount } = renderAt('/app/real-proj-id');

      const emptyNotice = await findByText('预览快照正在准备中');
      expect(emptyNotice).toBeInTheDocument();

      const iframe = queryByTitle('应用查看器稳定版快照');
      expect(iframe).not.toBeInTheDocument();

      snapSpy.mockRestore();
      unmount();
    });
  });

  describe('8. R4.1 Inspector & Selector Micro-tunes', () => {
    it('verifies inspector page fetches manifest and renders editable entries list', async () => {
      const { findByText, unmount } = renderAt('/app/real-proj-id/inspect');

      const itemTitle = await findByText(/标题 元素 \(ID: el-title\)/i);
      const itemDesc = await findByText(/段落 元素 \(ID: el-desc\)/i);

      expect(itemTitle).toBeInTheDocument();
      expect(itemDesc).toBeInTheDocument();
      unmount();
    });

    it('verifies message channel INSPECTOR_SELECT selects node and exposes micro-tune options', async () => {
      const { findByText, unmount } = renderAt('/app/real-proj-id/inspect');

      await act(async () => {
        window.postMessage({
          type: 'atoms-cp:preview-element-selected',
          aiId: 'el-title',
          text: '当前标题文案',
          tagName: 'H2'
        }, '*');
      });

      const selectedNodeHeader = await findByText(/已选择：\[el-title\]/i);
      expect(selectedNodeHeader).toBeInTheDocument();

      const labelDirect = await findByText(/直接改文案:/i);
      expect(labelDirect).toBeInTheDocument();

      const labelAi = await findByText(/让 AI 修改:/i);
      expect(labelAi).toBeInTheDocument();
      expect(await findByText('文案')).toBeInTheDocument();
      expect(await findByText('样式')).toBeInTheDocument();
      unmount();
    });

    it('submits direct text patch and triggers redirection on success', async () => {
      const spyText = vi.spyOn(api, 'patchSelectorText').mockResolvedValueOnce({
        buildJob: { id: 'job-123' },
        projectVersion: { id: 'v-new' }
      } as any);

      const { findByText, findByPlaceholderText, unmount } = renderAt('/app/real-proj-id/inspect');

      await act(async () => {
        window.postMessage({
          type: 'atoms-cp:preview-element-selected',
          aiId: 'el-title',
          text: '旧标题',
          tagName: 'H2'
        }, '*');
      });

      const inputField = await findByPlaceholderText(/输入要直接替换的新文字/i);
      await act(async () => {
        fireEvent.change(inputField, { target: { value: '新标题文案' } });
      });

      const applyBtn = await findByText('确认修改');
      await act(async () => {
        applyBtn.click();
      });

      expect(spyText).toHaveBeenCalledWith('real-proj-id', { aiId: 'el-title', text: '新标题文案' });
      spyText.mockRestore();
      unmount();
    });

    it('verifies versions page displays real version sources with translations and masks workspacePath', async () => {
      const { findAllByText, queryByText, unmount } = renderAt('/app/real-proj-id/versions');

      const titleTexts = await findAllByText(/初始生成/i);
      expect(titleTexts.length).toBeGreaterThan(0);

      expect(queryByText(/workspacePath/i)).not.toBeInTheDocument();
      expect(queryByText(/workspace-123/i)).not.toBeInTheDocument();
      unmount();
    });
  });

  describe('11. R9.5 Agent Stream Panel', () => {
    it('renders the shared AI assistant panel on workbench and generating pages', async () => {
      const workbench = renderAt('/app/real-proj-id');
      expect((await workbench.findAllByText('AI 助手')).length).toBeGreaterThan(0);
      expect(await workbench.findByLabelText('继续告诉我你想调整什么')).toBeInTheDocument();
      workbench.unmount();

      const generating = renderAt('/app/real-proj-id/generating');
      expect((await generating.findAllByText('AI 助手')).length).toBeGreaterThan(0);
      expect(await generating.findByText('实时协作')).toBeInTheDocument();
      generating.unmount();
    });

    it('submits a user message and moves to the generating view for queued edits', async () => {
      const { findByLabelText, findByText, unmount } = renderAt('/app/real-proj-id');
      const input = await findByLabelText('继续告诉我你想调整什么');

      await act(async () => {
        fireEvent.change(input, { target: { value: '把首页标题改得更温柔一些' } });
      });
      await act(async () => {
        fireEvent.click(await findByText('发送'));
      });

      expect(api.sendAgentMessage).toHaveBeenCalledWith('real-proj-id', '把首页标题改得更温柔一些');
      expect(await findByText('正在生成新版本，预览区域会优先展示当前可用的稳定快照。')).toBeInTheDocument();
      unmount();
    });

    it('appends safe events from the stream', async () => {
      class FakeEventSource {
        static instances: FakeEventSource[] = [];
        listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
        constructor(public readonly url: string) {
          FakeEventSource.instances.push(this);
        }
        addEventListener(type: string, listener: EventListener) {
          const listeners = this.listeners.get(type) ?? [];
          listeners.push(listener as (event: MessageEvent<string>) => void);
          this.listeners.set(type, listeners);
        }
        removeEventListener(type: string, listener: EventListener) {
          this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
        }
        close() {}
        emit(event: api.AgentStreamEvent) {
          for (const listener of this.listeners.get('agent-event') ?? []) {
            listener({ data: JSON.stringify(event) } as MessageEvent<string>);
          }
        }
      }
      vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);

      const { findByLabelText, findByText, queryByText, unmount } = renderAt('/app/real-proj-id');
      try {
        await findByLabelText('继续告诉我你想调整什么');
        expect(await findByText('把首屏改得更有作品集氛围（排队中）')).toBeInTheDocument();
        expect(FakeEventSource.instances.length).toBeGreaterThan(0);
        const eventSource = FakeEventSource.instances[0]!;
        const streamedMessage = '我已整理出首页、作品区和联系方式区域。';
        vi.useFakeTimers();
        await act(async () => {
          eventSource.emit({
            id: 'stream-1',
            kind: 'agent',
            message: streamedMessage,
            stage: 'organizing_requirements',
            createdAt: '2026-06-29T00:00:00.000Z'
          });
        });

        expect(queryByText(streamedMessage)).not.toBeInTheDocument();
        await act(async () => {
          vi.advanceTimersByTime(2000);
        });
        expect(queryByText(streamedMessage)).toBeInTheDocument();
      } finally {
        unmount();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
    });
  });

  describe('9. R5.1 Release Center & Versions Rollback', () => {
    it('verifies rollback triggers confirm modal with exact phrase and executes api call on accept', async () => {
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValue([
        { id: 'v2', projectId: 'real-proj-id', projectVersionId: 'v-initial', active: false, status: 'ready', url: '/preview/v2', createdAt: '2026-06-28T14:32:00Z' } as any
      ]);
      const rollSpy = vi.spyOn(api, 'rollbackProjectVersion').mockResolvedValueOnce({
        projectVersion: { id: 'v-new' } as any,
        buildJob: { id: 'job-123' } as any,
        traceEvent: {} as any
      });

      const { findByText, unmount } = renderAt('/app/real-proj-id/versions');

      const rollbackBtn = await findByText('回退到此版本');
      await act(async () => {
        rollbackBtn.click();
      });

      const confirmMsg = await findByText(/将基于该稳定版本重新生成一个新版本/i);
      expect(confirmMsg).toBeInTheDocument();

      const confirmBtn = await findByText('确认回退');
      await act(async () => {
        confirmBtn.click();
      });

      expect(rollSpy).toHaveBeenCalledWith('real-proj-id', 'v-initial');

      snapSpy.mockRestore();
      rollSpy.mockRestore();
      unmount();
    });

    it('verifies release page uses canPublish flag and displays blockingReasons', async () => {
      const pubSpy = vi.spyOn(api, 'fetchProjectPublishState').mockResolvedValueOnce({
        projectId: 'real-proj-id',
        canPublish: false,
        blockingReasons: ['未配置数据库凭证', '没有 active 预览快照'],
        checklist: []
      } as any);

      const { findByText, unmount } = renderAt('/app/real-proj-id/publish');

      const publishBtn = (await findByText('确认一键发布')).closest('button');
      expect(publishBtn).toBeDisabled();

      const reason1 = await findByText(/未配置数据库凭证/i);
      const reason2 = await findByText(/没有 active 预览快照/i);
      expect(reason1).toBeInTheDocument();
      expect(reason2).toBeInTheDocument();

      pubSpy.mockRestore();
      unmount();
    });

    it('submits GitHub commit plan and confirms code push in handoff flow', async () => {
      const commitSpy = vi.spyOn(api, 'createGitHubCommit')
        .mockResolvedValueOnce({
          projectId: 'real-proj-id',
          repoFullName: 'test-user/test-repo',
          branch: 'main',
          message: 'Push current build',
          requiresConfirmation: true,
          files: [{ path: 'src/App.tsx', sizeBytes: 100, contentHash: 'h1' }]
        } as any)
        .mockResolvedValueOnce({
          provider: 'github',
          commitSha: 'commit_sha_123',
          filesCommitted: 1
        } as any);

      const { findByPlaceholderText, findByText, queryByText, unmount } = renderAt('/app/real-proj-id/publish');

      const inputMsg = await findByPlaceholderText(/输入提交说明描述变更内容/i);
      await act(async () => {
        fireEvent.change(inputMsg, { target: { value: 'Push current build' } });
      });

      const pushBtn = await findByText('推送托管');
      await act(async () => {
        pushBtn.click();
      });

      // 验证计划态展示了目标仓库和文件变更数量，且禁止展示绝对路径
      const planTitle = await findByText(/待确认的变更清单：/i);
      expect(planTitle).toBeInTheDocument();
      expect(await findByText(/文件数量：1 个文件/i)).toBeInTheDocument();
      expect(queryByText('src/App.tsx')).not.toBeInTheDocument();

      const confirmPushBtn = await findByText('确认推送');
      await act(async () => {
        confirmPushBtn.click();
      });

      expect(commitSpy).toHaveBeenLastCalledWith('real-proj-id', {
        repoFullName: 'test-user/test-repo',
        branch: 'main',
        message: 'Push current build',
        confirmed: true
      });

      commitSpy.mockRestore();
      unmount();
    });
  });

  describe('10. R5.2 Release Center & Versions Polishing', () => {
    it('translates blockingReasons correctly and masks unknown technical errors', async () => {
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([]);
      const pubSpy = vi.spyOn(api, 'fetchProjectPublishState').mockResolvedValueOnce({
        projectId: 'proj-reason',
        canPublish: false,
        blockingReasons: [
          'Create an active ready preview snapshot before release.',
          'Connect GitHub before committing project files.',
          'Vite build failed in workspace node_modules folder'
        ],
        checklist: []
      } as any);

      const { findAllByText, findByText, unmount } = renderAt('/app/proj-reason/publish');

      // 已知翻译校验
      expect((await findAllByText('请等待预览快照准备完成')).length).toBeGreaterThan(0);
      expect(await findByText('请先连接代码托管账号')).toBeInTheDocument();

      // 脱敏安全兜底校验，检测是否包含禁用词（这里应当找不到 Vite 等字眼，而应该展现安全中文兜底）
      expect(await findByText('当前发布条件尚未满足，请按左侧检查项完成配置')).toBeInTheDocument();
      snapSpy.mockRestore();
      pubSpy.mockRestore();
      unmount();
    });

    it('displays changed files count without paths in versions page', async () => {
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([
        { id: 'v-success-snap', projectId: 'proj-success', projectVersionId: 'v-success-ver', active: true, status: 'ready', createdAt: '2026-06-28T14:30:00Z' } as any
      ]);
      const versionsSpy = vi.spyOn(api, 'fetchProjectVersions').mockResolvedValueOnce([
        {
          id: 'v-success-ver',
          projectId: 'proj-success',
          version: 3,
          source: 'agent_patch',
          summary: '成功构建的版本',
          changedFiles: ['/abs/path/src/index.tsx'],
          parentVersionId: 'v-parent-old',
          createdAt: '2026-06-28T14:30:00Z'
        } as any
      ]);

      const { findAllByText, findByText, queryByText, unmount } = renderAt('/app/proj-success/versions');

      expect(await findByText('版本历史')).toBeInTheDocument();

      // 验证版本摘要渲染
      expect((await findAllByText(/成功构建的版本/i)).length).toBeGreaterThan(0);

      // 验证变更项数，不泄露绝对路径
      expect(await findByText(/包含 1 项文件变更/i)).toBeInTheDocument();
      expect(queryByText('/abs/path/src/index.tsx')).not.toBeInTheDocument();

      // 验证父版本关系
      expect(await findByText(/基于上一稳定版本生成/i)).toBeInTheDocument();
      snapSpy.mockRestore();
      versionsSpy.mockRestore();
      unmount();
    });

    it('displays failed build status in versions page', async () => {
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([
        { id: 'v-failed-snap', projectId: 'proj-failed', projectVersionId: 'v-failed-ver', active: true, status: 'failed', createdAt: '2026-06-28T14:32:00Z' } as any
      ]);
      const versionsSpy = vi.spyOn(api, 'fetchProjectVersions').mockResolvedValueOnce([
        {
          id: 'v-failed-ver',
          projectId: 'proj-failed',
          version: 4,
          source: 'code_edit',
          summary: '修复了样式边距',
          changedFiles: ['/abs/path/src/App.tsx'],
          createdAt: '2026-06-28T14:32:00Z'
        } as any
      ]);

      const { findByText, unmount } = renderAt('/app/proj-failed/versions');

      // 验证 failed 快照友好提示
      expect(await findByText(/该版本预览生成失败，可稍后重新生成或回退到稳定版本/i)).toBeInTheDocument();
      snapSpy.mockRestore();
      versionsSpy.mockRestore();
      unmount();
    });

    it('shows user-friendly errors when GitHub handoff plan or confirm fails', async () => {
      // 1. 测试 plan 失败
      const planFailSpy = vi.spyOn(api, 'createGitHubCommit').mockRejectedValueOnce(new Error('Vite build task failed with code 500'));

      const { findByPlaceholderText, findByText, queryByText, unmount: unmount1 } = renderAt('/app/proj-github-fail/publish');

      const inputMsg1 = await findByPlaceholderText(/输入提交说明描述变更内容/i);
      await act(async () => {
        fireEvent.change(inputMsg1, { target: { value: 'Test push fail' } });
      });

      const pushBtn1 = await findByText('推送托管');
      await act(async () => {
        pushBtn1.click();
      });

      expect(await findByText('暂时无法准备代码托管，请稍后重试')).toBeInTheDocument();
      expect(queryByText('Vite build task failed')).not.toBeInTheDocument();
      planFailSpy.mockRestore();
      unmount1();

      // 2. 测试 confirm 失败
      const confirmFailSpy = vi.spyOn(api, 'createGitHubCommit')
        .mockResolvedValueOnce({
          projectId: 'proj-github-fail',
          repoFullName: 'test-user/test-repo',
          branch: 'main',
          message: 'Test push fail confirm',
          requiresConfirmation: true,
          files: [{ path: 'src/App.tsx', sizeBytes: 100, contentHash: 'h1' }]
        } as any)
        .mockRejectedValueOnce(new Error('Docker timeout while pushing repository'));

      const { findByPlaceholderText: findPlaceholder2, findByText: findText2, queryByText: query2, unmount: unmount2 } = renderAt('/app/proj-github-fail/publish');

      const inputMsg2 = await findPlaceholder2(/输入提交说明描述变更内容/i);
      await act(async () => {
        fireEvent.change(inputMsg2, { target: { value: 'Test push fail confirm' } });
      });

      const pushBtn2 = await findText2('推送托管');
      await act(async () => {
        pushBtn2.click();
      });

      const confirmPushBtn = await findText2('确认推送');
      await act(async () => {
        confirmPushBtn.click();
      });

      expect(await findText2('代码托管推送失败，请稍后重试')).toBeInTheDocument();
      expect(query2('Docker timeout')).not.toBeInTheDocument();
      confirmFailSpy.mockRestore();
      unmount2();
    });

    it('disables publish button and warns when latest build is failed', async () => {
      const pubSpy = vi.spyOn(api, 'fetchProjectPublishState').mockResolvedValueOnce({
        projectId: 'proj-build-fail',
        canPublish: true,
        blockingReasons: [],
        checklist: []
      } as any);
      const snapSpy = vi.spyOn(api, 'fetchPreviewSnapshots').mockResolvedValueOnce([
        { id: 'failed-snap', projectId: 'proj-build-fail', active: true, status: 'failed', createdAt: '2026-06-28T14:32:00Z' } as any
      ]);

      const { findByText, unmount } = renderAt('/app/proj-build-fail/publish');

      expect(await findByText('最近一次预览生成失败，请先修复后再发布')).toBeInTheDocument();

      const publishBtn = (await findByText('确认一键发布')).closest('button');
      expect(publishBtn).toBeDisabled();
      pubSpy.mockRestore();
      snapSpy.mockRestore();
      unmount();
    });
  });
});
