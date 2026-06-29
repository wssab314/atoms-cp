import { createHash } from 'node:crypto';
import {
  agentRunSchema,
  agentMessageRecordSchema,
  adminBuildJobSchema,
  adminOverviewSchema,
  appSpecRecordSchema,
  buildJobRecordSchema,
  buildLogRecordSchema,
  codexTaskRecordSchema,
  connectorAccountSchema,
  designProfileRecordSchema,
  previewSnapshotRecordSchema,
  projectFileRecordSchema,
  projectVersionRecordSchema,
  modelInvocationSchema,
  projectDetailSchema,
  projectSummarySchema,
  supabaseConfigRecordSchema,
  traceEventRecordSchema,
  userProfileSchema,
  workspaceRecordSchema,
  type AgentRun,
  type AgentMessageRecord,
  type AdminBuildJob,
  type AdminOverview,
  type AppSpec,
  type AppSpecRecord,
  type BuildJobRecord,
  type BuildLogRecord,
  type CodexTaskRecord,
  type ConnectorAccount,
  type DesignProfileRecord,
  type CreateProjectInput,
  type ProjectFileRecord,
  type ModelRuntimeConfig,
  type ModelInvocation,
  type ProjectVersionRecord,
  type PreviewSnapshotRecord,
  type ProjectDetail,
  type ProjectPublishState,
  type ProjectStatus,
  type ProjectSummary,
  type SupabaseConfigRecord,
  type TraceEventRecord,
  type UpdateProjectDeploymentInput,
  type UpdateProjectInput,
  type UserProfile,
  type WorkspaceRecord
} from '@atoms-cp/shared';
import type { AppStore } from './appStore.js';
import { createProjectPublishState } from '../publish/publishState.js';

export type InMemoryStore = AppStore;

const seededUsers = [
  userProfileSchema.parse({
    id: 'user-creator',
    email: 'creator@example.local',
    name: 'Creator',
    role: 'creator'
  }),
  userProfileSchema.parse({
    id: 'user-admin',
    email: 'admin@example.local',
    name: 'Admin',
    role: 'admin'
  })
];

const seededProjects = [
  projectDetailSchema.parse({
    id: 'demo-fitness',
    ownerId: 'user-creator',
    name: '私教预约系统',
    prompt: '帮我做一个私教预约 Web 应用。用户可以查看教练、选择课程、提交预约。',
    status: 'preview_ready',
    target: 'web',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z'
  }),
  projectDetailSchema.parse({
    id: 'demo-research',
    ownerId: 'user-creator',
    name: '自选股研究 Dashboard',
    prompt: '生成一个自选股研究 Dashboard，可以查看指标、整理研究结论。',
    status: 'spec_ready',
    target: 'web',
    createdAt: '2026-06-27T00:00:00.000Z',
    updatedAt: '2026-06-27T00:00:00.000Z'
  })
];

const activeCodexTaskStatuses = new Set(['claimed', 'preparing_workspace', 'codex_running', 'validating', 'running']);
const staleBuildJobStatuses = new Set(['queued', 'running']);

function toProjectSummary(project: ProjectDetail): ProjectSummary {
  return projectSummarySchema.parse({
    id: project.id,
    name: project.name,
    status: project.status,
    target: project.target,
    deploymentUrl: project.deploymentUrl,
    githubRepoFullName: project.githubRepoFullName,
    githubCommitSha: project.githubCommitSha,
    updatedAt: project.updatedAt
  });
}

function canReadProject(user: UserProfile, project: ProjectDetail): boolean {
  return user.role === 'admin' || project.ownerId === user.id;
}

