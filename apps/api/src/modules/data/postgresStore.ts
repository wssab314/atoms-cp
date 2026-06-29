import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import {
  adminOverviewSchema,
  adminBuildJobSchema,
  agentMessageRecordSchema,
  agentRunSchema,
  appSpecRecordSchema,
  buildJobRecordSchema,
  buildLogRecordSchema,
  codexTaskRecordSchema,
  connectorAccountSchema,
  designProfileRecordSchema,
  modelInvocationSchema,
  previewSnapshotRecordSchema,
  projectFileRecordSchema,
  projectDetailSchema,
  projectSummarySchema,
  projectVersionRecordSchema,
  supabaseConfigRecordSchema,
  traceEventRecordSchema,
  userProfileSchema,
  workspaceRecordSchema,
  type AiManifest,
  type AgentMessageRecord,
  type AgentRun,
  type AdminBuildJob,
  type AppSpec,
  type BuildJobRecord,
  type BuildLogRecord,
  type CodexTaskRecord,
  type ConnectorAccount,
  type DesignProfileRecord,
  type ModelInvocation,
  type ModelRuntimeConfig,
  type ProjectFileRecord,
  type ProjectDetail,
  type ProjectPublishState,
  type ProjectStatus,
  type PreviewSnapshotRecord,
  type SupabaseConfigRecord,
  type TraceEventRecord,
  type ProjectVersionRecord,
  type UpdateProjectDeploymentInput,
  type UpdateProjectInput,
  type UserProfile,
  type WorkspaceRecord
} from '@atoms-cp/shared';
import type { AppStore } from './appStore.js';
import { createProjectPublishState } from '../publish/publishState.js';

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  email: string;
  name: string | null;
  role: string;
  password_hash?: string | null;
}

interface AuthSessionRow extends Record<string, unknown> {
  user_id: string;
  expires_at: Date | string;
  id: string;
  email: string;
  name: string | null;
  role: string;
}

interface ProjectRow extends Record<string, unknown> {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  status: string;
  target: string;
  deployment_url?: string | null;
  github_repo_full_name?: string | null;
  github_commit_sha?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentRunRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  purpose: string;
  provider: string;
  status: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
  error_type: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AgentMessageRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  status: string;
  related_task_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ModelInvocationRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  agent_run_id: string;
  provider: string;
  model: string;
  purpose: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  estimated_cost_cny: string | number;
  budget_limit_cny: string | number;
  error_type: string | null;
  error_message: string | null;
  created_at: Date | string;
}

interface AppSpecRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  source_agent_run_id: string;
  version: number;
  status: string;
  spec_json: AppSpec;
  validation_errors: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BuildJobRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_version_id: string | null;
  status: string;
  command: string | null;
  preview_url: string | null;
  error_summary: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
}

interface BuildLogRow extends Record<string, unknown> {
  id: string;
  build_job_id: string;
  stream: string;
  line: string;
  created_at: Date | string;
}

interface DesignProfileRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  spec_version_id: string;
  version: number;
  profile_json: DesignProfileRecord['profile'];
  selected: boolean;
  created_at: Date | string;
}

interface ProjectFileRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  path: string;
  content: string;
  content_hash: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProjectVersionRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  version: number;
  source: string;
  summary: string | null;
  changed_files: string[];
  spec_version_id: string | null;
  design_profile_id: string | null;
  workspace_path?: string | null;
  parent_version_id?: string | null;
  created_at: Date | string;
}

interface WorkspaceRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_version_id: string | null;
  path: string;
  status: string;
  locked_by: string | null;
  error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CodexTaskRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_version_id: string | null;
  workspace_id: string | null;
  task_type: string;
  status: string;
  objective: string;
  input_summary: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  validation_commands: string[];
  task_spec: Record<string, unknown> | string | null;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: Date | string | null;
  result_summary: string | null;
  error_summary: string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PreviewSnapshotRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  project_version_id: string;
  build_job_id: string | null;
  status: string;
  path: string;
  url: string;
  active: boolean;
  error_summary: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TraceEventRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  agent_run_id: string | null;
  codex_task_id: string | null;
  build_job_id: string | null;
  type: string;
  visibility: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: Date | string;
}

interface ConnectorAccountRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  connector: ConnectorAccount['connector'];
  external_user_id: string | null;
  external_username: string | null;
  scopes: string[] | null;
  token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProjectConnectorRow extends Record<string, unknown> {
  id: string;
  project_id: string;
  connector_account_id: string | null;
  connector: string;
  config_json: Record<string, unknown>;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  return [];
}

function toRecordObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toUser(row: UserRow): UserProfile {
  return userProfileSchema.parse({
    id: row.id,
    email: row.email,
    name: row.name ?? undefined,
    role: row.role
  });
}

