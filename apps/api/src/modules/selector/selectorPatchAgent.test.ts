import { describe, expect, it } from 'vitest';
import type { AiManifest, ProjectDetail } from '@atoms-cp/shared';
import { createInMemoryStore } from '../data/inMemoryStore.js';
import { generateSelectorPatch, SelectorPatchError } from './selectorPatchAgent.js';

const manifest: AiManifest = {
  entries: {
    'home.actions.book': {
      aiId: 'home.actions.book',
      file: 'src/App.tsx',
      component: 'GeneratedAction',
      elementType: 'button',
      editable: ['text', 'className', 'styleTokens', 'props']
    },
    'home.hero': {
      aiId: 'home.hero',
      file: 'src/App.tsx',
      component: 'GeneratedSection',
      elementType: 'section',
      editable: ['className', 'styleTokens']
    }
  }
};

async function createProjectWithFiles(): Promise<{
  project: ProjectDetail;
  store: ReturnType<typeof createInMemoryStore>;
}> {
  const store = createInMemoryStore(() => new Date('2026-06-27T00:00:00.000Z'));
  const project = await store.createProject(
    {
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    },
    {
      name: 'Selector Patch 项目',
      prompt: '生成一个课程预约应用',
      target: 'web'
    }
  );

  await store.saveGeneratedProject({
    projectId: project.id,
    summary: 'Generated files',
    files: [
      {
        path: 'src/App.tsx',
        content: '<button data-ai-id="home.actions.book">{"提交预约"}</button>',
        purpose: 'Application UI'
      },
      {
        path: 'ai-manifest.json',
        content: `${JSON.stringify(manifest, null, 2)}\n`,
        purpose: 'AI manifest'
      }
    ],
    manifest
  });

  return { project, store };
}

describe('generateSelectorPatch', () => {
  it('uses a schema-limited model plan to create an agent_patch version', async () => {
    const { project, store } = await createProjectWithFiles();

    const result = await generateSelectorPatch({
      project,
      aiId: 'home.actions.book',
      instruction: '把按钮改成“马上预约”',
      selectedText: '提交预约',
      model: {
        provider: 'volcengine',
        apiKeyConfigured: true,
        model: 'doubao-seed-2-1-turbo-260628',
        budgetCny: 25
      },
      modelClient: {
        async generateText() {
          return {
            text: JSON.stringify({
              operation: 'replace_text',
              text: '马上预约'
            }),
            model: 'doubao-seed-2-1-turbo-260628',
            usage: {
              inputTokens: 12,
              outputTokens: 4
            }
          };
        }
      },
      store
    });

    expect(result.projectVersion).toMatchObject({
      projectId: project.id,
      version: 2,
      source: 'agent_patch',
      changedFiles: ['src/App.tsx']
    });
    expect(result.files[0]?.content).toContain('{"马上预约"}');
    expect(result.agentRun).toMatchObject({
      purpose: 'selector_patch',
      status: 'succeeded'
    });
    expect(result.modelInvocation).toMatchObject({
      purpose: 'selector_patch',
      status: 'succeeded',
      inputTokens: 12,
      outputTokens: 4
    });
  });

  it('marks the AgentRun failed when the model returns invalid JSON', async () => {
    const { project, store } = await createProjectWithFiles();

    await expect(
      generateSelectorPatch({
        project,
        aiId: 'home.actions.book',
        instruction: '改得更有行动感',
        model: {
          provider: 'volcengine',
          apiKeyConfigured: true,
          model: 'doubao-seed-2-1-turbo-260628',
          budgetCny: 25
        },
        modelClient: {
          async generateText() {
            return {
              text: 'not json',
              model: 'doubao-seed-2-1-turbo-260628',
              usage: {
                inputTokens: 1,
                outputTokens: 1
              }
            };
          }
        },
        store
      })
    ).rejects.toBeInstanceOf(SelectorPatchError);

    const runs = await store.listRecentAgentRuns(1);
    expect(runs[0]).toMatchObject({
      purpose: 'selector_patch',
      status: 'failed',
      errorType: 'MODEL_INVALID_JSON'
    });
  });
});
