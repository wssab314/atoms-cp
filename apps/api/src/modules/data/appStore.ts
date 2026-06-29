import type {
  AgentRun,
  AgentMessageRecord,
  AgentMessageStatus,
  AdminBuildJob,
  AdminOverview,
  AppSpec,
  AppSpecRecord,
  AiManifest,
  CreateProjectInput,
  BuildJobRecord,
  BuildLogRecord,
  ConnectorAccount,
  CodexTaskRecord,
  CodexTaskStatus,
  CodexTaskSpec,
  CodexTaskType,
  CreateBuildJobInput,
  DesignProfile,
  DesignProfileRecord,
  GeneratedFile,
  ModelInvocation,
  ModelRuntimeConfig,
  ProjectFileRecord,
  ProjectDetail,
  ProjectPublishState,
  ProjectStatus,
  ProjectVersionRecord,
  ProjectVersionSource,
  PreviewSnapshotRecord,
  PreviewSnapshotStatus,
  ProjectSummary,
  SupabaseConfigInput,
  SupabaseConfigRecord,
  SupabaseConnectionTestResult,
  TraceEventRecord,
  TraceEventType,
  TraceEventVisibility,
  UpdateProjectDeploymentInput,
  UpdateProjectInput,
  UserProfile,
  WorkspaceRecord,
  WorkspaceStatus
} from '@atoms-cp/shared';

export type StoreResult<T> = T | Promise<T>;