function toProjectDetail(row: ProjectRow): ProjectDetail {
  return projectDetailSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    prompt: row.description ?? '',
    status: row.status,
    target: row.target,
    deploymentUrl: row.deployment_url ?? undefined,
    githubRepoFullName: row.github_repo_full_name ?? undefined,
    githubCommitSha: row.github_commit_sha ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toProjectSummary(row: ProjectRow) {
  return projectSummarySchema.parse({
    id: row.id,
    name: row.name,
    status: row.status,
    target: row.target,
    deploymentUrl: row.deployment_url ?? undefined,
    githubRepoFullName: row.github_repo_full_name ?? undefined,
    githubCommitSha: row.github_commit_sha ?? undefined,
    updatedAt: toIso(row.updated_at)
  });
}

function toAgentRun(row: AgentRunRow): AgentRun {
  return agentRunSchema.parse({
    id: row.id,
    projectId: row.project_id,
    purpose: row.purpose,
    provider: row.provider,
    status: row.status,
    inputSnapshot: row.input_json,
    outputSnapshot: row.output_json ?? undefined,
    errorType: row.error_type ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toAgentMessageRecord(row: AgentMessageRow): AgentMessageRecord {
  return agentMessageRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    content: row.content,
    status: row.status,
    relatedTaskId: row.related_task_id ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toModelInvocation(row: ModelInvocationRow): ModelInvocation {
  return modelInvocationSchema.parse({
    id: row.id,
    projectId: row.project_id,
    agentRunId: row.agent_run_id,
    provider: row.provider,
    model: row.model,
    purpose: row.purpose,
    status: row.status,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    durationMs: Number(row.duration_ms),
    estimatedCostCny: Number(row.estimated_cost_cny),
    budgetLimitCny: Number(row.budget_limit_cny),
    errorType: row.error_type ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: toIso(row.created_at)
  });
}

function toAppSpecRecord(row: AppSpecRow) {
  return appSpecRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    sourceAgentRunId: row.source_agent_run_id,
    version: Number(row.version),
    status: row.status,
    spec: row.spec_json,
    validationErrors: row.validation_errors ?? [],
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toAdminBuildJob(row: BuildJobRow): AdminBuildJob {
  return adminBuildJobSchema.parse({
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    command: row.command ?? undefined,
    previewUrl: row.preview_url ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    createdAt: toIso(row.created_at)
  });
}

function toBuildJobRecord(row: BuildJobRow): BuildJobRecord {
  return buildJobRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectVersionId: row.project_version_id ?? undefined,
    status: row.status,
    command: row.command ?? undefined,
    previewUrl: row.preview_url ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    createdAt: toIso(row.created_at),
    startedAt: row.started_at ? toIso(row.started_at) : undefined,
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined
  });
}

function toBuildLogRecord(row: BuildLogRow): BuildLogRecord {
  return buildLogRecordSchema.parse({
    id: row.id,
    buildJobId: row.build_job_id,
    stream: row.stream,
    line: row.line,
    createdAt: toIso(row.created_at)
  });
}

function toDesignProfileRecord(row: DesignProfileRow): DesignProfileRecord {
  return designProfileRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    specVersionId: row.spec_version_id,
    version: Number(row.version),
    profile: row.profile_json,
    selected: Boolean(row.selected),
    createdAt: toIso(row.created_at)
  });
}

function toProjectFileRecord(row: ProjectFileRow): ProjectFileRecord {
  return projectFileRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    path: row.path,
    content: row.content,
    contentHash: row.content_hash,
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toProjectVersionRecord(row: ProjectVersionRow): ProjectVersionRecord {
  return projectVersionRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    version: Number(row.version),
    source: row.source,
    summary: row.summary ?? undefined,
    changedFiles: toStringArray(row.changed_files),
    specVersionId: row.spec_version_id ?? undefined,
    designProfileId: row.design_profile_id ?? undefined,
    workspacePath: row.workspace_path ?? undefined,
    parentVersionId: row.parent_version_id ?? undefined,
    createdAt: toIso(row.created_at)
  });
}

function toWorkspaceRecord(row: WorkspaceRow): WorkspaceRecord {
  return workspaceRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectVersionId: row.project_version_id ?? undefined,
    path: row.path,
    status: row.status,
    lockedBy: row.locked_by ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toCodexTaskRecord(row: CodexTaskRow): CodexTaskRecord {
  return codexTaskRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectVersionId: row.project_version_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    taskType: row.task_type,
    status: row.status,
    objective: row.objective,
    inputSummary: row.input_summary,
    taskSpec: Object.keys(toRecordObject(row.task_spec)).length > 0 ? toRecordObject(row.task_spec) : undefined,
    allowedPaths: toStringArray(row.allowed_paths),
    forbiddenPaths: toStringArray(row.forbidden_paths),
    validationCommands: toStringArray(row.validation_commands),
    attemptCount: Number(row.attempt_count ?? 0),
    claimedBy: row.claimed_by ?? undefined,
    claimedAt: row.claimed_at ? toIso(row.claimed_at) : undefined,
    resultSummary: row.result_summary ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    finishedAt: row.finished_at ? toIso(row.finished_at) : undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toPreviewSnapshotRecord(row: PreviewSnapshotRow): PreviewSnapshotRecord {
  return previewSnapshotRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    projectVersionId: row.project_version_id,
    buildJobId: row.build_job_id ?? undefined,
    status: row.status,
    path: row.path,
    url: row.url,
    active: Boolean(row.active),
    errorSummary: row.error_summary ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toTraceEventRecord(row: TraceEventRow): TraceEventRecord {
  return traceEventRecordSchema.parse({
    id: row.id,
    projectId: row.project_id,
    agentRunId: row.agent_run_id ?? undefined,
    codexTaskId: row.codex_task_id ?? undefined,
    buildJobId: row.build_job_id ?? undefined,
    type: row.type,
    visibility: row.visibility,
    message: row.message,
    payload: row.payload ?? {},
    createdAt: toIso(row.created_at)
  });
}

function toConnectorAccount(row: ConnectorAccountRow): ConnectorAccount {
  return connectorAccountSchema.parse({
    id: row.id,
    userId: row.user_id,
    connector: row.connector,
    externalUserId: row.external_user_id ?? undefined,
    externalUsername: row.external_username ?? undefined,
    scopes: row.scopes ?? [],
    tokenEncrypted: row.token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted ?? undefined,
    expiresAt: row.expires_at ? toIso(row.expires_at) : undefined,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

function toSupabaseConfigRecord(row: ProjectConnectorRow): SupabaseConfigRecord {
  return supabaseConfigRecordSchema.parse({
    projectId: row.project_id,
    supabaseUrl: row.config_json.supabaseUrl,
    anonKey: row.config_json.anonKey,
    serviceRoleKeyEncrypted: row.config_json.serviceRoleKeyEncrypted,
    frontendEnvConfirmedAt: row.config_json.frontendEnvConfirmedAt,
    lastConnectionStatus: row.config_json.lastConnectionStatus,
    lastConnectionDetail: row.config_json.lastConnectionDetail,
    lastConnectionHttpStatus: row.config_json.lastConnectionHttpStatus,
    lastConnectionCheckedAt: row.config_json.lastConnectionCheckedAt,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  });
}

async function firstRow<T extends Record<string, unknown>>(query: Promise<{ rows: T[] }>): Promise<T | undefined> {
  const result = await query;
  return result.rows[0];
}

export function createPostgresStore(db: Queryable, close?: () => Promise<void>): AppStore {
  async function ensureUser(user: UserProfile): Promise<UserProfile> {
    const row = await firstRow(
      db.query<UserRow>(
        `insert into users (id, email, name, role, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (email) do update
         set name = excluded.name,
             role = excluded.role,
             updated_at = now()
         returning id, email, name, role`,
        [user.id, user.email, user.name ?? null, user.role]
      )
    );

    if (!row) {
      throw new Error('Failed to upsert user');
    }

    return toUser(row);
  }

  return {
    ensureUser,

    async getLocalAuthUserByEmail(email) {
      const row = await firstRow(
        db.query<UserRow>(
          `select id, email, name, role, password_hash
           from users
           where email = $1
           limit 1`,
          [email.trim().toLowerCase()]
        )
      );

      if (!row) {
        return undefined;
      }

      return {
        user: toUser(row),
        passwordHash: row.password_hash ?? undefined
      };
    },

    async upsertLocalAuthUser(input) {
      const row = await firstRow(
        db.query<UserRow>(
          `insert into users (email, name, role, password_hash, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (email) do update
           set name = excluded.name,
               password_hash = excluded.password_hash,
               updated_at = now()
           returning id, email, name, role`,
          [input.email.trim().toLowerCase(), input.name, input.role ?? 'creator', input.passwordHash]
        )
      );

      if (!row) {
        throw new Error('Failed to upsert local auth user');
      }

      return toUser(row);
    },

    async createAuthSession(input) {
      await db.query(
        `insert into auth_sessions (token_hash, user_id, expires_at, created_at)
         values ($1, $2, $3, now())
         on conflict (token_hash) do update
         set user_id = excluded.user_id,
             expires_at = excluded.expires_at`,
        [input.tokenHash, input.userId, input.expiresAt]
      );
    },

    async getAuthSession(tokenHash) {
      const row = await firstRow(
        db.query<AuthSessionRow>(
          `select s.user_id, s.expires_at, u.id, u.email, u.name, u.role
           from auth_sessions s
           join users u on u.id = s.user_id
           where s.token_hash = $1 and s.expires_at > now()
           limit 1`,
          [tokenHash]
        )
      );

      if (!row) {
        return undefined;
      }

      return {
        user: toUser(row),
        expiresAt: toIso(row.expires_at)
      };
    },

    async deleteAuthSession(tokenHash) {
      await db.query('delete from auth_sessions where token_hash = $1', [tokenHash]);
    },

    async getConnectorAccount(userId, connector) {
      const row = await firstRow(
        db.query<ConnectorAccountRow>(
          `select id, user_id, connector, external_user_id, external_username, scopes, token_encrypted,
                  refresh_token_encrypted, expires_at, metadata, created_at, updated_at
           from connector_accounts
           where user_id = $1 and connector = $2
           limit 1`,
          [userId, connector]
        )
      );
      return row ? toConnectorAccount(row) : undefined;
    },

    async upsertConnectorAccount(input) {
      const row = await firstRow(
        db.query<ConnectorAccountRow>(
          `insert into connector_accounts (
             user_id,
             connector,
             external_user_id,
             external_username,
             scopes,
             token_encrypted,
             refresh_token_encrypted,
             expires_at,
             metadata,
             created_at,
             updated_at
           )
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9::jsonb, now(), now())
           on conflict (user_id, connector) do update
           set external_user_id = excluded.external_user_id,
               external_username = excluded.external_username,
               scopes = excluded.scopes,
               token_encrypted = excluded.token_encrypted,
               refresh_token_encrypted = excluded.refresh_token_encrypted,
               expires_at = excluded.expires_at,
               metadata = excluded.metadata,
               updated_at = now()
           returning id, user_id, connector, external_user_id, external_username, scopes, token_encrypted,
                     refresh_token_encrypted, expires_at, metadata, created_at, updated_at`,
          [
            input.userId,
            input.connector,
            input.externalUserId ?? null,
            input.externalUsername ?? null,
            JSON.stringify(input.scopes ?? []),
            input.tokenEncrypted,
            input.refreshTokenEncrypted ?? null,
            input.expiresAt ?? null,
            JSON.stringify(input.metadata ?? {})
          ]
        )
      );

      if (!row) {
        throw new Error('Failed to upsert connector account');
      }

      return toConnectorAccount(row);
    },

    async getProjectSupabaseConfig(projectId) {
      const row = await firstRow(
        db.query<ProjectConnectorRow>(
          `select id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at
           from project_connectors
           where project_id = $1 and connector = 'supabase'
           order by updated_at desc
           limit 1`,
          [projectId]
        )
      );
      return row ? toSupabaseConfigRecord(row) : undefined;
    },

    async upsertProjectSupabaseConfig(projectId, input) {
      const existing = await firstRow(
        db.query<ProjectConnectorRow>(
          `select id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at
           from project_connectors
           where project_id = $1 and connector = 'supabase'
           order by updated_at desc
           limit 1`,
          [projectId]
        )
      );
      const frontendEnvStillMatches =
        existing?.config_json.supabaseUrl === input.supabaseUrl && existing?.config_json.anonKey === input.anonKey;
      const config = {
        supabaseUrl: input.supabaseUrl,
        anonKey: input.anonKey,
        serviceRoleKeyEncrypted: input.serviceRoleKeyEncrypted ?? existing?.config_json.serviceRoleKeyEncrypted,
        frontendEnvConfirmedAt: frontendEnvStillMatches ? existing?.config_json.frontendEnvConfirmedAt : undefined,
        lastConnectionStatus: frontendEnvStillMatches ? existing?.config_json.lastConnectionStatus : undefined,
        lastConnectionDetail: frontendEnvStillMatches ? existing?.config_json.lastConnectionDetail : undefined,
        lastConnectionHttpStatus: frontendEnvStillMatches ? existing?.config_json.lastConnectionHttpStatus : undefined,
        lastConnectionCheckedAt: frontendEnvStillMatches ? existing?.config_json.lastConnectionCheckedAt : undefined
      };
      const row = existing
        ? await firstRow(
            db.query<ProjectConnectorRow>(
              `update project_connectors
               set config_json = $2::jsonb,
                   status = 'connected',
                   updated_at = now()
               where id = $1
               returning id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at`,
              [existing.id, JSON.stringify(config)]
            )
          )
        : await firstRow(
            db.query<ProjectConnectorRow>(
              `insert into project_connectors (project_id, connector, config_json, status, created_at, updated_at)
               values ($1, 'supabase', $2::jsonb, 'connected', now(), now())
               returning id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at`,
              [projectId, JSON.stringify(config)]
            )
          );

      if (!row) {
        throw new Error('Failed to upsert Supabase project config');
      }

      return toSupabaseConfigRecord(row);
    },

    async recordProjectSupabaseConnectionTest(projectId, result) {
      const existing = await firstRow(
        db.query<ProjectConnectorRow>(
          `select id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at
           from project_connectors
           where project_id = $1 and connector = 'supabase'
           order by updated_at desc
           limit 1`,
          [projectId]
        )
      );

      if (!existing) {
        return undefined;
      }

      const config = {
        ...existing.config_json,
        lastConnectionStatus: result.status,
        lastConnectionDetail: result.detail,
        lastConnectionHttpStatus: result.httpStatus,
        lastConnectionCheckedAt: result.checkedAt
      };
      const row = await firstRow(
        db.query<ProjectConnectorRow>(
          `update project_connectors
           set config_json = $2::jsonb,
               updated_at = now()
           where id = $1
           returning id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at`,
          [existing.id, JSON.stringify(config)]
        )
      );

      return row ? toSupabaseConfigRecord(row) : undefined;
    },

    async confirmProjectSupabaseFrontendEnv(projectId) {
      const existing = await firstRow(
        db.query<ProjectConnectorRow>(
          `select id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at
           from project_connectors
           where project_id = $1 and connector = 'supabase'
           order by updated_at desc
           limit 1`,
          [projectId]
        )
      );

      if (!existing) {
        return undefined;
      }

      const config = {
        ...existing.config_json,
        frontendEnvConfirmedAt: new Date().toISOString()
      };
      const row = await firstRow(
        db.query<ProjectConnectorRow>(
          `update project_connectors
           set config_json = $2::jsonb,
               updated_at = now()
           where id = $1
           returning id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at`,
          [existing.id, JSON.stringify(config)]
        )
      );

      return row ? toSupabaseConfigRecord(row) : undefined;
    },

    async listProjectSupabaseConfigs() {
      const result = await db.query<ProjectConnectorRow>(
        `select id, project_id, connector_account_id, connector, config_json, status, created_at, updated_at
         from project_connectors
         where connector = 'supabase'
         order by updated_at desc`
      );
      return result.rows.map(toSupabaseConfigRecord);
    },

    async listUsers() {
      const result = await db.query<UserRow>(
        `select id, email, name, role
         from users
         order by created_at asc`
      );
      return result.rows.map(toUser);
    },

    async listProjectsForUser(user) {
      const storedUser = await ensureUser(user);
      const result = await db.query<ProjectRow>(
        `select p.id, p.owner_id, p.name, p.description, p.status, p.target, p.deployment_url,
                p.github_repo_full_name, p.github_commit_sha, p.created_at, p.updated_at
         from projects p
         where p.owner_id = $1 or $2 = 'admin'
         order by p.updated_at desc`,
        [storedUser.id, storedUser.role]
      );
      return result.rows.map(toProjectSummary);
    },

    async listAllProjects() {
      const result = await db.query<ProjectRow>(
        `select id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                github_commit_sha, created_at, updated_at
         from projects
         order by updated_at desc`
      );
      return result.rows.map(toProjectSummary);
    },

    async createProject(user, input) {
      const storedUser = await ensureUser(user);
      const row = await firstRow(
        db.query<ProjectRow>(
          `insert into projects (owner_id, name, description, target, status, created_at, updated_at)
           values ($1, $2, $3, $4, 'draft', now(), now())
           returning id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                     github_commit_sha, created_at, updated_at`,
          [storedUser.id, input.name, input.prompt, input.target]
        )
      );

      if (!row) {
        throw new Error('Failed to create project');
      }

      return toProjectDetail(row);
    },

    async getProjectById(user, projectId) {
      const storedUser = await ensureUser(user);
      const row = await firstRow(
        db.query<ProjectRow>(
          `select p.id, p.owner_id, p.name, p.description, p.status, p.target, p.deployment_url,
                  p.github_repo_full_name, p.github_commit_sha, p.created_at, p.updated_at
           from projects p
           where p.id = $1 and (p.owner_id = $2 or $3 = 'admin')
           limit 1`,
          [projectId, storedUser.id, storedUser.role]
        )
      );
      return row ? toProjectDetail(row) : undefined;
    },

    async updateProject(user, projectId, input: UpdateProjectInput) {
      const storedUser = await ensureUser(user);
      const existingRow = await firstRow(
        db.query<ProjectRow>(
          `select p.id, p.owner_id, p.name, p.description, p.status, p.target, p.deployment_url,
                  p.github_repo_full_name, p.github_commit_sha, p.created_at, p.updated_at
           from projects p
           where p.id = $1 and (p.owner_id = $2 or $3 = 'admin')
           limit 1`,
          [projectId, storedUser.id, storedUser.role]
        )
      );

      if (!existingRow) {
        return undefined;
      }

      const existing = toProjectDetail(existingRow);
      const row = await firstRow(
        db.query<ProjectRow>(
          `update projects
           set name = $1,
               description = $2,
               status = $3,
               target = $4,
               updated_at = now()
           where id = $5
           returning id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                     github_commit_sha, created_at, updated_at`,
          [
            input.name ?? existing.name,
            input.prompt ?? existing.prompt,
            input.status ?? existing.status,
            input.target ?? existing.target,
            projectId
          ]
        )
      );

      return row ? toProjectDetail(row) : undefined;
    },

    async setProjectStatus(projectId: string, status: ProjectStatus) {
      const row = await firstRow(
        db.query<ProjectRow>(
          `update projects
           set status = $1,
               updated_at = now()
           where id = $2
           returning id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                     github_commit_sha, created_at, updated_at`,
          [status, projectId]
        )
      );
      return row ? toProjectDetail(row) : undefined;
    },

    async createAgentRun(input) {
      const row = await firstRow(
        db.query<AgentRunRow>(
          `insert into agent_runs (project_id, purpose, provider, status, input_json, created_at, updated_at)
           values ($1, $2, $3, $4, $5, now(), now())
           returning id, project_id, purpose, provider, status, input_json, output_json, error_type, error_message, created_at, updated_at`,
          [input.projectId, input.purpose, input.provider, input.status, input.inputSnapshot]
        )
      );

      if (!row) {
        throw new Error('Failed to create agent run');
      }

      return toAgentRun(row);
    },

    async updateAgentRun(agentRunId, input) {
      const row = await firstRow(
        db.query<AgentRunRow>(
          `update agent_runs
           set status = coalesce($2, status),
               output_json = coalesce($3::jsonb, output_json),
               error_type = coalesce($4, error_type),
               error_message = coalesce($5, error_message),
               updated_at = now(),
               finished_at = case when $2 in ('succeeded', 'failed', 'cancelled') then now() else finished_at end
           where id = $1
           returning id, project_id, purpose, provider, status, input_json, output_json, error_type, error_message, created_at, updated_at`,
          [
            agentRunId,
            input.status ?? null,
            input.outputSnapshot ?? null,
            input.errorType ?? null,
            input.errorMessage ?? null
          ]
        )
      );
      return row ? toAgentRun(row) : undefined;
    },

    async createAgentMessage(input) {
      const row = await firstRow(
        db.query<AgentMessageRow>(
          `insert into agent_messages (project_id, user_id, content, status, related_task_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, now(), now())
           returning id, project_id, user_id, content, status, related_task_id, created_at, updated_at`,
          [input.projectId, input.userId, input.content, input.status, input.relatedTaskId ?? null]
        )
      );

      if (!row) {
        throw new Error('Failed to create agent message');
      }

      return toAgentMessageRecord(row);
    },

    async listAgentMessages(projectId, limit) {
      const result = await db.query<AgentMessageRow>(
        `select id, project_id, user_id, content, status, related_task_id, created_at, updated_at
         from agent_messages
         where project_id = $1
         order by created_at desc
         limit $2`,
        [projectId, limit]
      );
      return result.rows.map(toAgentMessageRecord);
    },

    async countDeferredAgentMessages(projectId) {
      const row = await firstRow(
        db.query<{ count: string }>(
          `select count(*)::int as count
           from agent_messages
           where project_id = $1 and status = 'deferred'`,
          [projectId]
        )
      );
      return Number(row?.count ?? 0);
    },

    async getNextDeferredAgentMessage(projectId) {
      const row = await firstRow(
        db.query<AgentMessageRow>(
          `select id, project_id, user_id, content, status, related_task_id, created_at, updated_at
           from agent_messages
           where project_id = $1 and status = 'deferred'
           order by created_at asc
           limit 1`,
          [projectId]
        )
      );
      return row ? toAgentMessageRecord(row) : undefined;
    },

    async updateAgentMessage(messageId, input) {
      const row = await firstRow(
        db.query<AgentMessageRow>(
          `update agent_messages
           set status = coalesce($2, status),
               related_task_id = coalesce($3, related_task_id),
               updated_at = now()
           where id = $1
           returning id, project_id, user_id, content, status, related_task_id, created_at, updated_at`,
          [messageId, input.status ?? null, input.relatedTaskId ?? null]
        )
      );
      return row ? toAgentMessageRecord(row) : undefined;
    },

    async updateAgentMessageByTask(taskId, input) {
      const row = await firstRow(
        db.query<AgentMessageRow>(
          `update agent_messages
           set status = coalesce($2, status),
               updated_at = now()
           where related_task_id = $1
           returning id, project_id, user_id, content, status, related_task_id, created_at, updated_at`,
          [taskId, input.status ?? null]
        )
      );
      return row ? toAgentMessageRecord(row) : undefined;
    },

    async createModelInvocation(input) {
      const row = await firstRow(
        db.query<ModelInvocationRow>(
          `insert into model_invocations (
             project_id,
             agent_run_id,
             provider,
             model,
             purpose,
             status,
             input_tokens,
             output_tokens,
             duration_ms,
             estimated_cost_cny,
             budget_limit_cny,
             error_type,
             error_message,
             created_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
           returning id, project_id, agent_run_id, provider, model, purpose, status, input_tokens, output_tokens,
                     duration_ms, estimated_cost_cny, budget_limit_cny, error_type, error_message, created_at`,
          [
            input.projectId,
            input.agentRunId,
            input.provider,
            input.model,
            input.purpose,
            input.status,
            input.inputTokens,
            input.outputTokens,
            input.durationMs,
            input.estimatedCostCny,
            input.budgetLimitCny,
            input.errorType ?? null,
            input.errorMessage ?? null
          ]
        )
      );

      if (!row) {
        throw new Error('Failed to create model invocation');
      }

      return toModelInvocation(row);
    },

    async createAppSpec(input) {
      const versionRow = await firstRow(
        db.query<{ next_version: number }>(
          `select coalesce(max(version), 0) + 1 as next_version
           from app_specs
           where project_id = $1`,
          [input.projectId]
        )
      );
      const version = Number(versionRow?.next_version ?? 1);
      const row = await firstRow(
        db.query<AppSpecRow>(
          `insert into app_specs (project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at)
           values ($1, $2, $3, 'validated', $4, '[]'::jsonb, now(), now())
           returning id, project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at`,
          [input.projectId, input.sourceAgentRunId, version, input.spec]
        )
      );

      if (!row) {
        throw new Error('Failed to create AppSpec');
      }

      return toAppSpecRecord(row);
    },

    async updateLatestAppSpec(input) {
      const latest = await firstRow(
        db.query<AppSpecRow>(
          `select id, project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at
           from app_specs
           where project_id = $1
           order by version desc
           limit 1`,
          [input.projectId]
        )
      );

      if (!latest) {
        return undefined;
      }

      const versionRow = await firstRow(
        db.query<{ next_version: number }>(
          `select coalesce(max(version), 0) + 1 as next_version
           from app_specs
           where project_id = $1`,
          [input.projectId]
        )
      );
      const row = await firstRow(
        db.query<AppSpecRow>(
          `insert into app_specs (project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at)
           values ($1, $2, $3, 'validated', $4, '[]'::jsonb, now(), now())
           returning id, project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at`,
          [input.projectId, latest.source_agent_run_id, Number(versionRow?.next_version ?? 1), input.spec]
        )
      );

      return row ? toAppSpecRecord(row) : undefined;
    },

    async confirmAppSpec(input) {
      const row = await firstRow(
        db.query<AppSpecRow>(
          `update app_specs
           set status = 'confirmed',
               updated_at = now()
           where project_id = $1 and id = $2
           returning id, project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at`,
          [input.projectId, input.specId]
        )
      );

      return row ? toAppSpecRecord(row) : undefined;
    },

    async getLatestAppSpec(projectId) {
      const row = await firstRow(
        db.query<AppSpecRow>(
          `select id, project_id, source_agent_run_id, version, status, spec_json, validation_errors, created_at, updated_at
           from app_specs
           where project_id = $1
           order by version desc
           limit 1`,
          [projectId]
        )
      );
      return row ? toAppSpecRecord(row) : undefined;
    },

    async createDesignProfiles(input) {
      const versionRow = await firstRow(
        db.query<{ next_version: number }>(
          `select coalesce(max(version), 0) + 1 as next_version
           from design_profiles
           where project_id = $1`,
          [input.projectId]
        )
      );
      const firstVersion = Number(versionRow?.next_version ?? 1);
      const records: DesignProfileRecord[] = [];

      for (const [index, profile] of input.profiles.entries()) {
        const row = await firstRow(
          db.query<DesignProfileRow>(
            `insert into design_profiles (project_id, spec_version_id, version, profile_json, selected, created_at)
             values ($1, $2, $3, $4::jsonb, false, now())
             returning id, project_id, spec_version_id, version, profile_json, selected, created_at`,
            [input.projectId, input.specVersionId, firstVersion + index, JSON.stringify(profile)]
          )
        );

        if (!row) {
          throw new Error('Failed to create design profile');
        }

        records.push(toDesignProfileRecord(row));
      }

      return records;
    },

    async listDesignProfiles(projectId) {
      const result = await db.query<DesignProfileRow>(
        `select id, project_id, spec_version_id, version, profile_json, selected, created_at
         from design_profiles
         where project_id = $1
         order by version asc`,
        [projectId]
      );
      return result.rows.map(toDesignProfileRecord);
    },

    async selectDesignProfile(projectId, designId) {
      await db.query(
        `update design_profiles
         set selected = false
         where project_id = $1`,
        [projectId]
      );
      const row = await firstRow(
        db.query<DesignProfileRow>(
          `update design_profiles
           set selected = true
           where project_id = $1 and id = $2
           returning id, project_id, spec_version_id, version, profile_json, selected, created_at`,
          [projectId, designId]
        )
      );
      return row ? toDesignProfileRecord(row) : undefined;
    },

    async getSelectedDesignProfile(projectId) {
      const row = await firstRow(
        db.query<DesignProfileRow>(
          `select id, project_id, spec_version_id, version, profile_json, selected, created_at
           from design_profiles
           where project_id = $1 and selected = true
           order by version desc
           limit 1`,
          [projectId]
        )
      );
      return row ? toDesignProfileRecord(row) : undefined;
    },

    async saveGeneratedProject(input) {
      const versionRow = await firstRow(
        db.query<{ next_version: number }>(
          `select coalesce(max(version), 0) + 1 as next_version
           from project_versions
           where project_id = $1`,
          [input.projectId]
        )
      );
      const changedFiles = input.files.map((file) => file.path);
      const projectVersionRow = await firstRow(
        db.query<ProjectVersionRow>(
          `insert into project_versions (
             project_id, version, source, summary, changed_files, spec_version_id, design_profile_id,
             workspace_path, parent_version_id, created_at
           )
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, now())
           returning id, project_id, version, source, summary, changed_files, spec_version_id, design_profile_id, workspace_path, parent_version_id, created_at`,
          [
            input.projectId,
            Number(versionRow?.next_version ?? 1),
            input.source ?? 'initial_generate',
            input.summary,
            JSON.stringify(changedFiles),
            input.specVersionId ?? null,
            input.designProfileId ?? null,
            input.workspacePath ?? null,
            input.parentVersionId ?? null
          ]
        )
      );

      if (!projectVersionRow) {
        throw new Error('Failed to create project version');
      }

      const savedFiles: ProjectFileRecord[] = [];
      for (const file of input.files) {
        const row = await firstRow(
          db.query<ProjectFileRow>(
            `insert into project_files (project_id, path, content, content_hash, version, created_at, updated_at)
             values ($1, $2, $3, $4, 1, now(), now())
             on conflict (project_id, path) do update
             set content = excluded.content,
                 content_hash = excluded.content_hash,
                 version = project_files.version + 1,
                 updated_at = now()
             returning id, project_id, path, content, content_hash, version, created_at, updated_at`,
            [input.projectId, file.path, file.content, hashContent(file.content)]
          )
        );

        if (!row) {
          throw new Error(`Failed to save generated file: ${file.path}`);
        }

        savedFiles.push(toProjectFileRecord(row));
      }

      await db.query(
        `insert into ai_manifests (project_id, project_version_id, manifest_json, created_at)
         values ($1, $2, $3::jsonb, now())`,
        [input.projectId, projectVersionRow.id, JSON.stringify(input.manifest)]
      );
      await db.query(
        `update projects
         set current_project_version_id = $2,
             updated_at = now()
         where id = $1`,
        [input.projectId, projectVersionRow.id]
      );

      return {
        projectVersion: toProjectVersionRecord(projectVersionRow),
        files: savedFiles
      };
    },

    async saveProjectFilePatch(input) {
      const versionRow = await firstRow(
        db.query<{ next_version: number }>(
          `select coalesce(max(version), 0) + 1 as next_version
           from project_versions
           where project_id = $1`,
          [input.projectId]
        )
      );
      const changedFiles = input.files.map((file) => file.path);
      const projectVersionRow = await firstRow(
        db.query<ProjectVersionRow>(
          `insert into project_versions (
             project_id, version, source, summary, changed_files, workspace_path, parent_version_id, created_at
           )
           values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
           returning id, project_id, version, source, summary, changed_files, spec_version_id, design_profile_id, workspace_path, parent_version_id, created_at`,
          [
            input.projectId,
            Number(versionRow?.next_version ?? 1),
            input.source,
            input.summary,
            JSON.stringify(changedFiles),
            input.workspacePath ?? null,
            input.parentVersionId ?? null
          ]
        )
      );

      if (!projectVersionRow) {
        throw new Error('Failed to create project patch version');
      }

      const savedFiles: ProjectFileRecord[] = [];
      for (const file of input.files) {
        const row = await firstRow(
          db.query<ProjectFileRow>(
            `insert into project_files (project_id, path, content, content_hash, version, created_at, updated_at)
             values ($1, $2, $3, $4, 1, now(), now())
             on conflict (project_id, path) do update
             set content = excluded.content,
                 content_hash = excluded.content_hash,
                 version = project_files.version + 1,
                 updated_at = now()
             returning id, project_id, path, content, content_hash, version, created_at, updated_at`,
            [input.projectId, file.path, file.content, hashContent(file.content)]
          )
        );

        if (!row) {
          throw new Error(`Failed to save patched file: ${file.path}`);
        }

        savedFiles.push(toProjectFileRecord(row));
      }

      if (input.manifest) {
        await db.query(
          `insert into ai_manifests (project_id, project_version_id, manifest_json, created_at)
           values ($1, $2, $3::jsonb, now())`,
          [input.projectId, projectVersionRow.id, JSON.stringify(input.manifest)]
        );
      }

      await db.query(
        `update projects
         set current_project_version_id = $2,
             updated_at = now()
         where id = $1`,
        [input.projectId, projectVersionRow.id]
      );

      return {
        projectVersion: toProjectVersionRecord(projectVersionRow),
        files: savedFiles
      };
    },

    async listProjectFiles(projectId) {
      const result = await db.query<ProjectFileRow>(
        `select id, project_id, path, content, content_hash, version, created_at, updated_at
         from project_files
         where project_id = $1
         order by path asc`,
        [projectId]
      );
      return result.rows.map(toProjectFileRecord);
    },

    async listProjectVersions(projectId) {
      const result = await db.query<ProjectVersionRow>(
        `select id, project_id, version, source, summary, changed_files, spec_version_id, design_profile_id,
                workspace_path, parent_version_id, created_at
         from project_versions
         where project_id = $1
         order by version desc`,
        [projectId]
      );
      return result.rows.map(toProjectVersionRecord);
    },

    async getProjectFile(projectId, path) {
      const row = await firstRow(
        db.query<ProjectFileRow>(
          `select id, project_id, path, content, content_hash, version, created_at, updated_at
           from project_files
           where project_id = $1 and path = $2
           limit 1`,
          [projectId, path]
        )
      );
      return row ? toProjectFileRecord(row) : undefined;
    },

    async createBuildJob(projectId, input) {
      const row = await firstRow(
        db.query<BuildJobRow>(
          `insert into build_jobs (project_id, project_version_id, status, created_at)
           values ($1, $2, 'queued', now())
           returning id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at`,
          [projectId, input.projectVersionId ?? null]
        )
      );

      if (!row) {
        throw new Error('Failed to create build job');
      }

      return toBuildJobRecord(row);
    },

    async getBuildJob(projectId, buildJobId) {
      const row = await firstRow(
        db.query<BuildJobRow>(
          `select id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at
           from build_jobs
           where project_id = $1 and id = $2
           limit 1`,
          [projectId, buildJobId]
        )
      );
      return row ? toBuildJobRecord(row) : undefined;
    },

    async getLatestBuildJob(projectId) {
      const row = await firstRow(
        db.query<BuildJobRow>(
          `select id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at
           from build_jobs
           where project_id = $1
           order by created_at desc
           limit 1`,
          [projectId]
        )
      );
      return row ? toBuildJobRecord(row) : undefined;
    },

    async listStaleBuildJobs(cutoffIso, limit) {
      const result = await db.query<BuildJobRow>(
        `select id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at
         from build_jobs
         where status in ('queued', 'running')
           and coalesce(started_at, created_at) < $1::timestamptz
         order by coalesce(started_at, created_at) asc
         limit $2`,
        [cutoffIso, limit]
      );
      return result.rows.map(toBuildJobRecord);
    },

    async updateBuildJob(buildJobId, input) {
      const row = await firstRow(
        db.query<BuildJobRow>(
          `update build_jobs
           set status = coalesce($2, status),
               command = coalesce($3, command),
               preview_url = coalesce($4, preview_url),
               error_summary = coalesce($5, error_summary),
               started_at = coalesce($6::timestamptz, started_at),
               finished_at = coalesce($7::timestamptz, finished_at)
           where id = $1
           returning id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at`,
          [
            buildJobId,
            input.status ?? null,
            input.command ?? null,
            input.previewUrl ?? null,
            input.errorSummary ?? null,
            input.startedAt ?? null,
            input.finishedAt ?? null
          ]
        )
      );
      return row ? toBuildJobRecord(row) : undefined;
    },

    async createWorkspace(input) {
      const row = await firstRow(
        db.query<WorkspaceRow>(
          `insert into workspaces (project_id, project_version_id, path, status, created_at, updated_at)
           values ($1, $2, $3, $4, now(), now())
           returning id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at`,
          [input.projectId, input.projectVersionId ?? null, input.path, input.status ?? 'creating']
        )
      );

      if (!row) {
        throw new Error('Failed to create workspace');
      }

      return toWorkspaceRecord(row);
    },

    async listWorkspaces(projectId) {
      const result = await db.query<WorkspaceRow>(
        `select id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at
         from workspaces
         where project_id = $1
         order by updated_at desc`,
        [projectId]
      );
      return result.rows.map(toWorkspaceRecord);
    },

    async getWorkspace(workspaceId) {
      const row = await firstRow(
        db.query<WorkspaceRow>(
          `select id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at
           from workspaces
           where id = $1
           limit 1`,
          [workspaceId]
        )
      );
      return row ? toWorkspaceRecord(row) : undefined;
    },

    async updateWorkspace(workspaceId, input) {
      const row = await firstRow(
        db.query<WorkspaceRow>(
          `update workspaces
           set project_version_id = coalesce($2, project_version_id),
               path = coalesce($3, path),
               status = coalesce($4, status),
               locked_by = coalesce($5, locked_by),
               error_summary = coalesce($6, error_summary),
               updated_at = now()
           where id = $1
           returning id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at`,
          [
            workspaceId,
            input.projectVersionId ?? null,
            input.path ?? null,
            input.status ?? null,
            input.lockedBy ?? null,
            input.errorSummary ?? null
          ]
        )
      );
      return row ? toWorkspaceRecord(row) : undefined;
    },

    async lockWorkspace(workspaceId, lockedBy) {
      const row = await firstRow(
        db.query<WorkspaceRow>(
          `update workspaces
           set status = 'locked',
               locked_by = $2,
               updated_at = now()
           where id = $1
           returning id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at`,
          [workspaceId, lockedBy]
        )
      );
      return row ? toWorkspaceRecord(row) : undefined;
    },

    async unlockWorkspace(workspaceId) {
      const row = await firstRow(
        db.query<WorkspaceRow>(
          `update workspaces
           set status = 'ready',
               locked_by = null,
               updated_at = now()
           where id = $1
           returning id, project_id, project_version_id, path, status, locked_by, error_summary, created_at, updated_at`,
          [workspaceId]
        )
      );
      return row ? toWorkspaceRecord(row) : undefined;
    },

    async createCodexTask(input) {
      const row = await firstRow(
        db.query<CodexTaskRow>(
          `insert into codex_tasks (
             project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
             task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, created_at, updated_at
           )
           values ($1, $2, $3, $4, 'queued', $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, 0, now(), now())
           returning id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                     task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                     error_summary, finished_at, created_at, updated_at`,
          [
            input.projectId,
            input.projectVersionId ?? null,
            input.workspaceId ?? null,
            input.taskType,
            input.objective,
            input.inputSummary,
            JSON.stringify(input.taskSpec ?? {}),
            JSON.stringify(input.allowedPaths),
            JSON.stringify(input.forbiddenPaths ?? []),
            JSON.stringify(input.validationCommands)
          ]
        )
      );

      if (!row) {
        throw new Error('Failed to create Codex task');
      }

      return toCodexTaskRecord(row);
    },

    async listCodexTasks(projectId) {
      const result = await db.query<CodexTaskRow>(
        `select id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                error_summary, finished_at, created_at, updated_at
         from codex_tasks
         where project_id = $1
         order by created_at desc`,
        [projectId]
      );
      return result.rows.map(toCodexTaskRecord);
    },

    async getCodexTask(taskId) {
      const row = await firstRow(
        db.query<CodexTaskRow>(
          `select id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                  task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                  error_summary, finished_at, created_at, updated_at
           from codex_tasks
           where id = $1
           limit 1`,
          [taskId]
        )
      );
      return row ? toCodexTaskRecord(row) : undefined;
    },

    async claimCodexTask(taskId, workerId) {
      const row = await firstRow(
        db.query<CodexTaskRow>(
          `update codex_tasks
           set status = 'claimed',
               claimed_by = $1,
               claimed_at = now(),
               attempt_count = attempt_count + 1,
               updated_at = now()
           where id = (
             select candidate.id
             from codex_tasks candidate
             where candidate.id = $2
               and candidate.status = 'queued'
               and not exists (
                 select 1
                 from codex_tasks active
                 where active.project_id = candidate.project_id
                   and active.id <> candidate.id
                   and active.status in ('claimed', 'preparing_workspace', 'codex_running', 'validating', 'running')
               )
             for update skip locked
             limit 1
           )
           returning id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                     task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                     error_summary, finished_at, created_at, updated_at`,
          [workerId, taskId]
        )
      );
      return row ? toCodexTaskRecord(row) : undefined;
    },

    async claimNextCodexTask(workerId) {
      const row = await firstRow(
        db.query<CodexTaskRow>(
          `update codex_tasks
           set status = 'claimed',
               claimed_by = $1,
               claimed_at = now(),
               attempt_count = attempt_count + 1,
               updated_at = now()
           where id = (
             select candidate.id
             from codex_tasks candidate
             where candidate.status = 'queued'
               and not exists (
                 select 1
                 from codex_tasks active
                 where active.project_id = candidate.project_id
                   and active.status in ('claimed', 'preparing_workspace', 'codex_running', 'validating', 'running')
               )
             order by candidate.created_at asc
             for update skip locked
             limit 1
           )
           returning id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                     task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                     error_summary, finished_at, created_at, updated_at`,
          [workerId]
        )
      );
      return row ? toCodexTaskRecord(row) : undefined;
    },

    async listStaleCodexTasks(cutoffIso, limit) {
      const result = await db.query<CodexTaskRow>(
        `select id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                error_summary, finished_at, created_at, updated_at
         from codex_tasks
         where status in ('claimed', 'preparing_workspace', 'codex_running', 'validating', 'running')
           and updated_at < $1::timestamptz
         order by updated_at asc
         limit $2`,
        [cutoffIso, limit]
      );
      return result.rows.map(toCodexTaskRecord);
    },

    async updateCodexTask(taskId, input) {
      const row = await firstRow(
        db.query<CodexTaskRow>(
          `update codex_tasks
           set status = coalesce($2, status),
               workspace_id = coalesce($3, workspace_id),
               project_version_id = coalesce($4, project_version_id),
               claimed_by = coalesce($5, claimed_by),
               task_spec = coalesce($6::jsonb, task_spec),
               attempt_count = coalesce($7, attempt_count),
               result_summary = coalesce($8, result_summary),
               error_summary = coalesce($9, error_summary),
               finished_at = coalesce($10::timestamptz, finished_at),
               updated_at = now()
           where id = $1
           returning id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                     task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                     error_summary, finished_at, created_at, updated_at`,
          [
            taskId,
            input.status ?? null,
            input.workspaceId ?? null,
            input.projectVersionId ?? null,
            input.claimedBy ?? null,
            input.taskSpec ? JSON.stringify(input.taskSpec) : null,
            input.attemptCount ?? null,
            input.resultSummary ?? null,
            input.errorSummary ?? null,
            input.finishedAt ?? null
          ]
        )
      );
      return row ? toCodexTaskRecord(row) : undefined;
    },

    async createPreviewSnapshot(input) {
      if (input.active) {
        await db.query('update preview_snapshots set active = false, updated_at = now() where project_id = $1', [input.projectId]);
      }

      const row = await firstRow(
        db.query<PreviewSnapshotRow>(
          `insert into preview_snapshots (
             project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
           returning id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at`,
          [
            input.projectId,
            input.projectVersionId,
            input.buildJobId ?? null,
            input.status,
            input.path,
            input.url,
            input.active ?? false,
            input.errorSummary ?? null
          ]
        )
      );

      if (!row) {
        throw new Error('Failed to create preview snapshot');
      }

      return toPreviewSnapshotRecord(row);
    },

    async listPreviewSnapshots(projectId) {
      const result = await db.query<PreviewSnapshotRow>(
        `select id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at
         from preview_snapshots
         where project_id = $1
         order by created_at desc`,
        [projectId]
      );
      return result.rows.map(toPreviewSnapshotRecord);
    },

    async getLatestPreviewSnapshot(projectId) {
      const row = await firstRow(
        db.query<PreviewSnapshotRow>(
          `select id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at
           from preview_snapshots
           where project_id = $1
           order by created_at desc
           limit 1`,
          [projectId]
        )
      );
      return row ? toPreviewSnapshotRecord(row) : undefined;
    },

    async activatePreviewSnapshot(snapshotId) {
      const existing = await firstRow(
        db.query<PreviewSnapshotRow>(
          `select id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at
           from preview_snapshots
           where id = $1
           limit 1`,
          [snapshotId]
        )
      );

      if (!existing) {
        return undefined;
      }

      await db.query('update preview_snapshots set active = false, updated_at = now() where project_id = $1', [existing.project_id]);
      const row = await firstRow(
        db.query<PreviewSnapshotRow>(
          `update preview_snapshots
           set active = true,
               updated_at = now()
           where id = $1
           returning id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at`,
          [snapshotId]
        )
      );
      return row ? toPreviewSnapshotRecord(row) : undefined;
    },

    async appendTraceEvent(input) {
      const row = await firstRow(
        db.query<TraceEventRow>(
          `insert into trace_events (
             project_id, agent_run_id, codex_task_id, build_job_id, type, visibility, message, payload, created_at
           )
           values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())
           returning id, project_id, agent_run_id, codex_task_id, build_job_id, type, visibility, message, payload, created_at`,
          [
            input.projectId,
            input.agentRunId ?? null,
            input.codexTaskId ?? null,
            input.buildJobId ?? null,
            input.type,
            input.visibility,
            input.message,
            JSON.stringify(input.payload ?? {})
          ]
        )
      );

      if (!row) {
        throw new Error('Failed to append trace event');
      }

      return toTraceEventRecord(row);
    },

    async listTraceEvents(projectId, limit) {
      const result = await db.query<TraceEventRow>(
        `select id, project_id, agent_run_id, codex_task_id, build_job_id, type, visibility, message, payload, created_at
         from trace_events
         where project_id = $1
         order by created_at desc
         limit $2`,
        [projectId, limit]
      );
      return result.rows.map(toTraceEventRecord);
    },

    async updateProjectDeploymentUrl(projectId: string, input: UpdateProjectDeploymentInput) {
      const row = await firstRow(
        db.query<ProjectRow>(
          `update projects
           set deployment_url = $2,
               status = 'deployed',
               updated_at = now()
           where id = $1
           returning id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                     github_commit_sha, created_at, updated_at`,
          [projectId, input.deploymentUrl]
        )
      );
      return row ? toProjectDetail(row) : undefined;
    },

    async updateProjectGitHubCommit(projectId: string, input: { repoFullName: string; commitSha: string }) {
      const row = await firstRow(
        db.query<ProjectRow>(
          `update projects
           set github_repo_full_name = $2,
               github_commit_sha = $3,
               updated_at = now()
           where id = $1
           returning id, owner_id, name, description, status, target, deployment_url, github_repo_full_name,
                     github_commit_sha, created_at, updated_at`,
          [projectId, input.repoFullName, input.commitSha]
        )
      );
      return row ? toProjectDetail(row) : undefined;
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

    async appendBuildLog(input) {
      const row = await firstRow(
        db.query<BuildLogRow>(
          `insert into build_logs (build_job_id, stream, line, created_at)
           values ($1, $2, $3, now())
           returning id, build_job_id, stream, line, created_at`,
          [input.buildJobId, input.stream, input.line]
        )
      );

      if (!row) {
        throw new Error('Failed to append build log');
      }

      return toBuildLogRecord(row);
    },

    async listBuildLogs(buildJobId) {
      const result = await db.query<BuildLogRow>(
        `select id, build_job_id, stream, line, created_at
         from build_logs
         where build_job_id = $1
         order by created_at asc, id asc`,
        [buildJobId]
      );
      return result.rows.map(toBuildLogRecord);
    },

    async listRecentAgentRuns(limit) {
      const result = await db.query<AgentRunRow>(
        `select id, project_id, purpose, provider, status, input_json, output_json, error_type, error_message, created_at, updated_at
         from agent_runs
         order by updated_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toAgentRun);
    },

    async listRecentModelInvocations(limit) {
      const result = await db.query<ModelInvocationRow>(
        `select id, project_id, agent_run_id, provider, model, purpose, status, input_tokens, output_tokens, duration_ms,
                estimated_cost_cny, budget_limit_cny, error_type, error_message, created_at
         from model_invocations
         order by created_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toModelInvocation);
    },

    async listRecentBuildJobs(limit) {
      const result = await db.query<BuildJobRow>(
        `select id, project_id, project_version_id, status, command, preview_url, error_summary, started_at, finished_at, created_at
         from build_jobs
         order by created_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toAdminBuildJob);
    },

    async listRecentCodexTasks(limit) {
      const result = await db.query<CodexTaskRow>(
        `select id, project_id, project_version_id, workspace_id, task_type, status, objective, input_summary,
                task_spec, allowed_paths, forbidden_paths, validation_commands, attempt_count, claimed_by, claimed_at, result_summary,
                error_summary, finished_at, created_at, updated_at
         from codex_tasks
         order by created_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toCodexTaskRecord);
    },

    async listRecentPreviewSnapshots(limit) {
      const result = await db.query<PreviewSnapshotRow>(
        `select id, project_id, project_version_id, build_job_id, status, path, url, active, error_summary, created_at, updated_at
         from preview_snapshots
         order by created_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toPreviewSnapshotRecord);
    },

    async listRecentTraceEvents(limit) {
      const result = await db.query<TraceEventRow>(
        `select id, project_id, agent_run_id, codex_task_id, build_job_id, type, visibility, message, payload, created_at
         from trace_events
         order by created_at desc
         limit $1`,
        [limit]
      );
      return result.rows.map(toTraceEventRecord);
    },

    async getEstimatedSpendCny() {
      const row = await firstRow(
        db.query<{ estimated_spend_cny: string | number }>(
          `select coalesce(sum(estimated_cost_cny), 0) as estimated_spend_cny
           from model_invocations`
        )
      );
      return Number(row?.estimated_spend_cny ?? 0);
    },

    async getAdminOverview(model: ModelRuntimeConfig) {
      const counts = await firstRow(
        db.query<{
          users_count: number;
          projects_count: number;
          app_specs_count: number;
          agent_runs_count: number;
          model_invocations_count: number;
          model_calls_today: number;
          estimated_spend_cny: string | number;
        }>(
          `select count(*)::int as users_count,
                  (select count(*)::int from projects) as projects_count,
                  (select count(*)::int from app_specs) as app_specs_count,
                  (select count(*)::int from agent_runs) as agent_runs_count,
                  (select count(*)::int from model_invocations) as model_invocations_count,
                  (select count(*)::int from model_invocations where status = 'succeeded' and created_at >= date_trunc('day', now())) as model_calls_today,
                  (select coalesce(sum(estimated_cost_cny), 0) from model_invocations) as estimated_spend_cny
           from users`
        )
      );
      const recentAgentRunsResult = await db.query<AgentRunRow>(
        `select id, project_id, purpose, provider, status, input_json, output_json, error_type, error_message, created_at, updated_at
         from agent_runs
         order by updated_at desc
         limit $1`,
        [5]
      );
      const recentModelInvocationsResult = await db.query<ModelInvocationRow>(
        `select id, project_id, agent_run_id, provider, model, purpose, status, input_tokens, output_tokens, duration_ms,
                estimated_cost_cny, budget_limit_cny, error_type, error_message, created_at
         from model_invocations
         order by created_at desc
         limit $1`,
        [5]
      );
      const recentAgentRuns = recentAgentRunsResult.rows.map(toAgentRun);
      const recentModelInvocations = recentModelInvocationsResult.rows.map(toModelInvocation);

      return adminOverviewSchema.parse({
        usersCount: counts?.users_count ?? 0,
        projectsCount: counts?.projects_count ?? 0,
        buildJobsToday: 0,
        failedBuildsToday: 0,
        modelCallsToday: counts?.model_calls_today ?? 0,
        estimatedSpendCny: Number(counts?.estimated_spend_cny ?? 0),
        appSpecsCount: counts?.app_specs_count ?? 0,
        agentRunsCount: counts?.agent_runs_count ?? 0,
        modelInvocationsCount: counts?.model_invocations_count ?? 0,
        dataSource: 'postgres',
        modelProvider: model.provider,
        modelBudgetCny: model.budgetCny,
        recentAgentRuns: recentAgentRuns.map((run) => ({
          id: run.id,
          projectId: run.projectId,
          purpose: run.purpose,
          provider: run.provider,
          status: run.status,
          errorType: run.errorType,
          updatedAt: run.updatedAt
        })),
        recentModelInvocations: recentModelInvocations.map((invocation) => ({
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

    async getRuntimeHealth() {
      await db.query('select 1 as ok');
      return {
        database: 'connected'
      };
    },

    close
  };
}

export function createPostgresPoolStore(databaseUrl: string, databaseSchema = 'public'): AppStore {
  const pool = createPool(databaseUrl, databaseSchema);
  return createPostgresStore(pool, () => pool.end());
}

export async function createMigratedPostgresPoolStore(databaseUrl: string, databaseSchema = 'public'): Promise<AppStore> {
  const pool = createPool(databaseUrl, databaseSchema);

  try {
    await runPostgresMigrations(pool, {
      databaseSchema
    });
    return createPostgresStore(pool, () => pool.end());
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export interface RunPostgresMigrationOptions {
  migrationsDir?: string;
  databaseSchema?: string;
}

export async function runPostgresMigrations(
  db: Queryable,
  options: RunPostgresMigrationOptions | string = {}
): Promise<void> {
  const migrationsDir = typeof options === 'string'
    ? options
    : options.migrationsDir ?? fileURLToPath(new URL('../../../../../infra/migrations', import.meta.url));
  const databaseSchema = typeof options === 'string' ? 'public' : options.databaseSchema ?? 'public';

  if (databaseSchema !== 'public') {
    const quotedSchema = quotePostgresIdentifier(databaseSchema);
    await db.query(`create schema if not exists ${quotedSchema}`);
    await db.query(`set search_path to ${quotedSchema}, public`);
  }

  const migration = await readFile(join(migrationsDir, '0001_initial.sql'), 'utf8');
  await db.query(migration);
}

function createPool(databaseUrl: string, databaseSchema: string): Pool {
  validatePostgresIdentifier(databaseSchema);
  return new Pool({
    connectionString: databaseUrl,
    ...(databaseSchema === 'public'
      ? {}
      : {
          options: `-c search_path=${databaseSchema},public`
        })
  });
}

function quotePostgresIdentifier(value: string): string {
  validatePostgresIdentifier(value);
  return `"${value}"`;
}

function validatePostgresIdentifier(value: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`Unsafe Postgres identifier: ${value}`);
  }
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
