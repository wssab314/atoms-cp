import { readFile, stat } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.skip(process.env.REAL_DOUBAO_E2E !== '1', 'Real Doubao E2E is opt-in and requires a running local real stack.');

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

async function expectNoForbiddenUserTerms(pageText: string) {
  for (const term of forbiddenUserTerms) {
    expect(pageText).not.toContain(term);
  }
}

async function fetchJson<T>(page: Page, path: string): Promise<T | undefined> {
  const response = await page.request.get(path);
  if (!response.ok()) {
    return undefined;
  }
  return await response.json() as T;
}

async function collectDiagnostics(page: Page, projectId: string | undefined) {
  if (!projectId) {
    return {
      projectId: null,
      status: null,
      traceSummary: []
    };
  }

  const [status, traces] = await Promise.all([
    fetchJson<Record<string, unknown>>(page, `/api/projects/${projectId}/generation-status`),
    fetchJson<Array<{ id: string; type: string; visibility: string; message: string; createdAt: string }>>(page, `/api/projects/${projectId}/trace-events?limit=12`)
  ]);

  return {
    projectId,
    status,
    traceSummary: (traces ?? [])
      .filter((trace) => trace.visibility === 'user')
      .map((trace) => ({
        id: trace.id,
        type: trace.type,
        message: trace.message,
        createdAt: trace.createdAt
      }))
  };
}

async function readySnapshotCount(page: Page, projectId: string): Promise<number> {
  const snapshots = await fetchJson<Array<{ status: string }>>(page, `/api/projects/${projectId}/preview-snapshots`);
  return (snapshots ?? []).filter((snapshot) => snapshot.status === 'ready').length;
}

function listZipEntries(buffer: Buffer): Array<{ name: string; uncompressedSize: number }> {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error('Downloaded file is not a valid zip archive.');
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: Array<{ name: string; uncompressedSize: number }> = [];
  let offset = centralDirectoryOffset;

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Downloaded zip central directory is invalid.');
    }
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
    entries.push({ name, uncompressedSize });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

test('real local Doubao full user path: register, generate, preview, patch, and download', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const email = `r92-${Date.now()}@example.local`;
  const password = 'local-real-doubao-test-1234';
  let projectId: string | undefined;

  try {
    await page.goto('/login');
    await page.getByRole('button', { name: '注册' }).click();
    await page.getByLabel('昵称').fill('R9.6 Real User');
    await page.getByLabel('电子邮箱').fill(email);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: /创建账户并进入/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByLabel('输入应用想法描述').fill([
      '做一个小型咖啡店会员运营看板。',
      '需要展示今日营业额、会员新增、热销饮品排行、近七日销售趋势。',
      '页面风格安静、清爽、适合店长每天查看。'
    ].join('\n'));
    await page.getByRole('button', { name: /开始生成/ }).click();
    await expect(page).toHaveURL(/\/app\/.+\/generating$/);
    projectId = page.url().match(/\/app\/([^/?#]+)\/generating/)?.[1];
    await expect(page.getByLabel('AI 助手过程')).toContainText(/正在整理需求|正在生成风格方案|正在创建工程|正在编写应用|预览快照/, {
      timeout: 120_000
    });
    await expect(page).toHaveURL(/\/app\/[^/]+$/, { timeout: 10 * 60 * 1000 });
    await expect(page.getByText('应用查看器').first()).toBeVisible();
    await expect(page.frameLocator('iframe[title="应用查看器稳定版快照"]').locator('[data-ai-id]').first()).toBeVisible({
      timeout: 60_000
    });
    await expectNoForbiddenUserTerms(await page.locator('body').innerText());

    const projectUrl = page.url();
    const projectMatch = projectUrl.match(/\/app\/([^/?#]+)/);
    expect(projectMatch?.[1]).toBeTruthy();
    projectId = projectMatch![1]!;
    const initialReadySnapshots = await readySnapshotCount(page, projectId);

    await page.getByLabel('继续告诉我你想调整什么').fill('请把首页标题改成今日咖啡运营总览，并让首屏更适合店长查看。');
    await page.getByRole('button', { name: '发送' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/${projectId}/generating$`), { timeout: 30_000 });
    await expect(page.getByLabel('AI 助手过程')).toContainText(/已收到修改需求|正在编写应用|预览快照/, {
      timeout: 180_000
    });
    await expect(page).toHaveURL(new RegExp(`/app/${projectId}$`), { timeout: 8 * 60 * 1000 });
    await expect(page.frameLocator('iframe[title="应用查看器稳定版快照"]').locator('[data-ai-id]').first()).toBeVisible();
    expect(await readySnapshotCount(page, projectId)).toBeGreaterThan(initialReadySnapshots);
    await expectNoForbiddenUserTerms(await page.locator('body').innerText());

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTitle('下载代码').click()
    ]);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const archiveStats = await stat(downloadPath!);
    expect(archiveStats.size).toBeGreaterThan(100);
    const entries = listZipEntries(await readFile(downloadPath!));
    expect(entries.find((entry) => entry.name === 'ai-manifest.json')?.uncompressedSize).toBeGreaterThan(0);
    expect(entries.map((entry) => entry.name)).not.toEqual(expect.arrayContaining([
      '.env',
      'node_modules',
      'dist',
      '.git'
    ]));
    expect(entries.map((entry) => entry.name).join('\n')).not.toMatch(/(^|\/)(\.env|node_modules|dist|\.git)(\/|$)|\/tmp|workspace/i);
  } catch (error) {
    console.error('R9.6 real-local diagnostics:', JSON.stringify(await collectDiagnostics(page, projectId), null, 2));
    throw error;
  }
});
