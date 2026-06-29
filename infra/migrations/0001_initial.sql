create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text unique not null,
  name text,
  role text not null default 'creator',
  password_hash text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists users add column if not exists password_hash text;

create table if not exists auth_sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  owner_id text references users(id),
  name text not null,
  description text,
  target text not null default 'web',
  status text not null default 'draft',
  current_spec_version_id text,
  current_project_version_id text,
  current_preview_id text,
  deployment_url text,
  github_repo_full_name text,
  github_commit_sha text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists projects add column if not exists deployment_url text;
alter table if exists projects add column if not exists github_repo_full_name text;
alter table if exists projects add column if not exists github_commit_sha text;

create table if not exists agent_runs (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  user_id text references users(id),
  purpose text not null default 'app_spec_generation',
  mode text,
  status text not null default 'running',
  input_json jsonb not null,
  output_json jsonb,
  provider text not null default 'mock',
  model text,
  token_usage jsonb,
  error_type text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  finished_at timestamptz
);

create table if not exists agent_messages (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  content text not null,
  status text not null default 'received',
  related_task_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists app_specs (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  source_agent_run_id text references agent_runs(id),
  version integer not null,
  status text not null default 'validated',
  spec_json jsonb not null,
  validation_errors jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, version)
);

create table if not exists design_profiles (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  spec_version_id text references app_specs(id),
  version integer not null,
  profile_json jsonb not null,
  selected boolean not null default false,
  created_at timestamptz default now(),
  unique(project_id, version)
);

create table if not exists project_versions (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  version integer not null,
  source text not null,
  summary text,
  changed_files jsonb not null default '[]',
  spec_version_id text references app_specs(id),
  design_profile_id text references design_profiles(id),
  workspace_path text,
  parent_version_id text references project_versions(id),
  created_at timestamptz default now(),
  unique(project_id, version)
);

alter table if exists project_versions add column if not exists workspace_path text;
alter table if exists project_versions add column if not exists parent_version_id text references project_versions(id);

create table if not exists project_files (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  path text not null,
  content text not null,
  content_hash text not null,
  version integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, path)
);

create table if not exists ai_manifests (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  project_version_id text references project_versions(id),
  manifest_json jsonb not null,
  created_at timestamptz default now()
);

create table if not exists model_invocations (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  agent_run_id text references agent_runs(id) on delete cascade,
  provider text not null,
  model text not null,
  purpose text not null,
  status text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  duration_ms integer not null default 0,
  estimated_cost_cny numeric(12, 6) not null default 0,
  budget_limit_cny numeric(12, 2) not null default 25,
  error_type text,
  error_message text,
  created_at timestamptz default now()
);

create table if not exists build_jobs (
  id text primary key default gen_random_uuid()::text,
  project_id text references projects(id) on delete cascade,
  project_version_id text,
  status text not null default 'queued',
  command text,
  preview_url text,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists build_logs (
  id text primary key default gen_random_uuid()::text,
  build_job_id text references build_jobs(id) on delete cascade,
  stream text not null,
  line text not null,
  created_at timestamptz default now()
);

create table if not exists workspaces (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  project_version_id text references project_versions(id),
  path text not null,
  status text not null default 'creating',
  locked_by text,
  error_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists codex_tasks (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  project_version_id text references project_versions(id),
  workspace_id text references workspaces(id),
  task_type text not null,
  status text not null default 'queued',
  objective text not null,
  input_summary text not null,
  task_spec jsonb not null default '{}',
  allowed_paths jsonb not null default '[]',
  forbidden_paths jsonb not null default '[]',
  validation_commands jsonb not null default '[]',
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  result_summary text,
  error_summary text,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists codex_tasks add column if not exists task_spec jsonb not null default '{}';
alter table if exists codex_tasks add column if not exists attempt_count integer not null default 0;

create table if not exists preview_snapshots (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  project_version_id text not null references project_versions(id),
  build_job_id text references build_jobs(id),
  status text not null default 'creating',
  path text not null,
  url text not null,
  active boolean not null default false,
  error_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists trace_events (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  agent_run_id text references agent_runs(id) on delete set null,
  codex_task_id text references codex_tasks(id) on delete set null,
  build_job_id text references build_jobs(id) on delete set null,
  type text not null,
  visibility text not null default 'admin',
  message text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);

create table if not exists worker_heartbeats (
  id text primary key default gen_random_uuid()::text,
  worker_id text not null,
  role text not null default 'builder-worker',
  status text not null default 'idle',
  metadata jsonb not null default '{}',
  last_seen_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_projects_owner_status on projects(owner_id, status);
create index if not exists idx_auth_sessions_user_expires on auth_sessions(user_id, expires_at desc);
create index if not exists idx_app_specs_project_version on app_specs(project_id, version desc);
create index if not exists idx_design_profiles_project_version on design_profiles(project_id, version desc);
create index if not exists idx_project_versions_project_version on project_versions(project_id, version desc);
create index if not exists idx_project_files_project_path on project_files(project_id, path);
create index if not exists idx_ai_manifests_project_version on ai_manifests(project_id, project_version_id);
create index if not exists idx_agent_runs_project_created on agent_runs(project_id, created_at desc);
create index if not exists idx_agent_messages_project_created on agent_messages(project_id, created_at desc);
create index if not exists idx_agent_messages_project_status_created on agent_messages(project_id, status, created_at asc);
create index if not exists idx_model_invocations_project_created on model_invocations(project_id, created_at desc);
create index if not exists idx_build_jobs_project_created on build_jobs(project_id, created_at desc);
create index if not exists idx_build_logs_job_created on build_logs(build_job_id, created_at asc);
create index if not exists idx_workspaces_project_updated on workspaces(project_id, updated_at desc);
create index if not exists idx_codex_tasks_project_created on codex_tasks(project_id, created_at desc);
create index if not exists idx_codex_tasks_status_created on codex_tasks(status, created_at asc);
create unique index if not exists idx_codex_tasks_one_active_writer_per_project
  on codex_tasks(project_id)
  where status in ('claimed', 'preparing_workspace', 'codex_running', 'validating', 'running');
create index if not exists idx_preview_snapshots_project_created on preview_snapshots(project_id, created_at desc);
create index if not exists idx_preview_snapshots_project_active on preview_snapshots(project_id, active);
create index if not exists idx_trace_events_project_created on trace_events(project_id, created_at desc);
create unique index if not exists idx_worker_heartbeats_worker_id on worker_heartbeats(worker_id);
create index if not exists idx_worker_heartbeats_last_seen on worker_heartbeats(last_seen_at desc);

create table if not exists connector_accounts (
  id text primary key default gen_random_uuid()::text,
  user_id text not null references users(id) on delete cascade,
  connector text not null,
  external_user_id text,
  external_username text,
  scopes jsonb not null default '[]',
  token_encrypted text not null,
  refresh_token_encrypted text,
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, connector)
);

create table if not exists project_connectors (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  connector_account_id text references connector_accounts(id),
  connector text not null,
  config_json jsonb not null default '{}',
  status text not null default 'connected',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_connector_accounts_user_connector on connector_accounts(user_id, connector);
create index if not exists idx_project_connectors_project on project_connectors(project_id, connector);

create table if not exists admin_audit_logs (
  id text primary key default gen_random_uuid()::text,
  admin_user_id text references users(id),
  action text not null,
  target_type text not null,
  target_id text,
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);
