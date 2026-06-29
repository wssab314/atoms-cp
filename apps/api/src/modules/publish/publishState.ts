import {
  projectPublishStateSchema,
  type BuildJobRecord,
  type ProjectDetail,
  type ProjectPublishState,
  type PreviewSnapshotRecord
} from '@atoms-cp/shared';

interface CreateProjectPublishStateInput {
  project: ProjectDetail;
  latestBuildJob?: BuildJobRecord;
  currentVersionId?: string;
  activePreviewSnapshot?: PreviewSnapshotRecord;
  githubConfigured: boolean;
  supabaseConfigured: boolean;
  supabaseFrontendEnvConfirmed: boolean;
  supabaseLastConnectionStatus?: 'passed' | 'failed' | 'blocked';
}

export function createProjectPublishState(input: CreateProjectPublishStateInput): ProjectPublishState {
  const activeReadySnapshot = input.activePreviewSnapshot?.status === 'ready' && input.activePreviewSnapshot.active
    ? input.activePreviewSnapshot
    : undefined;
  const buildPassed = Boolean(activeReadySnapshot);
  const githubReady = Boolean(input.project.githubRepoFullName || input.githubConfigured);
  const githubCommitted = Boolean(input.project.githubCommitSha);
  const vercelReady = Boolean(input.project.deploymentUrl);
  const checklist = [
    {
      id: 'build' as const,
      label: 'Cloud Preview',
      status: buildPassed ? 'passed' as const : 'blocked' as const,
      detail: buildPassed
        ? 'Active preview snapshot is ready.'
        : input.latestBuildJob
          ? 'Create an active ready preview snapshot before release.'
          : 'Generate files and run a successful cloud preview build first.'
    },
    {
      id: 'github' as const,
      label: 'GitHub handoff',
      status: githubCommitted ? 'passed' as const : githubReady ? 'pending' as const : 'blocked' as const,
      detail: githubCommitted
        ? `Committed at ${input.project.githubCommitSha}.`
        : githubReady
          ? 'GitHub connector is available; commit confirmation is still required.'
          : 'Connect GitHub before committing project files.'
    },
    {
      id: 'env' as const,
      label: 'Environment',
      status: input.supabaseConfigured
        ? input.supabaseFrontendEnvConfirmed
          ? 'passed' as const
          : 'blocked' as const
        : 'passed' as const,
      detail: input.supabaseConfigured
        ? input.supabaseFrontendEnvConfirmed
          ? 'Deploy target has confirmed VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
          : 'Confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deploy target before marking deployed.'
        : 'No frontend secrets are required for the generated static preview.'
    },
    {
      id: 'supabase' as const,
      label: 'Supabase',
      status: input.supabaseConfigured
        ? input.supabaseLastConnectionStatus === 'passed'
          ? 'passed' as const
          : 'blocked' as const
        : 'pending' as const,
      detail: input.supabaseConfigured
        ? input.supabaseLastConnectionStatus === 'passed'
          ? 'Project Supabase URL and anon key passed a live REST check; service role stays in backend vault.'
          : input.supabaseLastConnectionStatus === 'failed'
            ? 'Run a passing Supabase live connection test before release.'
            : 'Run the Supabase live connection test before release.'
        : 'Configure Supabase if this app needs generated data tables.'
    },
    {
      id: 'vercel' as const,
      label: 'Vercel URL',
      status: vercelReady ? 'passed' as const : buildPassed ? 'pending' as const : 'blocked' as const,
      detail: vercelReady
        ? 'Deployment URL saved on the project.'
        : buildPassed
          ? 'Import the GitHub repo into Vercel, then save the deployment URL.'
          : 'A ready preview snapshot is required before recording deployment.'
    }
  ];
  const blockingReasons = checklist
    .filter((item) => item.status === 'blocked')
    .map((item) => item.detail);

  return projectPublishStateSchema.parse({
    projectId: input.project.id,
    currentVersionId: input.currentVersionId,
    activePreviewSnapshotId: activeReadySnapshot?.id,
    canPublish: blockingReasons.length === 0,
    blockingReasons,
    deploymentUrl: input.project.deploymentUrl,
    githubRepoFullName: input.project.githubRepoFullName,
    githubCommitSha: input.project.githubCommitSha,
    manualVercelImportUrl: input.project.githubRepoFullName
      ? `https://vercel.com/new/clone?repository-url=${encodeURIComponent(`https://github.com/${input.project.githubRepoFullName}`)}`
      : undefined,
    checklist
  });
}
