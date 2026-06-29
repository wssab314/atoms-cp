import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildProcessEnv, buildProjectPreview } from './buildProject.js';

describe('buildProjectPreview', () => {
  it('writes project files, runs a build command, and copies dist to preview hosting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-test-'));
    const previewRoot = join(root, 'previews');

    try {
      const result = await buildProjectPreview({
        buildJobId: 'build-1',
        projectFiles: [
          {
            path: 'package.json',
            content: '{"scripts":{"build":"vite build"}}'
          },
          {
            path: 'src/App.tsx',
            content: 'export function App() { return <main data-ai-id="home.hero.title">Preview</main>; }'
          }
        ],
        previewRoot,
        workspaceRoot: join(root, 'workspace'),
        runCommand: async ({ cwd }) => {
          await writeFile(join(cwd, 'dist', 'index.html'), '<main data-ai-id="home.hero.title">Preview</main>');
          return {
            exitCode: 0,
            stdout: 'build ok',
            stderr: ''
          };
        }
      });

      const previewHtml = await readFile(join(previewRoot, 'build-1', 'index.html'), 'utf8');
      expect(result.status).toBe('success');
      expect(result.logs.map((log) => log.line)).toContain('build ok');
      expect(previewHtml).toContain('data-ai-id="home.hero.title"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rewrites root-relative Vite asset paths so preview snapshots load inside nested routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-assets-test-'));
    const previewRoot = join(root, 'previews');

    try {
      const result = await buildProjectPreview({
        buildJobId: 'build-assets',
        projectFiles: [
          {
            path: 'package.json',
            content: '{"scripts":{"build":"vite build"}}'
          }
        ],
        previewRoot,
        workspaceRoot: join(root, 'workspace'),
        runCommand: async ({ cwd }) => {
          await writeFile(
            join(cwd, 'dist', 'index.html'),
            '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"><div style="background:url(/assets/bg.png)"></div>',
            'utf8'
          );
          return {
            exitCode: 0,
            stdout: 'build ok',
            stderr: ''
          };
        }
      });

      const previewHtml = await readFile(join(previewRoot, 'build-assets', 'index.html'), 'utf8');
      expect(result.status).toBe('success');
      expect(previewHtml).toContain('src="./assets/index.js"');
      expect(previewHtml).toContain('href="./assets/index.css"');
      expect(previewHtml).toContain('url(./assets/bg.png)');
      expect(previewHtml).not.toContain('"/assets/');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('times out stalled builds and removes the temporary workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-timeout-test-'));
    const workspaceRoot = join(root, 'workspace');

    try {
      const result = await buildProjectPreview({
        buildJobId: 'build-timeout',
        projectFiles: [
          {
            path: 'package.json',
            content: '{"scripts":{"build":"vite build"}}'
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot,
        maxBuildMs: 5,
        runCommand: async () => new Promise(() => {
          // Intentionally never resolves; buildProjectPreview must enforce its timeout.
        })
      });

      await expect(access(workspaceRoot)).rejects.toThrow();
      expect(result.status).toBe('failed');
      expect(result.errorSummary).toBe('Build timed out after 5ms.');
      expect(result.logs.map((log) => log.line)).toContain('Build timed out after 5ms.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('masks secrets and caps build output logs before returning them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-build-log-test-'));
    const secret = 'test-build-secret-value';

    try {
      const result = await buildProjectPreview({
        buildJobId: 'build-logs',
        projectFiles: [
          {
            path: 'package.json',
            content: '{"scripts":{"build":"vite build"}}'
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace'),
        maxLogLines: 2,
        secretValues: [secret],
        runCommand: async ({ cwd }) => {
          await writeFile(join(cwd, 'dist', 'index.html'), '<main>Preview</main>');
          return {
            exitCode: 0,
            stdout: `line 1\nleaked ${secret}\nline 3`,
            stderr: 'line 4'
          };
        }
      });

      const logText = result.logs.map((log) => log.line).join('\n');
      const commandLogs = result.logs.filter((log) => log.stream === 'stdout' || log.stream === 'stderr');
      expect(result.status).toBe('success');
      expect(commandLogs).toHaveLength(2);
      expect(logText).toContain('[REDACTED]');
      expect(logText).not.toContain(secret);
      expect(logText).toContain('Build log truncated after 2 lines.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not pass host secrets into the generated project build process', () => {
    const env = buildProcessEnv({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      DEEPSEEK_API_KEY: 'secret',
      GITHUB_TOKEN: 'secret',
      DATABASE_URL: 'postgres://secret',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
    });

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      CI: 'true',
      NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/'
    });
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
