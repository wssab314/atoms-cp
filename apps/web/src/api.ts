export type ProjectStatus =
  | 'draft'
  | 'spec_generating'
  | 'spec_ready'
  | 'design_generating'
  | 'design_ready'
  | 'code_generating'
  | 'building'
  | 'preview_ready'
  | 'build_failed'
  | 'deployed';

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  target: 'web' | 'mini_program';
  deploymentUrl?: string;
  githubRepoFullName?: string;
  githubCommitSha?: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  ownerId: string;
  prompt: string;
  createdAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: 'creator' | 'admin';
}

export interface AppSpec {
  appName: string;
  appGoal: string;
  targetUser: string;
  pages: Array<{
    id: string;
    name: string;
    route: string;
    purpose: string;
    sections: Array<{
      id: string;
      kind: string;
      title: string;
      content: string;
    }>;
    actions: Array<{
      id: string;
      label: string;
      type: string;
    }>;
  }>;
  dataModels: Array<{
    name: string;
    fields: Array<{
      name: string;
      type: string;
      required: boolean;
    }>;
  }>;
  integrations: string[];
  styleIntent: {
    tone: string;
    primaryColor?: string;
    layoutDensity: 'compact' | 'comfortable' | 'spacious';
  };
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
}

export interface AppSpecRecord {
  id: string;
  projectId: string;
  sourceAgentRunId: string;
  version: number;
  status: 'draft' | 'validating' | 'validated' | 'rejected' | 'confirmed';
  spec: AppSpec;
  validationErrors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignProfile {
  id: string;
  name: string;
  description: string;
  bestFor: string;
  designTokens: {
    colors: {
      background: string;
      foreground: string;
      primary: string;
      secondary: string;
      muted: string;
      border: string;
      accent: string;
    };
    typography: {
      headingFont: string;
      bodyFont: string;
      scale: 'compact' | 'comfortable' | 'spacious';
    };
    radius: 'none' | 'sm' | 'md' | 'lg' | 'xl';
    shadow: 'none' | 'subtle' | 'medium';
    density: 'compact' | 'balanced' | 'airy';
  };
  layoutGuidelines: string[];
  componentGuidelines: string[];
  previewDescription: string;
}

export interface DesignProfileRecord {
  id: string;
  projectId: string;
  specVersionId: string;
  version: number;
  profile: DesignProfile;
  selected: boolean;
  createdAt: string;
}

export interface ProjectFileRecord {
  id: string;
  projectId: string;
  path: string;
  content: string;
  contentHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersionRecord {
  id: string;
  projectId: string;
  version: number;
  source: 'initial_generate' | 'selector_edit' | 'code_edit' | 'agent_patch' | 'rollback' | 'deploy';
  summary?: string;
  changedFiles: string[];
  specVersionId?: string;
  designProfileId?: string;
  workspacePath?: string;
  parentVersionId?: string;
  createdAt: string;
}

export interface AiManifest {
  entries: Record<string, {
    aiId: string;
    file: string;
    component: string;
    elementType: string;
    editable: Array<'text' | 'className' | 'styleTokens' | 'props'>;
    requirementId?: string;
  }>;
}

export interface AgentRunSummary {
  id: string;
  projectId: string;
  purpose: 'app_spec_generation' | 'app_spec_repair' | 'design_direction' | 'selector_patch';
  provider: 'deepseek' | 'volcengine';
  status: 'queued' | 'running' | 'waiting_for_model' | 'validating' | 'succeeded' | 'failed' | 'cancelled';
  errorType?: string;
  updatedAt: string;
}

export interface ModelInvocationSummary {
  id: string;
  projectId: string;
  agentRunId: string;
  provider: 'deepseek' | 'volcengine';
  model: string;
  purpose: 'app_spec_generation' | 'app_spec_repair' | 'design_direction' | 'selector_patch';
  status: 'skipped' | 'running' | 'succeeded' | 'failed';
  estimatedCostCny: number;
  errorType?: string;
  createdAt: string;
}

export interface BuildJobRecord {
  id: string;
  projectId: string;
  projectVersionId?: string;
  status: 'queued' | 'running' | 'success' | 'failed' | 'canceled';
  command?: string;
  previewUrl?: string;
  errorSummary?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface BuildLogRecord {
  id: string;
  buildJobId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  projectId: string;
  projectVersionId?: string;
  path: string;
  status: 'creating' | 'ready' | 'locked' | 'archived' | 'failed';
  lockedBy?: string;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodexTaskRecord {
  id: string;
  projectId: string;
  projectVersionId?: string;
  workspaceId?: string;
  taskType: 'initial_generate' | 'selector_patch' | 'qa_fix' | 'code_edit' | 'rollback';
  status: 'queued' | 'claimed' | 'preparing_workspace' | 'codex_running' | 'validating' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  objective: string;
  inputSummary: string;
  taskSpec?: unknown;
  allowedPaths: string[];
  forbiddenPaths: string[];
  validationCommands: string[];
  attemptCount?: number;
  claimedBy?: string;
  claimedAt?: string;
  resultSummary?: string;
  errorSummary?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PreviewSnapshotRecord {
  id: string;
  projectId: string;
  projectVersionId: string;
  buildJobId?: string;
  status: 'creating' | 'ready' | 'failed' | 'archived';
  path: string;
  url: string;
  active: boolean;
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type GenerationStage =
  | 'project_created'
  | 'organizing_requirements'
  | 'designing_direction'
  | 'queueing_app_build'
  | 'coding_app'
  | 'repairing_app'
  | 'building_preview'
  | 'preview_ready'
  | 'failed';

export interface ProjectGenerationStatus {
  projectId: string;
  projectStatus: ProjectStatus;
  stage: GenerationStage;
  running: boolean;
  canRetry: boolean;
  userMessage: string;
  errorMessage?: string;
  previewSnapshotId?: string;
  previewUrl?: string;
}

export interface StartProjectGenerationResult {
  accepted: true;
  alreadyRunning: boolean;
  status: ProjectGenerationStatus;
}

export interface TraceEventRecord {
  id: string;
  projectId: string;
  agentRunId?: string;
  codexTaskId?: string;
  buildJobId?: string;
  type:
    | 'agent_started'
    | 'agent_completed'
    | 'codex_task_created'
    | 'codex_task_progress'
    | 'codex_task_claimed'
    | 'codex_task_completed'
    | 'workspace_created'
    | 'workspace_locked'
    | 'workspace_copied'
    | 'selector_patch_created'
    | 'patch_applied'
    | 'build_queued'
    | 'patch_failed'
    | 'preview_snapshot_created'
    | 'preview_snapshot_activated'
    | 'version_rollback_created'
    | 'build_started'
    | 'build_completed'
    | 'error';
  visibility: 'user' | 'admin';
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentStreamEvent {
  id: string;
  kind: 'agent' | 'user' | 'status' | 'error';
  message: string;
  stage?: string;
  stepKey?: string;
  status?: 'start' | 'progress' | 'done' | 'failed';
  nextAction?: string;
  createdAt: string;
  snapshotUrl?: string;
}

export interface AgentMessageResult {
  accepted: true;
  queued: boolean;
  delivery: 'received' | 'queued' | 'deferred';
  queuePosition: number;
  message: string;
}

export interface AgentMessageRecord {
  id: string;
  projectId: string;
  userId: string;
  content: string;
  status: 'received' | 'deferred' | 'processing' | 'completed' | 'failed';
  relatedTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCodexTaskResult {
  workspace: WorkspaceRecord;
  codexTask: CodexTaskRecord;
  traceEvent: TraceEventRecord;
}

export interface AdminBuildJob {
  id: string;
  projectId: string;
  status: 'idle' | 'queued' | 'running' | 'building' | 'success' | 'succeeded' | 'failed' | 'canceled' | 'cancelled';
  command?: string;
  previewUrl?: string;
  errorSummary?: string;
  createdAt: string;
}

export interface AdminConnectorStatus {
  id: string;
  label: string;
  status: 'configured' | 'not_configured' | 'error' | 'unavailable';
  secretState: 'not_required' | 'configured' | 'missing';
  detail: string;
  projectsAffected?: number;
  lastCheckStatus?: 'passed' | 'failed' | 'blocked';
  lastCheckedAt?: string;
}

export interface AdminSystemConfigEntry {
  key: string;
  value: string;
  sensitive: boolean;
}

export interface AppSpecGenerationResult {
  appSpec: AppSpecRecord;
  agentRun: AgentRunSummary;
  modelInvocation: ModelInvocationSummary & {
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    budgetLimitCny: number;
  };
}

export interface DesignGenerationResult {
  profiles: DesignProfileRecord[];
}

export interface CodegenResult {
  summary: string;
  projectVersion: ProjectVersionRecord;
  files: ProjectFileRecord[];
  manifest: AiManifest;
  warnings: string[];
}

export interface PreviewSelection {
  aiId: string;
  text: string;
  className: string;
  tagName: string;
}

export interface DirectTextPatchResult {
  manifestEntry: AiManifest['entries'][string];
  projectVersion: ProjectVersionRecord;
  files: ProjectFileRecord[];
  buildJob: BuildJobRecord;
  traceEvent?: TraceEventRecord;
}

export interface AiSelectorPatchResult extends DirectTextPatchResult {
  agentRun: AgentRunSummary;
  modelInvocation: ModelInvocationSummary;
}

export interface ProjectVersionRollbackResult {
  projectVersion: ProjectVersionRecord;
  buildJob: BuildJobRecord;
  traceEvent: TraceEventRecord;
}

export interface PreviewSnapshotActivationResult {
  previewSnapshot: PreviewSnapshotRecord;
  traceEvent: TraceEventRecord;
}

export interface CreateProjectPayload {
  name: string;
  prompt: string;
  target?: 'web' | 'mini_program';
}

export interface AdminOverview {
  usersCount: number;
  projectsCount: number;
  buildJobsToday: number;
  failedBuildsToday: number;
  modelCallsToday: number;
  estimatedSpendCny: number;
  appSpecsCount: number;
  agentRunsCount: number;
  modelInvocationsCount: number;
  dataSource: 'memory' | 'postgres';
  modelProvider: 'deepseek' | 'volcengine';
  modelBudgetCny?: number;
  recentAgentRuns: AgentRunSummary[];
  recentModelInvocations: ModelInvocationSummary[];
}

export interface AdminOperations {
  dataSource: 'memory' | 'postgres';
  users: Array<{
    id: string;
    email: string;
    name?: string;
    role: 'creator' | 'admin';
  }>;
  projects: ProjectSummary[];
  buildJobs: AdminBuildJob[];
  agentRuns: AgentRunSummary[];
  modelInvocations: ModelInvocationSummary[];
  codexTasks: CodexTaskRecord[];
  previewSnapshots: PreviewSnapshotRecord[];
  traceEvents: TraceEventRecord[];
  runtimeSummary?: {
    activeCodexTasks: number;
    failedCodexTasks: number;
    activeBuildJobs: number;
    failedBuildJobs: number;
    readyPreviewSnapshots: number;
    activePreviewSnapshots: number;
    recoveredEvents: number;
    lastFailureSummary?: string;
  };
  connectors: AdminConnectorStatus[];
  systemConfig: AdminSystemConfigEntry[];
  modelUsage: {
    provider: 'deepseek' | 'volcengine';
    budgetCny?: number;
    estimatedSpendCny: number;
    modelCallsToday: number;
    invocationsCount: number;
  };
}

export interface PublishChecklistItem {
  id: 'build' | 'github' | 'env' | 'supabase' | 'vercel';
  label: string;
  status: 'passed' | 'pending' | 'blocked';
  detail: string;
}

export interface ProjectPublishState {
  projectId: string;
  currentVersionId?: string;
  activePreviewSnapshotId?: string;
  canPublish: boolean;
  blockingReasons: string[];
  deploymentUrl?: string;
  githubRepoFullName?: string;
  githubCommitSha?: string;
  manualVercelImportUrl?: string;
  checklist: PublishChecklistItem[];
}

export interface GitHubCommitFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
}

export interface GitHubCommitPlan {
  projectId: string;
  repoFullName: string;
  branch: string;
  message: string;
  projectVersionId?: string;
  requiresConfirmation: true;
  files: GitHubCommitFile[];
}

export interface GitHubCommitResult extends Omit<GitHubCommitPlan, 'requiresConfirmation'> {
  provider: 'github';
  commitSha: string;
  filesCommitted: number;
}

export interface GitHubConnectorStatus {
  configured: boolean;
  connected: boolean;
  externalUsername?: string;
  scopes: string[];
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl?: string;
}

export interface SupabaseProjectConfig {
  projectId: string;
  configured: boolean;
  supabaseUrl?: string;
  anonKeyConfigured: boolean;
  anonKeyMasked?: string;
  serviceRoleKeyConfigured: boolean;
  envReady: boolean;
  frontendEnvConfirmedAt?: string;
  lastConnectionStatus?: 'passed' | 'failed' | 'blocked';
  lastConnectionDetail?: string;
  lastConnectionHttpStatus?: number;
  lastConnectionCheckedAt?: string;
  updatedAt?: string;
}

export interface SupabaseSchemaSqlResponse {
  projectId: string;
  tables: string[];
  sql: string;
  warnings: string[];
}

export interface SupabaseConnectionTestResult {
  projectId: string;
  status: 'passed' | 'failed' | 'blocked';
  detail: string;
  httpStatus?: number;
  checkedAt: string;
}

export interface VercelEnvCheckResult {
  projectId: string;
  vercelProjectIdOrName: string;
  status: 'passed' | 'failed' | 'blocked';
  target: 'production';
  requiredKeys: string[];
  missingKeys: string[];
  detail: string;
  httpStatus?: number;
  checkedAt: string;
}

export function resolveApiBaseUrl(rawBaseUrl: string | undefined): string {
  return rawBaseUrl?.replace(/\/$/, '') ?? '';
}

export function buildApiUrl(path: string, rawBaseUrl = import.meta.env.VITE_API_BASE_URL): string {
  return `${resolveApiBaseUrl(rawBaseUrl)}${path}`;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiRequestError(`Request failed with status ${response.status}`, response.status, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function registerLocalUser(input: { email: string; password: string; name?: string }): Promise<UserProfile> {
  return requestJson<UserProfile>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function fetchAuthSettings(): Promise<{ registrationEnabled: boolean }> {
  return requestJson<{ registrationEnabled: boolean }>('/api/auth/settings');
}

export function loginLocalUser(input: { email: string; password: string }): Promise<UserProfile> {
  return requestJson<UserProfile>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function fetchCurrentUser(): Promise<UserProfile> {
  return requestJson<UserProfile>('/api/auth/me');
}

export function logoutLocalUser(): Promise<void> {
  return requestJson<void>('/api/auth/logout', {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function getProjectCodeDownloadUrl(projectId: string, versionId?: string): string {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  return buildApiUrl(`/api/projects/${projectId}/code/download${query}`);
}

export function fetchProjects(): Promise<ProjectSummary[]> {
  return requestJson<ProjectSummary[]>('/api/projects');
}

export function fetchProject(projectId: string): Promise<ProjectDetail> {
  return requestJson<ProjectDetail>(`/api/projects/${projectId}`);
}

export function createProject(payload: CreateProjectPayload): Promise<ProjectDetail> {
  return requestJson<ProjectDetail>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function startProjectGeneration(projectId: string): Promise<StartProjectGenerationResult> {
  return requestJson<StartProjectGenerationResult>(`/api/projects/${projectId}/generation-runs`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function fetchProjectGenerationStatus(projectId: string): Promise<ProjectGenerationStatus> {
  return requestJson<ProjectGenerationStatus>(`/api/projects/${projectId}/generation-status`);
}

export function generateProjectAppSpec(projectId: string): Promise<AppSpecGenerationResult> {
  return requestJson<AppSpecGenerationResult>(`/api/projects/${projectId}/spec/generate`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function updateLatestAppSpec(projectId: string, spec: AppSpec): Promise<AppSpecRecord> {
  return requestJson<AppSpecRecord>(`/api/projects/${projectId}/spec/latest`, {
    method: 'PUT',
    body: JSON.stringify({ spec })
  });
}

export function confirmAppSpec(projectId: string, specId: string): Promise<AppSpecRecord> {
  return requestJson<AppSpecRecord>(`/api/projects/${projectId}/spec/${specId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function generateDesignProfiles(projectId: string): Promise<DesignGenerationResult> {
  return requestJson<DesignGenerationResult>(`/api/projects/${projectId}/design/generate`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function selectDesignProfile(projectId: string, designId: string): Promise<DesignProfileRecord> {
  return requestJson<DesignProfileRecord>(`/api/projects/${projectId}/designs/${designId}/select`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function generateReactViteCode(projectId: string, designId: string): Promise<CodegenResult> {
  return requestJson<CodegenResult>(`/api/projects/${projectId}/codegen/react-vite`, {
    method: 'POST',
    body: JSON.stringify({
      designId
    })
  });
}

export function createBuildJob(projectId: string, projectVersionId?: string): Promise<BuildJobRecord> {
  return requestJson<BuildJobRecord>(`/api/projects/${projectId}/builds`, {
    method: 'POST',
    body: JSON.stringify({
      projectVersionId
    })
  });
}

export function fetchBuildJob(projectId: string, buildJobId: string): Promise<BuildJobRecord> {
  return requestJson<BuildJobRecord>(`/api/projects/${projectId}/builds/${buildJobId}`, {
    method: 'GET'
  });
}

export function fetchBuildLogs(projectId: string, buildJobId: string): Promise<BuildLogRecord[]> {
  return requestJson<BuildLogRecord[]>(`/api/projects/${projectId}/builds/${buildJobId}/logs`, {
    method: 'GET'
  });
}

export function createCodexTask(projectId: string): Promise<CreateCodexTaskResult> {
  return requestJson<CreateCodexTaskResult>(`/api/projects/${projectId}/codex-tasks`, {
    method: 'POST',
    body: JSON.stringify({
      taskType: 'initial_generate'
    })
  });
}

export function fetchCodexTasks(projectId: string): Promise<CodexTaskRecord[]> {
  return requestJson<CodexTaskRecord[]>(`/api/projects/${projectId}/codex-tasks`);
}

export function fetchProjectWorkspaces(projectId: string): Promise<WorkspaceRecord[]> {
  return requestJson<WorkspaceRecord[]>(`/api/projects/${projectId}/workspaces`);
}

export function fetchPreviewSnapshots(projectId: string): Promise<PreviewSnapshotRecord[]> {
  return requestJson<PreviewSnapshotRecord[]>(`/api/projects/${projectId}/preview-snapshots`);
}

export function fetchTraceEvents(projectId: string, limit = 50): Promise<TraceEventRecord[]> {
  return requestJson<TraceEventRecord[]>(`/api/projects/${projectId}/trace-events?limit=${limit}`);
}

export function getAgentStreamUrl(projectId: string): string {
  return buildApiUrl(`/api/projects/${projectId}/agent-stream`);
}

export function sendAgentMessage(projectId: string, content: string): Promise<AgentMessageResult> {
  return requestJson<AgentMessageResult>(`/api/projects/${projectId}/agent-messages`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });
}

export function fetchAgentMessages(projectId: string): Promise<AgentMessageRecord[]> {
  return requestJson<AgentMessageRecord[]>(`/api/projects/${projectId}/agent-messages`);
}

export function fetchProjectPublishState(projectId: string): Promise<ProjectPublishState> {
  return requestJson<ProjectPublishState>(`/api/projects/${projectId}/publish`);
}

export function createGitHubCommit(
  projectId: string,
  payload: {
    repoFullName: string;
    branch: string;
    message: string;
    projectVersionId?: string;
    confirmed: boolean;
  }
): Promise<GitHubCommitPlan | GitHubCommitResult> {
  return requestJson<GitHubCommitPlan | GitHubCommitResult>(`/api/projects/${projectId}/github/commit`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function fetchGitHubConnectorStatus(): Promise<GitHubConnectorStatus> {
  return requestJson<GitHubConnectorStatus>('/api/connectors/github/status');
}

export function startGitHubOAuth(returnTo = '/app/new'): Promise<{ authorizationUrl: string }> {
  return requestJson<{ authorizationUrl: string }>(`/api/connectors/github/oauth/start?returnTo=${encodeURIComponent(returnTo)}`);
}

export function fetchGitHubRepositories(): Promise<GitHubRepository[]> {
  return requestJson<GitHubRepository[]>('/api/connectors/github/repos');
}

export function createGitHubRepository(payload: {
  name: string;
  private: boolean;
  description?: string;
}): Promise<GitHubRepository> {
  return requestJson<GitHubRepository>('/api/connectors/github/repos', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function saveProjectDeploymentUrl(projectId: string, deploymentUrl: string): Promise<ProjectPublishState> {
  return requestJson<ProjectPublishState>(`/api/projects/${projectId}/publish/deployment-url`, {
    method: 'PUT',
    body: JSON.stringify({
      deploymentUrl
    })
  });
}

export function fetchSupabaseConfig(projectId: string): Promise<SupabaseProjectConfig> {
  return requestJson<SupabaseProjectConfig>(`/api/projects/${projectId}/supabase/config`);
}

export function saveSupabaseConfig(
  projectId: string,
  payload: {
    supabaseUrl: string;
    anonKey: string;
    serviceRoleKey?: string;
  }
): Promise<SupabaseProjectConfig> {
  return requestJson<SupabaseProjectConfig>(`/api/projects/${projectId}/supabase/config`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

export function testSupabaseConnection(projectId: string): Promise<SupabaseConnectionTestResult> {
  return requestJson<SupabaseConnectionTestResult>(`/api/projects/${projectId}/supabase/test`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function confirmSupabaseFrontendEnv(projectId: string): Promise<SupabaseProjectConfig> {
  return requestJson<SupabaseProjectConfig>(`/api/projects/${projectId}/supabase/frontend-env`, {
    method: 'PUT',
    body: JSON.stringify({
      confirmed: true
    })
  });
}

export function fetchSupabaseSchemaSql(projectId: string): Promise<SupabaseSchemaSqlResponse> {
  return requestJson<SupabaseSchemaSqlResponse>(`/api/projects/${projectId}/supabase/schema-sql`);
}

export function checkVercelEnv(projectId: string, vercelProjectIdOrName: string): Promise<VercelEnvCheckResult> {
  return requestJson<VercelEnvCheckResult>(`/api/projects/${projectId}/vercel/env/check`, {
    method: 'POST',
    body: JSON.stringify({
      vercelProjectIdOrName
    })
  });
}

export interface ProjectManifest {
  projectId: string;
  projectVersionId?: string;
  manifest: AiManifest;
  entries: any[];
}

export function fetchProjectManifest(projectId: string): Promise<ProjectManifest> {
  return requestJson<ProjectManifest>(`/api/projects/${projectId}/manifest`);
}

export function fetchProjectVersions(projectId: string): Promise<ProjectVersionRecord[]> {
  return requestJson<ProjectVersionRecord[]>(`/api/projects/${projectId}/versions`);
}

export function rollbackProjectVersion(projectId: string, versionId: string): Promise<ProjectVersionRollbackResult> {
  return requestJson<ProjectVersionRollbackResult>(`/api/projects/${projectId}/versions/${versionId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function activatePreviewSnapshot(projectId: string, snapshotId: string): Promise<PreviewSnapshotActivationResult> {
  return requestJson<PreviewSnapshotActivationResult>(`/api/projects/${projectId}/preview-snapshots/${snapshotId}/activate`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function patchSelectorText(projectId: string, input: { aiId: string; text: string }): Promise<DirectTextPatchResult> {
  return requestJson<DirectTextPatchResult>(`/api/projects/${projectId}/selector/text-patch`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function patchSelectorAI(projectId: string, input: { aiId: string; instruction: string; selectedText?: string }): Promise<AiSelectorPatchResult> {
  return requestJson<AiSelectorPatchResult>(`/api/projects/${projectId}/selector/ai-patch`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function patchProjectText(projectId: string, aiId: string, text: string): Promise<DirectTextPatchResult> {
  return patchSelectorText(projectId, { aiId, text });
}

export function patchProjectWithAi(
  projectId: string,
  aiId: string,
  instruction: string,
  selectedText?: string
): Promise<AiSelectorPatchResult> {
  return patchSelectorAI(projectId, { aiId, instruction, selectedText });
}

export function fetchAdminOverview(): Promise<AdminOverview> {
  return requestJson<AdminOverview>('/api/admin/overview');
}

export function fetchAdminOperations(): Promise<AdminOperations> {
  return requestJson<AdminOperations>('/api/admin/operations');
}
