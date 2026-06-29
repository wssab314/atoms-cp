import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('../../../../infra/migrations/0001_initial.sql', import.meta.url));

describe('initial migration contract', () => {
  it('contains the M2 AppSpec and observability tables', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists app_specs');
    expect(sql).toContain('create table if not exists model_invocations');
    expect(sql).toContain('create table if not exists worker_heartbeats');
    expect(sql).toContain('create unique index if not exists idx_worker_heartbeats_worker_id');
  });

  it('keeps AgentRun and ModelInvocation fields required by Admin observability', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('purpose text not null');
    expect(sql).toContain('provider text not null');
    expect(sql).toContain('error_type text');
    expect(sql).toContain('estimated_cost_cny numeric');
    expect(sql).toContain('budget_limit_cny numeric');
  });

  it('keeps M6 publish metadata on projects', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('deployment_url text');
    expect(sql).toContain('github_repo_full_name text');
    expect(sql).toContain('github_commit_sha text');
  });

  it('contains the R1 workspace, CodexTask, preview snapshot, and trace tables', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('workspace_path text');
    expect(sql).toContain('parent_version_id text references project_versions(id)');
    expect(sql).toContain('create table if not exists workspaces');
    expect(sql).toContain('create table if not exists codex_tasks');
    expect(sql).toContain('create table if not exists preview_snapshots');
    expect(sql).toContain('create table if not exists trace_events');
    expect(sql).toContain('create table if not exists agent_messages');
    expect(sql).toContain('create index if not exists idx_agent_messages_project_created');
    expect(sql).toContain('create index if not exists idx_codex_tasks_status_created');
    expect(sql).toContain('create unique index if not exists idx_codex_tasks_one_active_writer_per_project');
    expect(sql).toContain("where status in ('claimed', 'preparing_workspace', 'codex_running', 'validating', 'running')");
    expect(sql).toContain('task_spec jsonb not null default');
    expect(sql).toContain('attempt_count integer not null default 0');
    expect(sql).toContain('alter table if exists codex_tasks add column if not exists task_spec');
    expect(sql).toContain('alter table if exists codex_tasks add column if not exists attempt_count');
  });

  it('contains local auth password/session storage for R9.2 local beta', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('password_hash text');
    expect(sql).toContain('alter table if exists users add column if not exists password_hash text');
    expect(sql).toContain('create table if not exists auth_sessions');
    expect(sql).toContain('token_hash text primary key');
    expect(sql).toContain('create index if not exists idx_auth_sessions_user_expires');
  });
});
