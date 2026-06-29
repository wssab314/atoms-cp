import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodexTaskSpec } from '@atoms-cp/shared';
import {
  collectWorkspaceFiles,
  copyWorkspaceVersion,
  createWorkspaceFromTemplate,
  validateWorkspaceRelativePath
} from './workspaceService.js';

const roots: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'atoms-cp-workspace-test-'));
  roots.push(root);
  return root;
}

const taskSpec: CodexTaskSpec = {
  goal: 'Create a quiet dashboard.',
  appSpec: {
    appName: '销售数据看板',
    appGoal: '帮助运营团队查看销售趋势',
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
    dataModels: [],
    integrations: [],
    constraints: [],
    nonGoals: [],
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
    summary: 'Generate initial app.'
  },
  allowedPaths: ['src/**', 'index.html', 'ai-manifest.json'],
  forbiddenPaths: ['.env', 'node_modules/**', 'dist/**', '.git/**', '../**', '/**'],
  dependencyPolicy: 'forbid_new_dependencies',
  validationCommands: ['pnpm typecheck', 'pnpm build'],
  expectedOutputs: ['Vite app files', 'ai-manifest.json']
};

describe('workspaceService', () => {
  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('creates a controlled React/Vite workspace from a structured task spec', async () => {
    const root = await makeRoot();
    const workspacePath = join(root, 'project');
    await createWorkspaceFromTemplate({
      workspacePath,
      taskSpec
    });

    const app = await readFile(join(workspacePath, 'src', 'App.tsx'), 'utf8');
    const main = await readFile(join(workspacePath, 'src', 'main.tsx'), 'utf8');
    const inspector = await readFile(join(workspacePath, 'src', 'preview-inspector.ts'), 'utf8');
    const manifest = await readFile(join(workspacePath, 'ai-manifest.json'), 'utf8');
    const files = await collectWorkspaceFiles(workspacePath);

    expect(app).toContain('data-ai-id="home.hero.title"');
    expect(app).toContain('销售数据看板');
    expect(main).toContain("import './preview-inspector'");
    expect(inspector).toContain('INSPECTOR_ENABLE');
    expect(inspector).toContain('INSPECTOR_DISABLE');
    expect(inspector).toContain('INSPECTOR_HIGHLIGHT');
    expect(inspector).toContain("closest<HTMLElement>('[data-ai-id]')");
    expect(inspector).toContain('atoms-cp:preview-element-selected');
    expect(inspector).toContain('document.referrer');
    expect(inspector).toContain('event.source !== window.parent');
    expect(inspector).not.toContain('.value');
    expect(inspector).not.toContain("postMessage(messageForElement(element, 'INSPECTOR_SELECT'), '*')");
    expect(manifest).toContain('home.hero.title');
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(['index.html', 'src/App.tsx', 'src/main.tsx', 'src/preview-inspector.ts', 'ai-manifest.json'])
    );
    expect(files.every((file) => file.contentHash.length === 64)).toBe(true);
  });

  it('enforces workspace path allowlist, denylist, and dependency policy', () => {
    expect(validateWorkspaceRelativePath('src/App.tsx', taskSpec)).toEqual({ allowed: true });
    expect(validateWorkspaceRelativePath('package.json', taskSpec)).toMatchObject({ allowed: false });
    expect(validateWorkspaceRelativePath('package.json', {
      ...taskSpec,
      dependencyPolicy: 'allow_package_json_with_review'
    })).toEqual({ allowed: true });

    for (const unsafePath of ['.env', 'node_modules/react/index.js', 'dist/index.html', '.git/config', '../escape.ts', '/tmp/escape.ts']) {
      expect(validateWorkspaceRelativePath(unsafePath, taskSpec)).toMatchObject({ allowed: false });
    }
  });

  it('copies an existing workspace while ignoring generated and unsafe directories', async () => {
    const root = await makeRoot();
    const source = join(root, 'source');
    const target = join(root, 'target');
    await createWorkspaceFromTemplate({
      workspacePath: source,
      taskSpec
    });
    await mkdir(join(source, 'dist'), { recursive: true });
    await writeFile(join(source, 'dist', 'ignored.txt'), 'generated', 'utf8');
    await writeFile(join(source, 'src', 'local-note.ts'), 'export const note = true;\n', 'utf8');

    await copyWorkspaceVersion({
      sourcePath: source,
      targetPath: target
    });
    const files = await collectWorkspaceFiles(target);

    expect(files.some((file) => file.path.startsWith('dist/'))).toBe(false);
    expect(files.some((file) => file.path === 'src/App.tsx')).toBe(true);
  });
});