export function createInMemoryStore(clock: () => Date = () => new Date()): InMemoryStore {
  let users = [...seededUsers];
  let localAuthPasswordHashes: Array<{ userId: string; passwordHash: string }> = [];
  let authSessions: Array<{ tokenHash: string; userId: string; expiresAt: string }> = [];
  let projects = [...seededProjects];
  let agentRuns: AgentRun[] = [];
  let agentMessages: AgentMessageRecord[] = [];
  let modelInvocations: ModelInvocation[] = [];
  let appSpecs: AppSpecRecord[] = [];
  let buildJobs: BuildJobRecord[] = [];
  let buildLogs: BuildLogRecord[] = [];
  let connectorAccounts: ConnectorAccount[] = [];
  let supabaseConfigs: SupabaseConfigRecord[] = [];
  let designProfiles: DesignProfileRecord[] = [];
  let projectFiles: ProjectFileRecord[] = [];
  let projectVersions: ProjectVersionRecord[] = [];
  let workspaces: WorkspaceRecord[] = [];
  let codexTasks: CodexTaskRecord[] = [];
  let previewSnapshots: PreviewSnapshotRecord[] = [];
  let traceEvents: TraceEventRecord[] = [];

  function ensureUser(user: UserProfile): UserProfile {
    if (users.some((existing) => existing.id === user.id)) {
      return user;
    }

    users = [...users, user];
    return user;
  }

  return {
    ensureUser,

    getLocalAuthUserByEmail(email) {
      const normalizedEmail = email.trim().toLowerCase();
      const user = users.find((existing) => existing.email === normalizedEmail);

      if (!user) {
        return undefined;
      }

      return {
        user,
        passwordHash: localAuthPasswordHashes.find((item) => item.userId === user.id)?.passwordHash
      };
    },

    upsertLocalAuthUser(input) {
      const normalizedEmail = input.email.trim().toLowerCase();
      const existing = users.find((user) => user.email === normalizedEmail);
      const user = userProfileSchema.parse({
        id: existing?.id ?? `user-${normalizedEmail.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || users.length + 1}`,
        email: normalizedEmail,
        name: input.name,
        role: input.role ?? existing?.role ?? 'creator'
      });
      users = [user, ...users.filter((item) => item.id !== user.id && item.email !== user.email)];
      localAuthPasswordHashes = [
        { userId: user.id, passwordHash: input.passwordHash },
        ...localAuthPasswordHashes.filter((item) => item.userId !== user.id)
      ];
      return user;
    },

    createAuthSession(input) {
      authSessions = [
        input,
        ...authSessions.filter((session) => session.tokenHash !== input.tokenHash)
      ];
    },

    getAuthSession(tokenHash) {
      const session = authSessions.find((item) => item.tokenHash === tokenHash);

      if (!session || new Date(session.expiresAt).getTime() <= clock().getTime()) {
        return undefined;
      }

      const user = users.find((item) => item.id === session.userId);

      if (!user) {
        return undefined;
      }

      return {
        user,
        expiresAt: session.expiresAt
      };
    },

    deleteAuthSession(tokenHash) {
      authSessions = authSessions.filter((session) => session.tokenHash !== tokenHash);
    },

    getConnectorAccount(userId, connector) {
      return connectorAccounts.find((account) => account.userId === userId && account.connector === connector);
    },

    upsertConnectorAccount(input) {
      const now = clock().toISOString();
      const existing = connectorAccounts.find((account) => account.userId === input.userId && account.connector === input.connector);
      const account = connectorAccountSchema.parse({
        ...existing,
        ...input,
        id: existing?.id ?? `connector-account-${connectorAccounts.length + 1}`,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      connectorAccounts = [
        account,
        ...connectorAccounts.filter((item) => !(item.userId === input.userId && item.connector === input.connector))
      ];
      return account;
    },

    getProjectSupabaseConfig(projectId) {
      return supabaseConfigs.find((config) => config.projectId === projectId);
    },

    upsertProjectSupabaseConfig(projectId, input) {
      const now = clock().toISOString();
      const existing = supabaseConfigs.find((config) => config.projectId === projectId);
      const frontendEnvStillMatches = existing?.supabaseUrl === input.supabaseUrl && existing?.anonKey === input.anonKey;
      const config = supabaseConfigRecordSchema.parse({
        projectId,
        supabaseUrl: input.supabaseUrl,
        anonKey: input.anonKey,
        serviceRoleKeyEncrypted: input.serviceRoleKeyEncrypted ?? existing?.serviceRoleKeyEncrypted,
        frontendEnvConfirmedAt: frontendEnvStillMatches ? existing?.frontendEnvConfirmedAt : undefined,
        lastConnectionStatus: frontendEnvStillMatches ? existing?.lastConnectionStatus : undefined,
        lastConnectionDetail: frontendEnvStillMatches ? existing?.lastConnectionDetail : undefined,
        lastConnectionHttpStatus: frontendEnvStillMatches ? existing?.lastConnectionHttpStatus : undefined,
        lastConnectionCheckedAt: frontendEnvStillMatches ? existing?.lastConnectionCheckedAt : undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
      supabaseConfigs = [
        config,
        ...supabaseConfigs.filter((item) => item.projectId !== projectId)
      ];
      return config;
    },

    recordProjectSupabaseConnectionTest(projectId, result) {
      const existing = supabaseConfigs.find((config) => config.projectId === projectId);

      if (!existing) {
        return undefined;
      }

      const updated = supabaseConfigRecordSchema.parse({
        ...existing,
        lastConnectionStatus: result.status,
        lastConnectionDetail: result.detail,
        lastConnectionHttpStatus: result.httpStatus,
        lastConnectionCheckedAt: result.checkedAt,
        updatedAt: clock().toISOString()
      });
      supabaseConfigs = [
        updated,
        ...supabaseConfigs.filter((item) => item.projectId !== projectId)
      ];
      return updated;
    },

    confirmProjectSupabaseFrontendEnv(projectId) {
      const existing = supabaseConfigs.find((config) => config.projectId === projectId);

      if (!existing) {
        return undefined;
      }

      const updated = supabaseConfigRecordSchema.parse({
        ...existing,
        frontendEnvConfirmedAt: clock().toISOString(),
        updatedAt: clock().toISOString()
      });
      supabaseConfigs = [
        updated,
        ...supabaseConfigs.filter((item) => item.projectId !== projectId)
      ];
      return updated;
    },

    listProjectSupabaseConfigs() {
      return [...supabaseConfigs];
    },

    listUsers() {
      return [...users];
    },

    listProjectsForUser(user) {
      ensureUser(user);
      return projects.filter((project) => canReadProject(user, project)).map(toProjectSummary);
    },

    listAllProjects() {
      return projects.map(toProjectSummary);
    },

    createProject(user, input) {
      ensureUser(user);
      const now = clock().toISOString();
      const project = projectDetailSchema.parse({
        id: `project-${projects.length + 1}`,
        ownerId: user.id,
        name: input.name,
        prompt: input.prompt,
        status: 'draft',
        target: input.target,
        createdAt: now,
        updatedAt: now
      });

      projects = [...projects, project];
      return project;
    },

    getProjectById(user, projectId) {
      ensureUser(user);
      return projects.find((project) => project.id === projectId && canReadProject(user, project));
    },

    updateProject(user, projectId, input) {
      ensureUser(user);
      const existing = projects.find((project) => project.id === projectId && canReadProject(user, project));

      if (!existing) {
        return undefined;
      }

      const updated = projectDetailSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      projects = projects.map((project) => (project.id === projectId ? updated : project));
      return updated;
    },

    setProjectStatus(projectId, status) {
      const existing = projects.find((project) => project.id === projectId);

      if (!existing) {
        return undefined;
      }

      const updated = projectDetailSchema.parse({
        ...existing,
        status,
        updatedAt: clock().toISOString()
      });
      projects = projects.map((project) => (project.id === projectId ? updated : project));
      return updated;
    },

    createAgentRun(input) {
      const now = clock().toISOString();
      const run = agentRunSchema.parse({
        ...input,
        id: `agent-run-${agentRuns.length + 1}`,
        createdAt: now,
        updatedAt: now
      });
      agentRuns = [run, ...agentRuns];
      return run;
    },

    updateAgentRun(agentRunId, input) {
      const existing = agentRuns.find((run) => run.id === agentRunId);

      if (!existing) {
        return undefined;
      }

      const updated = agentRunSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      agentRuns = agentRuns.map((run) => (run.id === agentRunId ? updated : run));
      return updated;
    },

    createAgentMessage(input) {
      const now = clock().toISOString();
      const message = agentMessageRecordSchema.parse({
        id: `agent-message-${agentMessages.length + 1}`,
        projectId: input.projectId,
        userId: input.userId,
        content: input.content,
        status: input.status,
        relatedTaskId: input.relatedTaskId,
        createdAt: now,
        updatedAt: now
      });
      agentMessages = [message, ...agentMessages];
      return message;
    },

    listAgentMessages(projectId, limit) {
      return agentMessages
        .filter((message) => message.projectId === projectId)
        .slice(0, limit);
    },

    countDeferredAgentMessages(projectId) {
      return agentMessages.filter((message) => message.projectId === projectId && message.status === 'deferred').length;
    },

    getNextDeferredAgentMessage(projectId) {
      return [...agentMessages]
        .reverse()
        .find((message) => message.projectId === projectId && message.status === 'deferred');
    },

    updateAgentMessage(messageId, input) {
      const existing = agentMessages.find((message) => message.id === messageId);

      if (!existing) {
        return undefined;
      }

      const updated = agentMessageRecordSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      agentMessages = agentMessages.map((message) => (message.id === messageId ? updated : message));
      return updated;
    },

    updateAgentMessageByTask(taskId, input) {
      const existing = agentMessages.find((message) => message.relatedTaskId === taskId);

      if (!existing) {
        return undefined;
      }

      const updated = agentMessageRecordSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      agentMessages = agentMessages.map((message) => (message.id === existing.id ? updated : message));
      return updated;
    },

    createModelInvocation(input) {
      const invocation = modelInvocationSchema.parse({
        ...input,
        id: `model-invocation-${modelInvocations.length + 1}`,
        createdAt: clock().toISOString()
      });
      modelInvocations = [invocation, ...modelInvocations];
      return invocation;
    },

    createAppSpec(input) {
      const now = clock().toISOString();
      const version = appSpecs.filter((record) => record.projectId === input.projectId).length + 1;
      const record = appSpecRecordSchema.parse({
        id: `app-spec-${appSpecs.length + 1}`,
        projectId: input.projectId,
        sourceAgentRunId: input.sourceAgentRunId,
        version,
        status: 'validated',
        spec: input.spec,
        createdAt: now,
        updatedAt: now
      });
      appSpecs = [record, ...appSpecs];
      return record;
    },

    updateLatestAppSpec(input) {
      const latest = appSpecs.find((record) => record.projectId === input.projectId);

      if (!latest) {
        return undefined;
      }

      const now = clock().toISOString();
      const version = appSpecs.filter((record) => record.projectId === input.projectId).length + 1;
      const record = appSpecRecordSchema.parse({
        id: `app-spec-${appSpecs.length + 1}`,
        projectId: input.projectId,
        sourceAgentRunId: latest.sourceAgentRunId,
        version,
        status: 'validated',
        spec: input.spec,
        createdAt: now,
        updatedAt: now
      });
      appSpecs = [record, ...appSpecs];
      return record;
    },

    confirmAppSpec(input) {
      const existing = appSpecs.find((record) => record.projectId === input.projectId && record.id === input.specId);

      if (!existing) {
        return undefined;
      }

      const confirmed = appSpecRecordSchema.parse({
        ...existing,
        status: 'confirmed',
        updatedAt: clock().toISOString()
      });
      appSpecs = appSpecs.map((record) => (record.id === input.specId ? confirmed : record));
      return confirmed;
    },

    getLatestAppSpec(projectId) {
      return appSpecs.find((record) => record.projectId === projectId);
    },

    createDesignProfiles(input) {
      const now = clock().toISOString();
      const nextVersion = designProfiles.filter((record) => record.projectId === input.projectId).length + 1;
      const records = input.profiles.map((profile, index) =>
        designProfileRecordSchema.parse({
          id: `design-profile-${designProfiles.length + index + 1}`,
          projectId: input.projectId,
          specVersionId: input.specVersionId,
          version: nextVersion + index,
          profile,
          selected: false,
          createdAt: now
        })
      );
      designProfiles = [...records, ...designProfiles];
      return records;
    },

    listDesignProfiles(projectId) {
      return designProfiles.filter((record) => record.projectId === projectId);
    },

    selectDesignProfile(projectId, designId) {
      const existing = designProfiles.find((record) => record.projectId === projectId && record.id === designId);

      if (!existing) {
        return undefined;
      }

      designProfiles = designProfiles.map((record) =>
        record.projectId === projectId
          ? designProfileRecordSchema.parse({
              ...record,
              selected: record.id === designId
            })
          : record
      );
      return designProfiles.find((record) => record.id === designId);
    },

    getSelectedDesignProfile(projectId) {
      return designProfiles.find((record) => record.projectId === projectId && record.selected);
    },

    saveGeneratedProject(input) {
      const now = clock().toISOString();
      const version = projectVersions.filter((record) => record.projectId === input.projectId).length + 1;
      const changedFiles = input.files.map((file) => file.path);
      const projectVersion = projectVersionRecordSchema.parse({
        id: `project-version-${projectVersions.length + 1}`,
        projectId: input.projectId,
        version,
        source: input.source ?? 'initial_generate',
        summary: input.summary,
        changedFiles,
        specVersionId: input.specVersionId,
        designProfileId: input.designProfileId,
        workspacePath: input.workspacePath,
        parentVersionId: input.parentVersionId,
        createdAt: now
      });
      const savedFiles = input.files.map((file) => {
        const existing = projectFiles.find((record) => record.projectId === input.projectId && record.path === file.path);
        return projectFileRecordSchema.parse({
          id: existing?.id ?? `project-file-${projectFiles.length + changedFiles.indexOf(file.path) + 1}`,
          projectId: input.projectId,
          path: file.path,
          content: file.content,
          contentHash: hashContent(file.content),
          version: existing ? existing.version + 1 : 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
      });
      const filesByPath = new Map([...projectFiles, ...savedFiles].map((file) => [`${file.projectId}:${file.path}`, file]));
      projectFiles = [...filesByPath.values()];
      projectVersions = [projectVersion, ...projectVersions];

      return {
        projectVersion,
        files: savedFiles
      };
    },

    saveProjectFilePatch(input) {
      const now = clock().toISOString();
      const version = projectVersions.filter((record) => record.projectId === input.projectId).length + 1;
      const changedFiles = input.files.map((file) => file.path);
      const projectVersion = projectVersionRecordSchema.parse({
        id: `project-version-${projectVersions.length + 1}`,
        projectId: input.projectId,
        version,
        source: input.source,
        summary: input.summary,
        changedFiles,
        workspacePath: input.workspacePath,
        parentVersionId: input.parentVersionId,
        createdAt: now
      });
      const savedFiles = input.files.map((file) => {
        const existing = projectFiles.find((record) => record.projectId === input.projectId && record.path === file.path);
        return projectFileRecordSchema.parse({
          id: existing?.id ?? `project-file-${projectFiles.length + changedFiles.indexOf(file.path) + 1}`,
          projectId: input.projectId,
          path: file.path,
          content: file.content,
          contentHash: hashContent(file.content),
          version: existing ? existing.version + 1 : 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
      });
      const manifestFile = input.manifest
        ? projectFileRecordSchema.parse({
            id:
              projectFiles.find((record) => record.projectId === input.projectId && record.path === 'ai-manifest.json')?.id ??
              `project-file-${projectFiles.length + savedFiles.length + 1}`,
            projectId: input.projectId,
            path: 'ai-manifest.json',
            content: `${JSON.stringify(input.manifest, null, 2)}\n`,
            contentHash: hashContent(`${JSON.stringify(input.manifest, null, 2)}\n`),
            version:
              (projectFiles.find((record) => record.projectId === input.projectId && record.path === 'ai-manifest.json')?.version ?? 0) +
              1,
            createdAt:
              projectFiles.find((record) => record.projectId === input.projectId && record.path === 'ai-manifest.json')?.createdAt ?? now,
            updatedAt: now
          })
        : undefined;
      const filesByPath = new Map(
        [...projectFiles, ...savedFiles, ...(manifestFile ? [manifestFile] : [])].map((file) => [`${file.projectId}:${file.path}`, file])
      );
      projectFiles = [...filesByPath.values()];
      projectVersions = [projectVersion, ...projectVersions];

      return {
        projectVersion,
        files: savedFiles
      };
    },

    listProjectFiles(projectId) {
      return projectFiles
        .filter((file) => file.projectId === projectId)
        .sort((left, right) => left.path.localeCompare(right.path));
    },

    listProjectVersions(projectId) {
      return projectVersions
        .filter((version) => version.projectId === projectId)
        .sort((left, right) => right.version - left.version);
    },

    getProjectFile(projectId, path) {
      return projectFiles.find((file) => file.projectId === projectId && file.path === path);
    },

    createBuildJob(projectId, input) {
      const now = clock().toISOString();
      const buildJob = buildJobRecordSchema.parse({
        id: `build-job-${buildJobs.length + 1}`,
        projectId,
        projectVersionId: input.projectVersionId,
        status: 'queued',
        createdAt: now
      });
      buildJobs = [buildJob, ...buildJobs];
      return buildJob;
    },

    getBuildJob(projectId, buildJobId) {
      return buildJobs.find((job) => job.projectId === projectId && job.id === buildJobId);
    },

    getLatestBuildJob(projectId) {
      return buildJobs.find((job) => job.projectId === projectId);
    },

    listStaleBuildJobs(cutoffIso, limit) {
      return buildJobs
        .filter((job) => staleBuildJobStatuses.has(job.status) && (job.startedAt ?? job.createdAt) < cutoffIso)
        .slice(0, limit);
    },

    updateBuildJob(buildJobId, input) {
      const existing = buildJobs.find((job) => job.id === buildJobId);

      if (!existing) {
        return undefined;
      }

      const updated = buildJobRecordSchema.parse({
        ...existing,
        ...input
      });
      buildJobs = buildJobs.map((job) => (job.id === buildJobId ? updated : job));
      return updated;
    },

    createWorkspace(input) {
      const now = clock().toISOString();
      const workspace = workspaceRecordSchema.parse({
        id: `workspace-${workspaces.length + 1}`,
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        path: input.path,
        status: input.status ?? 'creating',
        createdAt: now,
        updatedAt: now
      });
      workspaces = [workspace, ...workspaces];
      return workspace;
    },

    listWorkspaces(projectId) {
      return workspaces.filter((workspace) => workspace.projectId === projectId);
    },

    getWorkspace(workspaceId) {
      return workspaces.find((workspace) => workspace.id === workspaceId);
    },

    updateWorkspace(workspaceId, input) {
      const existing = workspaces.find((workspace) => workspace.id === workspaceId);

      if (!existing) {
        return undefined;
      }

      const updated = workspaceRecordSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      workspaces = workspaces.map((workspace) => (workspace.id === workspaceId ? updated : workspace));
      return updated;
    },

    lockWorkspace(workspaceId, lockedBy) {
      const existing = workspaces.find((workspace) => workspace.id === workspaceId);

      if (!existing) {
        return undefined;
      }

      const updated = workspaceRecordSchema.parse({
        ...existing,
        status: 'locked',
        lockedBy,
        updatedAt: clock().toISOString()
      });
      workspaces = workspaces.map((workspace) => (workspace.id === workspaceId ? updated : workspace));
      return updated;
    },

    unlockWorkspace(workspaceId) {
      const existing = workspaces.find((workspace) => workspace.id === workspaceId);

      if (!existing) {
        return undefined;
      }

      const updated = workspaceRecordSchema.parse({
        ...existing,
        status: 'ready',
        lockedBy: undefined,
        updatedAt: clock().toISOString()
      });
      workspaces = workspaces.map((workspace) => (workspace.id === workspaceId ? updated : workspace));
      return updated;
    },

    createCodexTask(input) {
      const now = clock().toISOString();
      const task = codexTaskRecordSchema.parse({
        id: `codex-task-${codexTasks.length + 1}`,
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        workspaceId: input.workspaceId,
        taskType: input.taskType,
        status: 'queued',
        objective: input.objective,
        inputSummary: input.inputSummary,
        taskSpec: input.taskSpec,
        allowedPaths: input.allowedPaths,
        forbiddenPaths: input.forbiddenPaths ?? [],
        validationCommands: input.validationCommands,
        createdAt: now,
        updatedAt: now
      });
      codexTasks = [task, ...codexTasks];
      return task;
    },

    listCodexTasks(projectId) {
      return codexTasks.filter((task) => task.projectId === projectId);
    },

    getCodexTask(taskId) {
      return codexTasks.find((task) => task.id === taskId);
    },

    claimCodexTask(taskId, workerId) {
      const nextTask = codexTasks.find((task) => (
        task.id === taskId &&
        task.status === 'queued' &&
        !codexTasks.some((candidate) => (
          candidate.projectId === task.projectId &&
          candidate.id !== task.id &&
          activeCodexTaskStatuses.has(candidate.status)
        ))
      ));

      if (!nextTask) {
        return undefined;
      }

      const now = clock().toISOString();
      const updated = codexTaskRecordSchema.parse({
        ...nextTask,
        status: 'claimed',
        claimedBy: workerId,
        claimedAt: now,
        attemptCount: nextTask.attemptCount + 1,
        updatedAt: now
      });
      codexTasks = codexTasks.map((task) => (task.id === nextTask.id ? updated : task));
      return updated;
    },

    claimNextCodexTask(workerId) {
      const nextTask = [...codexTasks]
        .reverse()
        .find((task) => task.status === 'queued' && !codexTasks.some((candidate) => (
          candidate.projectId === task.projectId &&
          candidate.id !== task.id &&
          activeCodexTaskStatuses.has(candidate.status)
        )));

      if (!nextTask) {
        return undefined;
      }

      const now = clock().toISOString();
      const updated = codexTaskRecordSchema.parse({
        ...nextTask,
        status: 'claimed',
        claimedBy: workerId,
        claimedAt: now,
        attemptCount: nextTask.attemptCount + 1,
        updatedAt: now
      });
      codexTasks = codexTasks.map((task) => (task.id === nextTask.id ? updated : task));
      return updated;
    },

    listStaleCodexTasks(cutoffIso, limit) {
      return codexTasks
        .filter((task) => activeCodexTaskStatuses.has(task.status) && task.updatedAt < cutoffIso)
        .slice(0, limit);
    },

    updateCodexTask(taskId, input) {
      const existing = codexTasks.find((task) => task.id === taskId);

      if (!existing) {
        return undefined;
      }

      const updated = codexTaskRecordSchema.parse({
        ...existing,
        ...input,
        updatedAt: clock().toISOString()
      });
      codexTasks = codexTasks.map((task) => (task.id === taskId ? updated : task));
      return updated;
    },

    createPreviewSnapshot(input) {
      const now = clock().toISOString();
      const snapshot = previewSnapshotRecordSchema.parse({
        id: `preview-snapshot-${previewSnapshots.length + 1}`,
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        buildJobId: input.buildJobId,
        status: input.status,
        path: input.path,
        url: input.url,
        active: input.active ?? false,
        errorSummary: input.errorSummary,
        createdAt: now,
        updatedAt: now
      });
      previewSnapshots = [
        snapshot,
        ...previewSnapshots.map((item) => (snapshot.active && item.projectId === snapshot.projectId ? { ...item, active: false } : item))
      ];
      return snapshot;
    },

    listPreviewSnapshots(projectId) {
      return previewSnapshots.filter((snapshot) => snapshot.projectId === projectId);
    },

    getLatestPreviewSnapshot(projectId) {
      return previewSnapshots.find((snapshot) => snapshot.projectId === projectId);
    },

    activatePreviewSnapshot(snapshotId) {
      const existing = previewSnapshots.find((snapshot) => snapshot.id === snapshotId);

      if (!existing) {
        return undefined;
      }

      const updated = previewSnapshotRecordSchema.parse({
        ...existing,
        active: true,
        updatedAt: clock().toISOString()
      });
      previewSnapshots = previewSnapshots.map((snapshot) => {
        if (snapshot.id === snapshotId) {
          return updated;
        }

        if (snapshot.projectId === existing.projectId) {
          return previewSnapshotRecordSchema.parse({
            ...snapshot,
            active: false,
            updatedAt: clock().toISOString()
          });
        }

        return snapshot;
      });
      return updated;
    },

    appendTraceEvent(input) {
      const event = traceEventRecordSchema.parse({
        id: `trace-event-${traceEvents.length + 1}`,
        projectId: input.projectId,
        agentRunId: input.agentRunId,
        codexTaskId: input.codexTaskId,
        buildJobId: input.buildJobId,
        type: input.type,
        visibility: input.visibility,
        message: input.message,
        payload: input.payload ?? {},
        createdAt: clock().toISOString()
      });
      traceEvents = [event, ...traceEvents];
      return event;
    },

    listTraceEvents(projectId, limit) {
      return traceEvents.filter((event) => event.projectId === projectId).slice(0, limit);
    },

    updateProjectDeploymentUrl(projectId: string, input: UpdateProjectDeploymentInput) {
      const existing = projects.find((project) => project.id === projectId);

      if (!existing) {
        return undefined;
      }

      const updated = projectDetailSchema.parse({
        ...existing,
        deploymentUrl: input.deploymentUrl,
        status: 'deployed',
        updatedAt: clock().toISOString()
      });
      projects = projects.map((project) => (project.id === projectId ? updated : project));
      return updated;
    },

    updateProjectGitHubCommit(projectId: string, input: { repoFullName: string; commitSha: string }) {
      const existing = projects.find((project) => project.id === projectId);

      if (!existing) {
        return undefined;
      }

      const updated = projectDetailSchema.parse({
        ...existing,
        githubRepoFullName: input.repoFullName,
        githubCommitSha: input.commitSha,
        updatedAt: clock().toISOString()
      });
      projects = projects.map((project) => (project.id === projectId ? updated : project));
      return updated;
    },

    getProjectPublishState(input: {
      project: ProjectDetail;
      latestBuildJob?: BuildJobRecord;
      currentVersionId?: string;
      activePreviewSnapshot?: PreviewSnapshotRecord;
      githubConfigured: boolean;
      supabaseConfigured: boolean;
      supabaseFrontendEnvConfirmed: boolean;
      supabaseLastConnectionStatus?: SupabaseConfigRecord['lastConnectionStatus'];
    }): ProjectPublishState {
      return createProjectPublishState(input);
    },

    appendBuildLog(input) {
      const log = buildLogRecordSchema.parse({
        ...input,
        id: `build-log-${buildLogs.length + 1}`,
        createdAt: clock().toISOString()
      });
      buildLogs = [...buildLogs, log];
      return log;
    },

    listBuildLogs(buildJobId) {
      return buildLogs.filter((log) => log.buildJobId === buildJobId);
    },

    listRecentAgentRuns(limit) {
      return agentRuns.slice(0, limit);
    },

    listRecentModelInvocations(limit) {
      return modelInvocations.slice(0, limit);
    },

    listRecentBuildJobs(limit) {
      return buildJobs.slice(0, limit).map((job) => adminBuildJobSchema.parse(job));
    },

    listRecentCodexTasks(limit) {
      return codexTasks.slice(0, limit);
    },

    listRecentPreviewSnapshots(limit) {
      return previewSnapshots.slice(0, limit);
    },

    listRecentTraceEvents(limit) {
      return traceEvents.slice(0, limit);
    },

    getEstimatedSpendCny() {
      return modelInvocations.reduce((total, invocation) => total + invocation.estimatedCostCny, 0);
    },

    getAdminOverview(model) {
      return adminOverviewSchema.parse({
        usersCount: users.length,
        projectsCount: projects.length,
        buildJobsToday: buildJobs.length,
        failedBuildsToday: buildJobs.filter((job) => job.status === 'failed').length,
        modelCallsToday: modelInvocations.filter((invocation) => invocation.status === 'succeeded').length,
        estimatedSpendCny: modelInvocations.reduce((total, invocation) => total + invocation.estimatedCostCny, 0),
        appSpecsCount: appSpecs.length,
        agentRunsCount: agentRuns.length,
        modelInvocationsCount: modelInvocations.length,
        dataSource: 'memory',
        modelProvider: model.provider,
        modelBudgetCny: model.budgetCny,
        recentAgentRuns: agentRuns.slice(0, 5).map((run) => ({
          id: run.id,
          projectId: run.projectId,
          purpose: run.purpose,
          provider: run.provider,
          status: run.status,
          errorType: run.errorType,
          updatedAt: run.updatedAt
        })),
        recentModelInvocations: modelInvocations.slice(0, 5).map((invocation) => ({
          id: invocation.id,
          projectId: invocation.projectId,
          agentRunId: invocation.agentRunId,
          provider: invocation.provider,
          model: invocation.model,
          purpose: invocation.purpose,
          status: invocation.status,
          estimatedCostCny: invocation.estimatedCostCny,
          errorType: invocation.errorType,
          createdAt: invocation.createdAt
        }))
      });
    },

    getRuntimeHealth() {
      return {
        database: 'memory'
      };
    }
  };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
