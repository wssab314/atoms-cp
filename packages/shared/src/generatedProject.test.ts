import { describe, expect, it } from 'vitest';
import {
  aiSelectorPatchInputSchema,
  aiSelectorPatchPlanSchema,
  codegenOutputSchema,
  directTextPatchInputSchema,
  inspectorElementSnapshotSchema,
  projectManifestResponseSchema,
  projectFileRecordSchema,
  projectVersionSourceSchema,
  projectVersionListResponseSchema,
  projectVersionRecordSchema
} from './generatedProject.js';

describe('Generated project schemas', () => {
  it('accepts generated React/Vite files, manifest, and version metadata', () => {
    const parsed = codegenOutputSchema.parse({
      summary: 'Generated a React/Vite project.',
      files: [
        {
          path: 'src/App.tsx',
          content: '<main data-ai-id="home.hero.title" />',
          purpose: 'Application shell'
        },
        {
          path: 'ai-manifest.json',
          content: '{"entries":{}}',
          purpose: 'AI editable element manifest'
        }
      ],
      manifest: {
        entries: {
          'home.hero.title': {
            aiId: 'home.hero.title',
            file: 'src/App.tsx',
            component: 'GeneratedApp',
            elementType: 'heading',
            editable: ['text']
          }
        }
      },
      buildCommand: 'pnpm build',
      installCommand: 'pnpm install',
      warnings: []
    });

    expect(parsed.files.map((file) => file.path)).toContain('ai-manifest.json');
    expect(parsed.manifest.entries['home.hero.title']?.editable).toEqual(['text']);
  });

  it('accepts stored file and project version records', () => {
    const file = projectFileRecordSchema.parse({
      id: 'file-1',
      projectId: 'project-1',
      path: 'src/App.tsx',
      content: 'export function App() { return null }',
      contentHash: 'hash',
      version: 1,
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z'
    });
    const version = projectVersionRecordSchema.parse({
      id: 'project-version-1',
      projectId: 'project-1',
      version: 1,
      source: 'initial_generate',
      summary: 'Initial files generated',
      changedFiles: ['src/App.tsx'],
      createdAt: '2026-06-27T00:00:00.000Z'
    });

    expect(file.version).toBe(1);
    expect(version.changedFiles).toEqual(['src/App.tsx']);
  });

  it('validates direct text patch inputs for selector editing', () => {
    expect(
      directTextPatchInputSchema.parse({
        aiId: 'home.actions.submit-booking',
        text: '立即预约'
      })
    ).toEqual({
      aiId: 'home.actions.submit-booking',
      text: '立即预约'
    });

    expect(() =>
      directTextPatchInputSchema.parse({
        aiId: 'home.actions.submit-booking',
        text: ''
      })
    ).toThrow();
    expect(() =>
      directTextPatchInputSchema.parse({
        aiId: 'home.actions.submit-booking',
        text: 'x'.repeat(121)
      })
    ).toThrow();
  });

  it('validates AI selector patch inputs and model plans', () => {
    expect(
      aiSelectorPatchInputSchema.parse({
        aiId: 'home.actions.submit-booking',
        instruction: '把按钮文案改得更有行动感'
      })
    ).toEqual({
      aiId: 'home.actions.submit-booking',
      instruction: '把按钮文案改得更有行动感'
    });
    expect(
      aiSelectorPatchPlanSchema.parse({
        operation: 'replace_text',
        text: '立即预约'
      })
    ).toEqual({
      operation: 'replace_text',
      text: '立即预约'
    });
    expect(
      aiSelectorPatchPlanSchema.parse({
        operation: 'update_style',
        instruction: '让标题更醒目，使用更大的字号。'
      })
    ).toEqual({
      operation: 'update_style',
      instruction: '让标题更醒目，使用更大的字号。'
    });
    expect(projectVersionSourceSchema.parse('repair')).toBe('repair');

    expect(() =>
      aiSelectorPatchInputSchema.parse({
        aiId: 'home.actions.submit-booking',
        instruction: ''
      })
    ).toThrow();
    expect(() =>
      aiSelectorPatchPlanSchema.parse({
        operation: 'replace_text',
        text: ''
      })
    ).toThrow();
  });

  it('validates inspector element snapshots without sensitive input values', () => {
    const snapshot = inspectorElementSnapshotSchema.parse({
      type: 'INSPECTOR_SELECT',
      aiId: 'home.hero.title',
      tagName: 'H1',
      text: '销售数据看板',
      className: 'hero-title'
    });

    expect(snapshot).toEqual({
      type: 'INSPECTOR_SELECT',
      aiId: 'home.hero.title',
      tagName: 'H1',
      text: '销售数据看板',
      className: 'hero-title'
    });
    expect(() =>
      inspectorElementSnapshotSchema.parse({
        type: 'INSPECTOR_SELECT',
        aiId: 'home.hero.title',
        tagName: 'INPUT',
        value: 'secret'
      })
    ).toThrow();
  });

  it('validates manifest and version list API response contracts', () => {
    const version = projectVersionRecordSchema.parse({
      id: 'project-version-1',
      projectId: 'project-1',
      version: 2,
      source: 'selector_edit',
      summary: 'Updated hero title',
      changedFiles: ['src/App.tsx'],
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-2',
      parentVersionId: 'project-version-0',
      createdAt: '2026-06-28T00:00:00.000Z'
    });

    expect(
      projectManifestResponseSchema.parse({
        projectId: 'project-1',
        projectVersionId: version.id,
        manifest: {
          entries: {
            'home.hero.title': {
              aiId: 'home.hero.title',
              file: 'src/App.tsx',
              component: 'GeneratedApp',
              elementType: 'heading',
              editable: ['text']
            }
          }
        },
        entries: [
          {
            aiId: 'home.hero.title',
            file: 'src/App.tsx',
            component: 'GeneratedApp',
            elementType: 'heading',
            editable: ['text']
          }
        ]
      }).entries
    ).toHaveLength(1);

    expect(projectVersionListResponseSchema.parse({ versions: [version] }).versions[0]?.workspacePath).toBe(
      '/tmp/atoms-cp-workspaces/project-1/version-2'
    );
  });
});
