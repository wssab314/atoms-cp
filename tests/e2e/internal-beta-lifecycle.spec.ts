import { expect, test, type Page } from '@playwright/test';

const apiOrigin = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:4108';
const internalToken = process.env.INTERNAL_E2E_TOKEN ?? 'atoms-cp-local-e2e-token';
const forbiddenUserTerms = [
  'Docker',
  'Vite',
  'pnpm',
  'terminal',
  'stdout',
  'stderr',
  'workspace',
  'node_modules',
  'HMR',
  'WebContainer'
];

async function registerAndLoginInBrowser(page: Page, input: {
  apiOrigin: string;
  email: string;
  password: string;
  name: string;
  expectedRole: 'creator' | 'admin';
}) {
  const registered = await page.context().request.post(`${input.apiOrigin}/api/auth/register`, {
    data: {
      email: input.email,
      password: input.password,
      name: input.name
    }
  });
  expect([201, 409]).toContain(registered.status());
  if (registered.status() === 201) {
    const user = await registered.json() as { role: string };
    expect(user.role).toBe(input.expectedRole);
  }

  await page.goto('/login');
  const session = await page.evaluate(
    async ({ origin, email, password }) => {
      const login = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });
      const me = await fetch(`${origin}/api/auth/me`, {
        credentials: 'include'
      });
      return {
        loginStatus: login.status,
        meStatus: me.status,
        meBody: await me.json()
      };
    },
    {
      origin: input.apiOrigin,
      email: input.email,
      password: input.password
    }
  ) as { loginStatus: number; meStatus: number; meBody: { role?: string } };
  expect(session.loginStatus).toBe(200);
  expect(session.meStatus).toBe(200);
  expect(session.meBody.role).toBe(input.expectedRole);
}

async function expectNoForbiddenUserTerms(pageText: string) {
  for (const term of forbiddenUserTerms) {
    expect(pageText).not.toContain(term);
  }
}

test.describe('R8 internal beta lifecycle gate', () => {
  test('validates project generation, preview, inspector, rollback, publish, and admin observability', async ({ page, request }) => {
    const lifecycle = await request.post(`${apiOrigin}/api/internal/e2e/internal-beta-lifecycle`, {
      headers: {
        'x-internal-e2e-token': internalToken
      },
      data: {
        projectName: 'R8 浏览器验收项目'
      }
    });

    expect(lifecycle.status()).toBe(201);
    const report = await lifecycle.json() as {
      projectId: string;
      previewUrl: string;
      frontendRoutes: {
        workbench: string;
        inspector: string;
        versions: string;
        publish: string;
        admin: string;
      };
      traceSummary: Array<{ label: string; message: string }>;
    };

    expect(report.projectId).toBeTruthy();
    expect(report.previewUrl).toContain('/preview/');
    expect(report.traceSummary.map((event) => event.label)).toEqual(
      expect.arrayContaining(['准备应用', '生成版本', '预览快照', '继续修改', '回退版本', '发布检查'])
    );

    await registerAndLoginInBrowser(page, {
      apiOrigin,
      email: 'creator@example.local',
      password: 'creator-pass-12345',
      name: 'E2E Creator',
      expectedRole: 'creator'
    });

    await page.goto(report.frontendRoutes.workbench);
    await expect(page.getByText('应用查看器').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /AI 助手/i })).toBeVisible();
    await expect(page.getByPlaceholder(/继续告诉我你想调整什么/i)).toBeVisible();
    await expect(page.frameLocator('iframe[title="应用查看器稳定版快照"]').locator('[data-ai-id]').first()).toBeVisible();
    await expectNoForbiddenUserTerms(await page.locator('body').innerText());

    await page.goto(report.frontendRoutes.inspector);
    const previewFrame = page.frameLocator('iframe[title="应用查看器稳定版快照"]');
    await previewFrame.locator('[data-ai-id]').first().click();
    await expect(page.getByText(/已选择：\[/)).toBeVisible();
    await page.getByPlaceholder(/输入要直接替换的新文字/i).fill('R8 E2E 新标题');
    await page.getByRole('button', { name: '确认修改' }).click();
    await expect(page).toHaveURL(/\/generating$/);

    await page.goto(report.frontendRoutes.versions);
    await expect(page.getByRole('heading', { name: /版本历史/i })).toBeVisible();
    await expect(page.getByText(/稳定版本|历史版本|初始生成|局部微调|回退版本/).first()).toBeVisible();
    await expectNoForbiddenUserTerms(await page.locator('body').innerText());

    await page.goto(report.frontendRoutes.publish);
    await expect(page.getByRole('heading', { name: /发布设置/i })).toBeVisible();
    await expect(page.getByText(/一键发布|确认一键发布|当前发布条件尚未满足/).first()).toBeVisible();
    await expectNoForbiddenUserTerms(await page.locator('body').innerText());

    await registerAndLoginInBrowser(page, {
      apiOrigin,
      email: 'e2e-admin@example.local',
      password: 'admin-pass-12345',
      name: 'E2E Admin',
      expectedRole: 'admin'
    });

    await page.goto(report.frontendRoutes.admin);
    const runtimeSummary = page.getByRole('heading', { name: /运行态摘要/ }).first();
    if (!(await runtimeSummary.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /节点执行状态/ }).first().click();
    }
    await expect(page.getByRole('heading', { name: /运行态摘要/ })).toBeVisible();
    await expect(page.getByText(/系统快照资源历史/)).toBeVisible();
    await expect(page.getByText(/系统全局审计日志/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('local-e2e-preview-secret');
  });
});
