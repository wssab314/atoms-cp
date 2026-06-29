import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
        buildMode: 'strict',
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
        buildMode: 'strict',
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
        buildMode: 'strict',
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
        buildMode: 'strict',
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

  it('runs fast preview builds with template dependencies and without installing packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-build-test-'));
    const templateRoot = await createFastPreviewTemplate(root);

    try {
      const result = await buildProjectPreview({
        buildJobId: 'fast-build',
        buildMode: 'fast',
        templateRoot,
        cleanupWorkspace: false,
        projectFiles: [
          {
            path: 'package.json',
            content: JSON.stringify({
              dependencies: {
                react: '^19.0.0',
                recharts: '^2.0.0'
              }
            })
          },
          {
            path: 'src/App.tsx',
            content: `
              import { BrowserRouter } from 'react-router-dom';
              import { Camera } from 'lucide-react';
              import { LineChart } from 'recharts';
              import { useReactTable } from '@tanstack/react-table';
              import { useForm } from 'react-hook-form';
              import { z } from 'zod';
              import clsx from 'clsx';
              import { format } from 'date-fns';
              import { motion } from 'framer-motion';

              export function App() {
                useReactTable({ data: [], columns: [], getCoreRowModel: () => ({ rows: [], flatRows: [], rowsById: {} }) as never });
                useForm();
                z.object({});
                format(new Date(), 'yyyy');
                return <BrowserRouter><motion.main className={clsx('app')} data-ai-id="home.hero"><Camera /><LineChart /></motion.main></BrowserRouter>;
              }
            `
          },
          {
            path: 'ai-manifest.json',
            content: '{"version":1,"entries":[]}'
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace')
      });

      const previewHtml = await readFile(join(root, 'previews', 'fast-build', 'index.html'), 'utf8');
      const viteArgs = await readFile(join(root, 'workspace', 'vite-args.txt'), 'utf8');
      await expect(access(join(root, 'workspace', 'pnpm-install-called'))).rejects.toThrow();
      expect(result.status).toBe('success');
      expect(previewHtml).toContain('fast preview');
      expect(viteArgs).toContain('build --mode preview --minify=false --sourcemap=false');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs fast Taro preview builds from the preinstalled mini program template', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-taro-build-test-'));
    const templateRoot = await createFastTaroPreviewTemplate(root);

    try {
      const result = await buildProjectPreview({
        buildJobId: 'fast-taro-build',
        buildMode: 'fast',
        platform: 'mini_program',
        templateRoot,
        cleanupWorkspace: false,
        projectFiles: [
          {
            path: 'package.json',
            content: JSON.stringify({
              dependencies: {
                react: '^18.2.0',
                '@tarojs/taro': '4.2.0',
                '@tarojs/components': '4.2.0'
              }
            })
          },
          {
            path: 'src/pages/index/index.tsx',
            content: `
              import { View, Text } from '@tarojs/components';
              import Taro from '@tarojs/taro';
              export default function Index() {
                Taro.getSystemInfoSync();
                return <View data-ai-id="home.hero"><Text>小程序预览</Text></View>;
              }
            `
          },
          {
            path: 'ai-manifest.json',
            content: '{"version":1,"entries":[]}'
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace')
      });

      const previewHtml = await readFile(join(root, 'previews', 'fast-taro-build', 'index.html'), 'utf8');
      const taroArgs = await readFile(join(root, 'workspace', 'taro-args.txt'), 'utf8');
      await expect(access(join(root, 'workspace', 'pnpm-install-called'))).rejects.toThrow();
      expect(result.status).toBe('success');
      expect(previewHtml).toContain('taro h5 preview');
      expect(taroArgs).toContain('build --type h5');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects non-whitelisted imports before running a fast preview build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-import-test-'));
    const templateRoot = await createFastPreviewTemplate(root);
    let commandRan = false;

    try {
      const result = await buildProjectPreview({
        buildJobId: 'fast-import',
        buildMode: 'fast',
        templateRoot,
        projectFiles: [
          {
            path: 'src/App.tsx',
            content: "import debounce from 'lodash/debounce'; export function App() { return <main>{String(debounce)}</main>; }"
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace'),
        runCommand: async () => {
          commandRan = true;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });

      expect(commandRan).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorSummary).toContain('unsupported imports');
      expect(result.errorSummary).toContain('lodash');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects web-only imports in mini program fast preview builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-taro-import-test-'));
    const templateRoot = await createFastTaroPreviewTemplate(root);
    let commandRan = false;

    try {
      const result = await buildProjectPreview({
        buildJobId: 'fast-taro-import',
        buildMode: 'fast',
        platform: 'mini_program',
        templateRoot,
        projectFiles: [
          {
            path: 'src/pages/index/index.tsx',
            content: "import { Camera } from 'lucide-react'; export default function Index() { return <>{Camera}</>; }"
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace'),
        runCommand: async () => {
          commandRan = true;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });

      expect(commandRan).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorSummary).toContain('unsupported imports');
      expect(result.errorSummary).toContain('lucide-react');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects Taro JSX component imports from @tarojs/taro before compiling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-taro-component-import-test-'));
    const templateRoot = await createFastTaroPreviewTemplate(root);
    let commandRan = false;

    try {
      const result = await buildProjectPreview({
        buildJobId: 'fast-taro-component-import',
        buildMode: 'fast',
        platform: 'mini_program',
        templateRoot,
        projectFiles: [
          {
            path: 'src/pages/index/index.tsx',
            content: "import { View, Text } from '@tarojs/taro'; export default function Index() { return <View><Text>小程序预览</Text></View>; }"
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace'),
        runCommand: async () => {
          commandRan = true;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });

      expect(commandRan).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.errorSummary).toContain('Taro component imports');
      expect(result.errorSummary).toContain('@tarojs/components');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects dependency and lockfile changes in fast preview builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'atoms-fast-deps-test-'));
    const templateRoot = await createFastPreviewTemplate(root);

    try {
      const dependencyResult = await buildProjectPreview({
        buildJobId: 'fast-deps',
        buildMode: 'fast',
        templateRoot,
        projectFiles: [
          {
            path: 'package.json',
            content: JSON.stringify({ dependencies: { lodash: '^4.17.21' } })
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace-deps')
      });
      const lockfileResult = await buildProjectPreview({
        buildJobId: 'fast-lockfile',
        buildMode: 'fast',
        templateRoot,
        projectFiles: [
          {
            path: 'pnpm-lock.yaml',
            content: 'lockfileVersion: 9.0'
          }
        ],
        previewRoot: join(root, 'previews'),
        workspaceRoot: join(root, 'workspace-lock')
      });

      expect(dependencyResult.status).toBe('failed');
      expect(dependencyResult.errorSummary).toContain('unsupported dependency changes');
      expect(lockfileResult.status).toBe('failed');
      expect(lockfileResult.errorSummary).toContain('unsupported generated path');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createFastPreviewTemplate(root: string): Promise<string> {
  const templateRoot = join(root, 'template');
  await mkdir(join(templateRoot, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(templateRoot, 'src'), { recursive: true });
  await writeFile(
    join(templateRoot, 'package.json'),
    JSON.stringify({
      scripts: {
        'build:preview': 'vite build --mode preview --minify=false --sourcemap=false'
      },
      dependencies: {
        react: '^19.0.0'
      }
    }),
    'utf8'
  );
  await writeFile(join(templateRoot, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.tsx"></script>', 'utf8');
  await writeFile(join(templateRoot, 'tsconfig.json'), '{"compilerOptions":{"jsx":"react-jsx"}}', 'utf8');
  await writeFile(join(templateRoot, 'vite.config.ts'), 'export default {};', 'utf8');
  await writeFile(join(templateRoot, 'src', 'main.tsx'), 'import { App } from "./App"; console.log(App);', 'utf8');
  await writeFile(join(templateRoot, 'src', 'App.tsx'), 'export function App() { return <main />; }', 'utf8');
  await writeFile(join(templateRoot, 'ai-manifest.json'), '{"version":1,"entries":[]}', 'utf8');
  await writeFile(
    join(templateRoot, 'node_modules', '.bin', 'vite'),
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" > "$PWD/vite-args.txt"',
      'mkdir -p "$PWD/dist"',
      'printf "%s" "<main>fast preview</main>" > "$PWD/dist/index.html"'
    ].join('\n'),
    'utf8'
  );
  await chmod(join(templateRoot, 'node_modules', '.bin', 'vite'), 0o755);
  return templateRoot;
}

async function createFastTaroPreviewTemplate(root: string): Promise<string> {
  const templateRoot = join(root, 'taro-template');
  await mkdir(join(templateRoot, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(templateRoot, 'src', 'pages', 'index'), { recursive: true });
  await mkdir(join(templateRoot, 'config'), { recursive: true });
  await writeFile(
    join(templateRoot, 'package.json'),
    JSON.stringify({
      scripts: {
        'build:h5': 'taro build --type h5'
      },
      dependencies: {
        react: '^18.2.0',
        '@tarojs/taro': '4.2.0',
        '@tarojs/components': '4.2.0'
      }
    }),
    'utf8'
  );
  await writeFile(join(templateRoot, 'config', 'index.ts'), 'export default {};', 'utf8');
  await writeFile(join(templateRoot, 'project.config.json'), '{"projectname":"atoms-mini-program"}', 'utf8');
  await writeFile(join(templateRoot, 'src', 'index.html'), '<div id="app"></div>', 'utf8');
  await writeFile(join(templateRoot, 'src', 'app.tsx'), 'export default function App(props: { children?: unknown }) { return props.children; }', 'utf8');
  await writeFile(join(templateRoot, 'src', 'app.config.ts'), 'export default { pages: ["pages/index/index"] };', 'utf8');
  await writeFile(join(templateRoot, 'src', 'pages', 'index', 'index.tsx'), 'export default function Index() { return null; }', 'utf8');
  await writeFile(join(templateRoot, 'ai-manifest.json'), '{"version":1,"entries":[]}', 'utf8');
  await writeFile(
    join(templateRoot, 'node_modules', '.bin', 'taro'),
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" > "$PWD/taro-args.txt"',
      'mkdir -p "$PWD/dist"',
      'printf "%s" "<main>taro h5 preview</main>" > "$PWD/dist/index.html"'
    ].join('\n'),
    'utf8'
  );
  await chmod(join(templateRoot, 'node_modules', '.bin', 'taro'), 0o755);
  return templateRoot;
}
