import { describe, expect, it } from 'vitest';
import { projectPublishStateSchema, updateProjectDeploymentInputSchema } from './publish.js';

describe('project publish contracts', () => {
  it('validates a release checklist with deployment metadata', () => {
    const state = projectPublishStateSchema.parse({
      projectId: 'project-1',
      currentVersionId: 'project-version-1',
      activePreviewSnapshotId: 'preview-snapshot-1',
      canPublish: true,
      blockingReasons: [],
      deploymentUrl: 'https://atoms-demo.vercel.app',
      githubCommitSha: 'a'.repeat(40),
      checklist: [
        {
          id: 'build',
          label: 'Cloud Preview',
          status: 'passed',
          detail: 'Latest build succeeded.'
        },
        {
          id: 'vercel',
          label: 'Vercel URL',
          status: 'passed',
          detail: 'Deployment URL saved.'
        }
      ]
    });

    expect(state.deploymentUrl).toBe('https://atoms-demo.vercel.app');
    expect(state.canPublish).toBe(true);
    expect(state.activePreviewSnapshotId).toBe('preview-snapshot-1');
    expect(state.checklist.map((item) => item.id)).toEqual(['build', 'vercel']);
  });

  it('only accepts http or https deployment URLs', () => {
    expect(updateProjectDeploymentInputSchema.parse({
      deploymentUrl: 'https://atoms-demo.vercel.app'
    }).deploymentUrl).toBe('https://atoms-demo.vercel.app');

    expect(() => updateProjectDeploymentInputSchema.parse({
      deploymentUrl: 'javascript:alert(1)'
    })).toThrow();
  });
});
