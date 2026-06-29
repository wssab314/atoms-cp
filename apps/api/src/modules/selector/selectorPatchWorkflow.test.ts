import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiManifest } from '@atoms-cp/shared';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { applySelectorTextPatch } from './selectorPatchWorkflow.js';

const manifest: AiManifest = {
  entries: {
    'home.hero.title': {
      aiId: 'home.hero.title',
      file: 'src/App.tsx',
      component: 'GeneratedApp',
      elementType: 'heading',
      editable: ['text']
    }
  }
};

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots = [];
});

async function createTempRoot(name: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `atoms-cp-${name}-`));
  tempRoots.push(path);
  return path;
}

describe('applySelectorTextPatch', () => {
  it('copies the latest workspace, applies a direct text patch, saves a new version, and queues a build', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const sourceWorkspace = await createTempRoot('selector-source');
    const workspaceRoot = await createTempRoot('selector-root');
    await mkdir(join(sourceWorkspace, 'src'), { recursive: true });
    await writeFile(
      join(sourceWorkspace, 'src/App.tsx'),
      '<main><h1 data-ai-id="home.hero.title">{"旧标题"}</h1></main>',
      'utf8'
    );
    await writeFile(join(sourceWorkspace, 'ai-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const initial = await store.saveGeneratedProject({
      projectId: 'project-1',
      summary: 'Initial app',
      workspacePath: sourceWorkspace,
      files: [
        {
          path: 'src/App.tsx',
          content: '<main><h1 data-ai-id="home.hero.title">{"旧标题"}</h1></main>',
          purpose: 'App shell'
        },
        {
          path: 'ai-manifest.json',
          content: `${JSON.stringify(manifest, null, 2)}\n`,
          purpose: 'Manifest'
        }
      ],
      manifest
    });

    const result = await applySelectorTextPatch({
      store,
      projectId: 'project-1',
      aiId: 'home.hero.title',
      text: '新标题',
      source: 'selector_edit',
      summary: 'Updated hero title',
      purpose: 'Selector text patch',
      workspaceRoot
    });

    expect(result.projectVersion).toMatchObject({
      version: 2,
      source: 'selector_edit',
      changedFiles: ['src/App.tsx'],
      parentVersionId: initial.projectVersion.id
    });
    expect(result.projectVersion.workspacePath).toBeDefined();
    expect(result.buildJob).toMatchObject({
      projectId: 'project-1',
      projectVersionId: result.projectVersion.id,
      status: 'queued'
    });
    expect(await readFile(join(sourceWorkspace, 'src/App.tsx'), 'utf8')).toContain('{"旧标题"}');
    expect(await readFile(join(result.projectVersion.workspacePath!, 'src/App.tsx'), 'utf8')).toContain(
      'data-ai-id="home.hero.title">{"新标题"}'
    );
    expect(result.files[0]?.content).toContain('data-ai-id="home.hero.title">{"新标题"}');
    expect((await store.listTraceEvents('project-1', 10))
      .filter((event) => event.visibility === 'admin')
      .map((event) => event.type)).toEqual([
      'build_queued',
      'patch_applied',
      'workspace_copied',
      'selector_patch_created'
    ]);
    expect((await store.listTraceEvents('project-1', 10))
      .some((event) => event.visibility === 'user' && event.message.includes('预览快照'))).toBe(true);
  });

  it('rejects unsafe manifest target paths before writing a new version', async () => {
    const store = createInMemoryStore(() => new Date('2026-06-28T00:00:00.000Z'));
    const workspaceRoot = await createTempRoot('selector-root');
    const unsafeManifest: AiManifest = {
      entries: {
        'home.hero.title': {
          ...manifest.entries['home.hero.title']!,
          file: '../outside.tsx'
        }
      }
    };
    await store.saveGeneratedProject({
      projectId: 'project-1',
      summary: 'Initial app',
      files: [
        {
          path: 'ai-manifest.json',
          content: `${JSON.stringify(unsafeManifest, null, 2)}\n`,
          purpose: 'Manifest'
        }
      ],
      manifest: unsafeManifest
    });

    await expect(
      applySelectorTextPatch({
        store,
        projectId: 'project-1',
        aiId: 'home.hero.title',
        text: '新标题',
        source: 'selector_edit',
        summary: 'Updated hero title',
        purpose: 'Selector text patch',
        workspaceRoot
      })
    ).rejects.toThrow(/not patchable/i);

    expect(await store.listProjectVersions('project-1')).toHaveLength(1);
    expect((await store.listTraceEvents('project-1', 10))[0]?.type).toBe('patch_failed');
  });
});