export interface AppStore {
  ensureUser(user: UserProfile): StoreResult<UserProfile>;
  getLocalAuthUserByEmail(email: string): StoreResult<{ user: UserProfile; passwordHash?: string } | undefined>;
  upsertLocalAuthUser(input: {
    email: string;
    name: string;
    passwordHash: string;
    role?: UserProfile['role'];
  }): StoreResult<UserProfile>;
  createAuthSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: string;
  }): StoreResult<void>;
  getAuthSession(tokenHash: string): StoreResult<{ user: UserProfile; expiresAt: string } | undefined>;
  deleteAuthSession(tokenHash: string): StoreResult<void>;
  getConnectorAccount(userId: string, connector: ConnectorAccount['connector']): StoreResult<ConnectorAccount | undefined>;
  upsertConnectorAccount(input: Omit<ConnectorAccount, 'id' | 'createdAt' | 'updatedAt'>): StoreResult<ConnectorAccount>;
  getProjectSupabaseConfig(projectId: string): StoreResult<SupabaseConfigRecord | undefined>;
  upsertProjectSupabaseConfig(
    projectId: string,
    input: SupabaseConfigInput & { serviceRoleKeyEncrypted?: string }
  ): StoreResult<SupabaseConfigRecord>;
  recordProjectSupabaseConnectionTest(
    projectId: string,
    result: SupabaseConnectionTestResult
  ): StoreResult<SupabaseConfigRecord | undefined>;
  confirmProjectSupabaseFrontendEnv(projectId: string): StoreResult<SupabaseConfigRecord | undefined>;
  listProjectSupabaseConfigs(): StoreResult<SupabaseConfigRecord[]>;
  listUsers(): StoreResult<UserProfile[]>;
  listProjectsForUser(user: UserProfile): StoreResult<ProjectSummary[]>;
  listAllProjects(): StoreResult<ProjectSummary[]>;
  createProject(user: UserProfile, input: CreateProjectInput): StoreResult<ProjectDetail>;
  getProjectById(user: UserProfile, projectId: string): StoreResult<ProjectDetail | undefined>;
  updateProject(user: UserProfile, projectId: string, input: UpdateProjectInput): StoreResult<ProjectDetail | undefined>;
  setProjectStatus(projectId: string, status: ProjectStatus): StoreResult<ProjectDetail | undefined>;
  createAgentRun(input: Omit<AgentRun, 'id' | 'createdAt' | 'updatedAt'>): StoreResult<AgentRun>;
  updateAgentRun(
    agentRunId: string,
    input: Partial<Pick<AgentRun, 'status' | 'outputSnapshot' | 'errorType' | 'errorMessage'>>
  ): StoreResult<AgentRun | undefined>;
  createAgentMessage(input: {
    projectId: string;
    userId: string;
    content: string;
    status: AgentMessageStatus;
    relatedTaskId?: string;
  }): StoreResult<AgentMessageRecord>;
  listAgentMessages(projectId: string, limit: number): StoreResult<AgentMessageRecord[]>;
  countDeferredAgentMessages(projectId: string): StoreResult<number>;
  getNextDeferredAgentMessage(projectId: string): StoreResult<AgentMessageRecord | undefined>;
  updateAgentMessage(
    messageId: string,
    input: Partial<Pick<AgentMessageRecord, 'status' | 'relatedTaskId'>>
  ): StoreResult<AgentMessageRecord | undefined>;
  updateAgentMessageByTask(
    taskId: string,
    input: Partial<Pick<AgentMessageRecord, 'status'>>
  ): StoreResult<AgentMessageRecord | undefined>;
  createModelInvocation(input: Omit<ModelInvocation, 'id' | 'createdAt'>): StoreResult<ModelInvocation>;
  createAppSpec(input: { projectId: string; sourceAgentRunId: string; spec: AppSpec }): StoreResult<AppSpecRecord>;
  updateLatestAppSpec(input: { projectId: string; spec: AppSpec }): StoreResult<AppSpecRecord | undefined>;
  confirmAppSpec(input: { projectId: string; specId: string }): StoreResult<AppSpecRecord | undefined>;
  getLatestAppSpec(projectId: string): StoreResult<AppSpecRecord | undefined>;
  createDesignProfiles(input: { projectId: string; specVersionId: string; profiles: DesignProfile[] }): StoreResult<DesignProfileRecord[]>;
  listDesignProfiles(projectId: string): StoreResult<DesignProfileRecord[]>;
  selectDesignProfile(projectId: string, designId: string): StoreResult<DesignProfileRecord | undefined>;
  getSelectedDesignProfile(projectId: string): StoreResult<DesignProfileRecord | undefined>;
  saveGeneratedProject(input: {
    projectId: string;
    source?: ProjectVersionSource;
    specVersionId?: string;
    designProfileId?: string;
    summary: string;
    files: GeneratedFile[];
    manifest: AiManifest;
    workspacePath?: string;
    parentVersionId?: string;
  }): StoreResult<{ projectVersion: ProjectVersionRecord; files: ProjectFileRecord[] }>;
  saveProjectFilePatch(input: {
    projectId: string;
    source: ProjectVersionSource;
    summary: string;
    files: GeneratedFile[];
    manifest?: AiManifest;
    workspacePath?: string;
    parentVersionId?: string;
  }): StoreResult<{ projectVersion: ProjectVersionRecord; files: ProjectFileRecord[] }>;
  listProjectFiles(projectId: string): StoreResult<ProjectFileRecord[]>;
  listProjectVersions(projectId: string): StoreResult<ProjectVersionRecord[]>;
  getProjectFile(projectId: string, path: string): StoreResult<ProjectFileRecord | undefined>;
  createBuildJob(projectId: string, input: CreateBuildJobInput): StoreResult<BuildJobRecord>;
  getBuildJob(projectId: string, buildJobId: string): StoreResult<BuildJobRecord | undefined>;
  getLatestBuildJob(projectId: string): StoreResult<BuildJobRecord | undefined>;
  listStaleBuildJobs(cutoffIso: string, limit: number): StoreResult<BuildJobRecord[]>;
  updateBuildJob(
    buildJobId: string,
    input: Partial<Pick<BuildJobRecord, 'status' | 'command' | 'previewUrl' | 'errorSummary' | 'startedAt' | 'finishedAt'>>
  ): StoreResult<BuildJobRecord | undefined>;
  createWorkspace(input: {
    projectId: string;
    projectVersionId?: string;
    path: string;
    status?: WorkspaceStatus;
  }): StoreResult<WorkspaceRecord>;
  listWorkspaces(projectId: string): StoreResult<WorkspaceRecord[]>;
  getWorkspace(workspaceId: string): StoreResult<WorkspaceRecord | undefined>;
  updateWorkspace(
    workspaceId: string,
    input: Partial<Pick<WorkspaceRecord, 'projectVersionId' | 'path' | 'status' | 'lockedBy' | 'errorSummary'>>
  ): StoreResult<WorkspaceRecord | undefined>;
  lockWorkspace(workspaceId: string, lockedBy: string): StoreResult<WorkspaceRecord | undefined>;
  unlockWorkspace(workspaceId: string): StoreResult<WorkspaceRecord | undefined>;
  createCodexTask(input: {
    projectId: string;
    projectVersionId?: string;
    workspaceId?: string;
    taskType: CodexTaskType;
    objective: string;
    inputSummary: string;
    taskSpec?: CodexTaskSpec;
    allowedPaths: string[];
    forbiddenPaths?: string[];
    validationCommands: string[];
  }): StoreResult<CodexTaskRecord>;
  listCodexTasks(projectId: string): StoreResult<CodexTaskRecord[]>;
  getCodexTask(taskId: string): StoreResult<CodexTaskRecord | undefined>;
  claimCodexTask(taskId: string, workerId: string): StoreResult<CodexTaskRecord | undefined>;
  claimNextCodexTask(workerId: string): StoreResult<CodexTaskRecord | undefined>;
  listStaleCodexTasks(cutoffIso: string, limit: number): StoreResult<CodexTaskRecord[]>;
  updateCodexTask(
    taskId: string,
    input: Partial<
      Pick<
        CodexTaskRecord,
        | 'status'
        | 'workspaceId'
        | 'projectVersionId'
        | 'claimedBy'
        | 'taskSpec'
        | 'attemptCount'
        | 'resultSummary'
        | 'errorSummary'
        | 'finishedAt'
      >
    > & { status?: CodexTaskStatus }
  ): StoreResult<CodexTaskRecord | undefined>;
  createPreviewSnapshot(input: {
    projectId: string;
    projectVersionId: string;
    buildJobId?: string;
    status: PreviewSnapshotStatus;
    path: string;
    url: string;
    active?: boolean;
    errorSummary?: string;
  }): StoreResult<PreviewSnapshotRecord>;
  listPreviewSnapshots(projectId: string): StoreResult<PreviewSnapshotRecord[]>;
  getLatestPreviewSnapshot(projectId: string): StoreResult<PreviewSnapshotRecord | undefined>;
  activatePreviewSnapshot(snapshotId: string): StoreResult<PreviewSnapshotRecord | undefined>;
  appendTraceEvent(input: {
    projectId: string;
    agentRunId?: string;
    codexTaskId?: string;
    buildJobId?: string;
    type: TraceEventType;
    visibility: TraceEventVisibility;
    message: string;
    payload?: Record<string, unknown>;
  }): StoreResult<TraceEventRecord>;
  listTraceEvents(projectId: string, limit: number): StoreResult<TraceEventRecord[]>;
  updateProjectDeploymentUrl(
    projectId: string,
    input: UpdateProjectDeploymentInput
  ): StoreResult<ProjectDetail | undefined>;
  updateProjectGitHubCommit(
    projectId: string,
    input: { repoFullName: string; commitSha: string }
  ): StoreResult<ProjectDetail | undefined>;
  getProjectPublishState(input: {
    project: ProjectDetail;
    latestBuildJob?: BuildJobRecord;
    currentVersionId?: string;
    activePreviewSnapshot?: PreviewSnapshotRecord;
    githubConfigured: boolean;
    supabaseConfigured: boolean;
    supabaseFrontendEnvConfirmed: boolean;
    supabaseLastConnectionStatus?: SupabaseConfigRecord['lastConnectionStatus'];
  }): StoreResult<ProjectPublishState>;
  appendBuildLog(input: Omit<BuildLogRecord, 'id' | 'createdAt'>): StoreResult<BuildLogRecord>;
  listBuildLogs(buildJobId: string): StoreResult<BuildLogRecord[]>;
  listRecentAgentRuns(limit: number): StoreResult<AgentRun[]>;
  listRecentModelInvocations(limit: number): StoreResult<ModelInvocation[]>;
  listRecentBuildJobs(limit: number): StoreResult<AdminBuildJob[]>;
  listRecentCodexTasks(limit: number): StoreResult<CodexTaskRecord[]>;
  listRecentPreviewSnapshots(limit: number): StoreResult<PreviewSnapshotRecord[]>;
  listRecentTraceEvents(limit: number): StoreResult<TraceEventRecord[]>;
  getEstimatedSpendCny(): StoreResult<number>;
  getAdminOverview(model: ModelRuntimeConfig): StoreResult<AdminOverview>;
  getRuntimeHealth(): StoreResult<{ database: string }>;
  close?(): Promise<void>;
}
