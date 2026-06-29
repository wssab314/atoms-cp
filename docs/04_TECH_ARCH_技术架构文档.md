# 04｜技术架构文档

> 文档用途：指导 Codex 实现 P0 工程。
> 技术方向：Result-first AI App Builder，P0 采用宿主机持久化 workspace + Docker Codex Worker + Vite build dist + 自有 Preview Service 静态预览；CodeMirror 高级模式，GitHub OAuth App，Supabase/Vercel 集成，自研轻量 Agent Orchestrator。
> 关键原则：**核心 Agent 只做需求理解、规划、结构化 CodexTask 和受限工具请求；Codex 只在 Docker 隔离 workspace 中执行工程修改；OAuth、部署、workspace 管理、构建、dist 承载全部由确定性服务执行。**

---

## 1. 总体架构

### 1.1 P0 架构图

```text
Browser SPA
  ├─ Dashboard
  ├─ Builder Workspace
  ├─ Snapshot Preview iframe
  ├─ Inspector Runtime Bridge
  ├─ CodeMirror Advanced Mode
  └─ Connector / Deploy UI
        │
        ▼
Backend API / BFF
  ├─ Auth Middleware
  ├─ Project Service
  ├─ App Spec Service
  ├─ Design Service
  ├─ Agent Orchestrator
  │    └─ Core Agent 生成 AppSpec / DesignProfile / CodexTask
  ├─ Workspace Service
  │    └─ 宿主机 project/version workspace 管理与锁
  ├─ Codex Job Service
  │    └─ 入队、状态、事件流、重试
  ├─ Build Service
  │    └─ typecheck / pnpm build / dist 管理
  ├─ Preview Service
  │    └─ 自有静态文件服务，按 preview_snapshot 读取 dist
  ├─ Tool Broker
  ├─ Connector Service
  │    ├─ GitHub OAuth App
  │    ├─ Supabase Config
  │    └─ Vercel Deploy Adapter P1
  ├─ Version Service
  ├─ Audit / Trace Service
  └─ Admin Service P1
        │
        ├─ Postgres / Supabase DB
        ├─ Host Workspace Root
        │    └─ /var/lib/result-first/workspaces/{userId}/{projectId}/{versionId}/project
        ├─ Preview Artifact Root
        │    └─ /var/lib/result-first/previews/{previewSnapshotId}/dist
        ├─ Object Storage P1
        ├─ Redis / Queue
        ├─ Docker Codex Workers
        └─ External APIs
             ├─ Model API
             ├─ GitHub API
             ├─ Supabase API / generated app access
             └─ Vercel / Git integration
```

P0 不启动 per-user Vite dev server，不做 HMR，不使用 WebContainer。用户看到的是 build 成功后的静态 snapshot preview。

### 1.2 推荐 P0 技术栈

| 层 | 推荐 |
|---|---|
| 前端 | React + Vite + TypeScript |
| UI | Tailwind / shadcn 风格组件均可 |
| 编辑器 | CodeMirror 6，高级模式使用 |
| 状态管理 | Zustand 或 React Query + local state |
| 后端 | Node.js Fastify/NestJS；建议 Node.js 更贴近前端、Codex、Vite 生态 |
| 数据库 | Supabase Postgres 或自建 Postgres |
| 队列 | Redis + BullMQ，P0 可用 DB job table 简化 |
| Workspace | 宿主机文件夹持久化，project/version 独立路径 |
| Codex 执行 | Docker worker，非 root 用户，只 bind mount 当前 workspace |
| 构建 | Docker 内执行 `pnpm typecheck` / `pnpm build` |
| Preview | 自有 Preview Service 读取 `dist` 静态快照；P1 可接对象存储/CDN |
| Agent | 自研轻量 Orchestrator，直接调用模型 API |
| OAuth | GitHub OAuth App |
| 部署 | GitHub repo + Vercel 手动/半自动连接 |
| 日志 | Postgres trace_events + codex_logs + build_logs |

### 1.3 为什么 P0 不用 WebContainer

- 默认用户不需要看 dev server、terminal 和浏览器内文件系统。
- WebContainer 会带来浏览器兼容、文件同步、商业授权、移动端性能和前后端职责切分问题。
- 宿主机 workspace + Docker Codex Worker 更接近真实工程环境。
- 自有 Preview Service 读取 dist 静态快照，更接近真实部署产物。
- WebContainer 可作为 P1 Developer Mode，而不是 P0 主路径。

### 1.4 为什么 P0 不用 HMR

- HMR 需要长期运行 Vite dev server 和 WebSocket。
- 多用户并发下会产生端口池、代理、文件监听、资源回收问题。
- HMR 只代表开发态刷新，不代表 build 可发布。
- P0 使用版本级刷新：每次修改创建新 workspace 版本，build 成功后 iframe 切换到新的 preview URL。

---

---

## 2. 代码仓库结构建议

### 2.1 单仓库结构

```text
result-first-builder/
  apps/
    web/                         # 前端 SPA
      src/
        app/
        pages/
        components/
        features/
          builder/
          inspector/
          code-editor/
          connectors/
          deploy/
        lib/
        styles/
      package.json
      vite.config.ts

    api/                         # 后端 API / BFF
      src/
        main.ts
        config/
        modules/
          auth/
          projects/
          specs/
          files/
          agent/
          tools/
          connectors/
          workspace/
          codex/
          build/
          preview/
          deploy/
          audit/
        db/
        utils/
      package.json

    codex-worker/                # Docker Codex + build worker
      src/
        worker.ts
        sandbox.ts
        workspaceMount.ts
        runCodex.ts
        buildProject.ts
        publishSnapshot.ts
      Dockerfile
      package.json

  packages/
    shared/                      # 前后端共享类型
      src/
        app-spec.ts
        project.ts
        manifest.ts
        agent.ts
        tool.ts

    templates/                   # 生成应用模板
      react-vite-supabase/
        package.json
        index.html
        src/

    generators/                  # P1 target generators / deterministic helpers
      src/
        manifestGenerator.ts
        miniProgramGenerator.ts   # P1

  infra/
    docker-compose.yml
    migrations/
    scripts/

  docs/
    PRD.md
    TECH_ARCH.md
    AGENT_DESIGN.md
```

### 2.2 模块边界

| 模块 | 能否调用模型 | 能否访问 token | 能否写文件 | 说明 |
|---|---:|---:|---:|---|
| web | 否 | 否 | 通过 API | 浏览器端 |
| api/projects | 否 | 否 | 是 | 项目元数据 |
| api/files | 否 | 否 | 是 | 文件读写、版本 |
| api/agent | 是 | 否 | 只能请求工具 | Orchestrator |
| api/tools | 否 | 按工具需要 | 是 | Tool Broker |
| api/connectors | 否 | 是 | 否 | OAuth/token/API |
| api/workspace | 否 | 否 | 是 | workspace 创建、复制、锁、归档 |
| api/codex | 否 | 否 | 通过队列 | CodexTask 入队与状态管理 |
| codex-worker | 否 | 默认否 | 只写当前 workspace | Docker Codex + build 隔离环境 |
| generators | 可由 agent 调用 | 否 | 否 | manifest、小程序 P1 等确定性生成辅助 |

---

## 3. 核心数据模型

> P0 可以使用 Supabase Postgres。以下 SQL 为逻辑模型，可由 migration 实现。

### 3.1 users

```sql
create table users (
  id uuid primary key,
  email text unique,
  name text,
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

如果使用 Supabase Auth，可使用 `auth.users` 作为认证源，业务表保存 profile。

### 3.2 projects

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  name text not null,
  description text,
  target text not null default 'web', -- web | mini_program
  status text not null default 'draft',
  current_spec_version_id uuid,
  current_project_version_id uuid,
  current_preview_id uuid,
  deployment_url text,
  github_repo_full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.3 app_specs

```sql
create table app_specs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  status text not null default 'draft', -- draft | confirmed
  spec_json jsonb not null,
  source text not null, -- agent | user_edit | rollback
  summary text,
  created_at timestamptz default now(),
  unique(project_id, version)
);
```

### 3.4 design_profiles

```sql
create table design_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  spec_version_id uuid references app_specs(id),
  version integer not null,
  profile_json jsonb not null,
  selected boolean default false,
  created_at timestamptz default now()
);
```

### 3.5 project_files

```sql
create table project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  path text not null,
  content_hash text not null,
  size_bytes integer,
  file_version integer not null default 1,
  storage_mode text not null default 'workspace', -- workspace | db_cache | object_storage
  content_cache text, -- P0 可选：小文件为 CodeMirror 快速展示缓存一份
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(project_id, project_version_id, path)
);
```

P0 的源码 source of truth 是宿主机 workspace 文件夹；数据库记录文件索引、hash、版本、可选小文件缓存。不要把 node_modules、dist、secret 文件写入 `project_files`。

### 3.6 project_versions

```sql
create table project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version integer not null,
  source text not null, -- initial_generate | selector_edit | code_edit | codex_patch | rollback | deploy
  summary text,
  changed_files jsonb not null default '[]',
  workspace_path text not null,
  source_archive_key text, -- P1：源码压缩包对象存储 key
  spec_version_id uuid references app_specs(id),
  design_profile_id uuid references design_profiles(id),
  created_by uuid references users(id),
  created_at timestamptz default now(),
  unique(project_id, version)
);
```

每次生成或修改都创建新版本。不得在原 workspace 上覆盖式修改后直接发布。

### 3.7 ai_manifests

```sql
create table ai_manifests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  manifest_json jsonb not null,
  created_at timestamptz default now()
);
```

Manifest 示例：

```json
{
  "entries": {
    "home.hero.primaryCta": {
      "file": "src/pages/Home.tsx",
      "component": "HeroSection",
      "elementType": "button",
      "editable": ["text", "className", "styleTokens"],
      "requirementId": "REQ-001"
    }
  }
}
```

### 3.8 build_jobs

```sql
create table build_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  codex_task_id uuid,
  status text not null default 'queued', -- queued | preparing_workspace | codex_running | validating | building | snapshot_ready | success | failed | canceled
  command text,
  workspace_path text,
  dist_path text,
  preview_snapshot_id uuid,
  preview_url text,
  retry_count integer not null default 0,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now()
);
```

### 3.8.1 workspaces

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  owner_id uuid not null references users(id),
  workspace_path text not null unique,
  status text not null default 'ready', -- creating | ready | locked | archived | deleted
  locked_by_job_id uuid,
  uid integer,
  gid integer,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.8.2 codex_tasks

```sql
create table codex_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  build_job_id uuid references build_jobs(id),
  task_json jsonb not null,
  allowed_paths jsonb not null default '[]',
  forbidden_paths jsonb not null default '[]',
  status text not null default 'created', -- created | running | success | failed
  result_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.8.3 preview_snapshots

```sql
create table preview_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid not null references project_versions(id),
  build_job_id uuid references build_jobs(id),
  status text not null default 'ready', -- ready | expired | deleted
  dist_path text,
  object_storage_key text,
  preview_url text not null,
  index_path text not null default 'index.html',
  created_at timestamptz default now(),
  expires_at timestamptz
);
```

### 3.9 build_logs

```sql
create table build_logs (
  id uuid primary key default gen_random_uuid(),
  build_job_id uuid not null references build_jobs(id) on delete cascade,
  stream text not null, -- stdout | stderr | system
  line text not null,
  created_at timestamptz default now()
);
```

### 3.10 connector_accounts

```sql
create table connector_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  connector text not null, -- github | supabase | vercel
  external_user_id text,
  external_username text,
  scopes jsonb,
  token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, connector)
);
```

### 3.11 project_connectors

```sql
create table project_connectors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  connector_account_id uuid references connector_accounts(id),
  connector text not null,
  config_json jsonb not null default '{}',
  status text not null default 'connected',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.12 deployments

```sql
create table deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id),
  provider text not null, -- vercel | manual | internal
  status text not null default 'pending',
  url text,
  commit_sha text,
  provider_payload jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 3.13 agent_runs

```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id),
  mode text not null, -- spec | design | codex_task | selector_patch | repair | deploy_advice
  status text not null default 'running',
  input_json jsonb not null,
  output_json jsonb,
  model text,
  token_usage jsonb,
  error text,
  created_at timestamptz default now(),
  finished_at timestamptz
);
```

### 3.14 trace_events

```sql
create table trace_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  event_type text not null, -- model_call | tool_call | patch | build | approval | error
  payload jsonb not null,
  created_at timestamptz default now()
);
```

---

## 4. API 设计

### 4.1 Auth

```http
GET /api/auth/me
POST /api/auth/logout
```

如果使用 Supabase Auth，前端持有 Supabase session，后端验证 JWT。

### 4.2 Projects

```http
GET    /api/projects
POST   /api/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId   # P1 archive/delete
```

创建项目请求：

```json
{
  "prompt": "帮我做一个私教预约应用...",
  "target": "web",
  "appType": "booking_app",
  "visualStyle": "clean_premium",
  "backendNeeded": true
}
```

响应：

```json
{
  "projectId": "uuid",
  "status": "draft"
}
```

### 4.3 App Spec

```http
POST /api/projects/:projectId/spec/generate
GET  /api/projects/:projectId/specs
GET  /api/projects/:projectId/specs/:specId
PATCH /api/projects/:projectId/specs/:specId
POST /api/projects/:projectId/specs/:specId/confirm
```

### 4.4 Design

```http
POST /api/projects/:projectId/design/generate
GET  /api/projects/:projectId/designs
POST /api/projects/:projectId/designs/:designId/select
```

### 4.5 Code Generation / Codex Job

```text
POST /api/projects/:projectId/generations
POST /api/projects/:projectId/versions/:versionId/changes
GET  /api/jobs/:jobId
GET  /api/jobs/:jobId/events
POST /api/jobs/:jobId/cancel
```

`POST /generations` 流程：

1. 读取 confirmed AppSpec 与 DesignProfile。
2. 核心 Agent 生成 `CodexTask`。
3. Workspace Service 从受控 Vite 模板复制出新 workspace。
4. 创建 `project_version`、`workspace`、`build_job`、`codex_task`。
5. 入队给 Codex Worker。
6. 前端通过 SSE 订阅 job events。

`POST /changes` 流程：

1. 复制目标版本 workspace 为新版本。
2. 根据选择器上下文或用户修改生成受限 `CodexTask` / deterministic patch。
3. 创建新版本构建任务。
4. build 成功后生成新的 preview snapshot。

### 4.6 Build / Preview

```text
POST /api/projects/:projectId/versions/:versionId/builds
GET  /api/builds/:buildId
GET  /api/builds/:buildId/logs
GET  /api/projects/:projectId/preview
GET  /preview/:previewSnapshotId/*
```

说明：

- `/api/projects/:projectId/preview` 返回当前 project 的 latest ready `preview_snapshot`。
- `/preview/:previewSnapshotId/*` 由自有 Preview Service 提供静态文件。
- Preview Service 不执行用户代码、不启动 dev server，只读取已构建的 dist。
- SPA 路由 fallback 到该 snapshot 的 `index.html`。
- 修改后不走 HMR，而是生成新 previewSnapshotId，前端刷新 iframe URL。

### 4.7 Inspector

```http
GET  /api/projects/:projectId/manifest
POST /api/projects/:projectId/inspector/direct-patch
POST /api/projects/:projectId/inspector/ai-patch
```

直接修改文案：

```json
{
  "aiId": "home.hero.primaryCta",
  "patchType": "text",
  "value": "立即预约"
}
```

AI 修改：

```json
{
  "aiId": "home.hero.primaryCta",
  "instruction": "让这个按钮更高级一点，但不要太花",
  "currentPageUrl": "/"
}
```

### 4.8 GitHub Connector

```http
GET  /api/connectors/github/status
GET  /api/connectors/github/oauth/start
GET  /api/connectors/github/oauth/callback
GET  /api/connectors/github/repos
POST /api/connectors/github/repos
POST /api/projects/:projectId/github/bind-repo
POST /api/projects/:projectId/github/commit
```

提交请求：

```json
{
  "repoFullName": "user/my-app",
  "branch": "main",
  "message": "Update generated app",
  "projectVersionId": "uuid",
  "confirmed": true
}
```

### 4.9 Supabase Connector

```http
GET  /api/projects/:projectId/supabase/config
PUT  /api/projects/:projectId/supabase/config
POST /api/projects/:projectId/supabase/test
GET  /api/projects/:projectId/supabase/schema-sql
POST /api/projects/:projectId/supabase/apply-schema   # P1
```

配置：

```json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "anonKey": "...",
  "serviceRoleKey": "... optional"
}
```

后端返回时不得返回 `serviceRoleKey` 明文。

### 4.10 Deploy

```http
GET  /api/projects/:projectId/deploy/checklist
POST /api/projects/:projectId/deploy/manual-vercel-url
POST /api/projects/:projectId/deploy/vercel   # P1
GET  /api/projects/:projectId/deployments
```

---

## 5. Agent Orchestrator 架构

详细 Agent 设计见 `05_AGENT_DESIGN_Agent设计文档.md`。本节只定义工程接口。

### 5.1 Orchestrator 输入

```ts
export interface AgentRunRequest {
  projectId: string;
  userId: string;
  mode: 'spec' | 'design' | 'codex_task' | 'selector_patch' | 'repair' | 'chat';
  input: Record<string, unknown>;
  allowedTools: string[];
  budget?: {
    maxModelCalls: number;
    maxTokens: number;
    maxToolCalls: number;
  };
}
```

### 5.2 Orchestrator 输出

```ts
export interface AgentRunResult {
  runId: string;
  status: 'success' | 'failed' | 'needs_confirmation';
  summary: string;
  output: unknown;
  proposedToolCalls?: ToolCallProposal[];
  changedFiles?: string[];
  error?: string;
}
```

### 5.3 Agent 不能直接做的事

- 不能直接写 DB。
- 不能直接访问 token。
- 不能直接调 GitHub API。
- 不能直接部署。
- 不能直接 apply Supabase migration。
- 不能直接执行 shell 命令。
- 不能直接启动 Codex；只能生成 CodexTask 交给 Codex Job Service。

Agent 只能返回结构化请求，交给 Tool Broker。

---

## 6. Tool Broker 设计

### 6.1 Tool Registry

```ts
export interface ToolDefinition<TArgs, TResult> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  riskLevel: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  requiredConnector?: 'github' | 'supabase' | 'vercel';
  handler: (ctx: ToolContext, args: TArgs) => Promise<TResult>;
}
```

### 6.2 P0 工具清单

| 工具 | 风险 | 确认 | 说明 |
|---|---|---:|---|
| project.read_files | low | 否 | 读取当前版本 workspace 文件 |
| project.write_patch | medium | 否/视范围 | 在新版本 workspace 中应用 patch |
| project.generate_version | low | 否 | 创建 project_version 与 workspace |
| workspace.copy_version | medium | 否 | 复制旧 workspace 为新版本 |
| codex.create_task | medium | 否 | 创建结构化 CodexTask 并入队 |
| build.create_job | medium | 否 | 从 workspace 构建 dist 并创建 preview snapshot |
| github.list_repos | low | 否 | 列仓库 |
| github.create_repo | medium | 是 | 创建仓库 |
| github.commit_files | high | 是 | 提交代码 |
| supabase.generate_schema_sql | low | 否 | 生成 SQL |
| supabase.test_connection | medium | 否 | 测试连接 |
| deploy.save_manual_url | low | 否 | 保存部署 URL |

### 6.3 Tool Call 流程

```text
Agent proposes tool call
  -> Tool Broker validates schema
  -> Check user permission
  -> Check project ownership
  -> Check connector status
  -> Check risk level
  -> If confirmation required, return needs_confirmation
  -> Execute handler
  -> Mask sensitive output
  -> Write trace event
  -> Return result to Orchestrator
```

---

## 7. Workspace 与文件索引

### 7.1 设计原则

- 宿主机 workspace 是 P0 源码 source of truth。
- 数据库保存版本、路径、hash、锁、preview snapshot 等元数据。
- 前端 CodeMirror 只是编辑视图，不直接写宿主机文件。
- 每个 project_version 对应独立 workspace。
- 同一 project 同一时间只允许一个写入型 job。
- AI/Codex patch 必须生成新的 project_version。

### 7.2 Workspace 形态

```text
/var/lib/result-first/workspaces/
  {userId}/
    {projectId}/
      {versionId}/
        project/
          package.json
          index.html
          src/
          ai-manifest.json
```

Codex Worker 容器内挂载为：

```text
/workspace/project
```

挂载规则：

- 只挂载当前 job 的 workspace。
- 以非 root UID/GID 运行。
- 模板目录只读。
- 不挂载 Docker socket。
- 不挂载宿主机 `.env`、vault、其他用户目录。

### 7.3 文件保存流程

```text
CodeMirror edit
  -> User clicks save
  -> PUT /files {path, content, projectVersionId, fileVersion}
  -> API checks ownership + workspace lock
  -> Copy current workspace to new version
  -> Write file into new workspace
  -> Update project_files index/hash
  -> Create project_version
  -> Mark preview stale
```

### 7.4 Patch / Codex 修改流程

```text
Core Agent returns CodexTask
  -> Validate allowed_paths / forbidden_paths
  -> Create or copy workspace for new version
  -> Lock workspace
  -> Start Docker Codex Worker
  -> Codex modifies files under /workspace/project
  -> Worker computes changed_files + hashes
  -> Unlock workspace
  -> Create build_job
```

### 7.5 允许修改的文件路径

P0 允许：

```text
package.json        # 默认不允许 Codex 改，只有 dependency_policy=allow 时允许
index.html
src/**
ai-manifest.json
vite.config.ts      # 默认不允许，只有明确任务允许
```

P0 禁止：

```text
.env
.env.*
node_modules/**
dist/**
.git/**
private/**
../**
/**
```

---

## 8. Codex 工程生成架构

### 8.1 App Spec -> CodexTask -> React/Vite

```text
App Spec
  -> Design Profile
  -> Core Agent 生成 CodexTask
  -> Workspace Service 复制受控 Vite 模板
  -> Docker Codex Worker 修改 workspace
  -> changed_files + manifest
  -> build validation
```

Codex 不直接消费用户 prompt。Codex 输入必须是经过核心 Agent 压缩后的结构化工程任务。

### 8.2 模板结构

```text
react-vite-supabase-template/
  package.json
  pnpm-lock.yaml
  index.html
  src/
    main.tsx
    App.tsx
    pages/
    components/
    lib/
      supabase.ts
    styles/
      tokens.css
  ai-manifest.json
  codex-rules.md
```

### 8.3 CodexTask 接口

```ts
export interface CodexTask {
  taskId: string;
  projectId: string;
  projectVersionId: string;
  workspacePath: string;
  goal: string;
  appSpec: AppSpec;
  designProfile: DesignProfile;
  targetChange: {
    type: 'initial_generate' | 'selector_edit' | 'code_edit' | 'repair';
    summary: string;
    affectedAiIds?: string[];
  };
  allowedPaths: string[];
  forbiddenPaths: string[];
  dependencyPolicy: 'forbid_new_dependencies' | 'allow_package_json_with_review';
  validationCommands: string[];
  expectedOutputs: string[];
}
```

### 8.4 Codex 执行约束

- Codex 容器只读到 `/workspace/project`。
- Codex 不读取平台仓库、API 服务代码、vault、其他用户文件。
- Codex 默认不能改 package.json；确需新增依赖时必须由 dependency policy 显式允许。
- Codex 输出 changed files、summary、known issues。
- 构建失败进入 repair loop，最多自动重试有限次数。

### 8.5 `data-ai-id` 规则

命名建议：

```text
{page}.{section}.{element}

home.hero.primaryCta
home.pricing.card1.title
settings.form.emailInput
```

要求：

- 关键可编辑元素必须有 `data-ai-id`。
- `ai-manifest.json` 必须映射 ai-id 到文件、组件、用途和可编辑字段。
- selector patch 不允许删除已有 ai-id。

## 9. Build / Static Preview Service

### 9.1 构建流程

```text
POST /builds
  -> create build_job queued
  -> worker picks job
  -> load project_version.workspace_path
  -> run Codex if codex_task exists
  -> run pnpm install with cache
  -> run pnpm typecheck
  -> run pnpm build
  -> collect dist path
  -> create preview_snapshot
  -> Preview Service exposes /preview/{previewSnapshotId}/
  -> update build_job success + preview_url
  -> update project current_preview_id
```

P0 不启动 Vite dev server，不创建 HMR WebSocket。Preview 来自 `dist`。

### 9.2 Codex / Build 隔离

P0 最低要求：

- Codex 和 build 都在 Docker 容器中执行。
- 容器只 bind mount 当前 project/version workspace。
- 容器使用非 root 用户，UID/GID 与 workspace owner 对齐。
- 不挂载平台 secret、宿主机 `.env`、Docker socket。
- 设置超时，例如 10-30 分钟，P0 可先更短。
- 限制输出日志大小。
- 同一 project 同一时间只允许一个写入型 job。

P1 增强：

- gVisor / Firecracker。
- CPU/内存限制。
- 网络 allowlist。
- npm registry / pnpm store 缓存。
- dependency install 缓存。

### 9.3 Preview Service 方案

P0 采用自有 Preview Service：

```text
GET /preview/{previewSnapshotId}/
GET /preview/{previewSnapshotId}/assets/index-xxx.js
GET /preview/{previewSnapshotId}/some/spa/route
```

行为：

- 根据 `previewSnapshotId` 查 `preview_snapshots`。
- 解析到 `dist_path` 或 `object_storage_key`。
- 只返回该 dist root 下的静态文件。
- 防止路径穿越，不把 URL path 直接拼接到宿主机任意路径。
- 未命中文件时，对 SPA fallback 到 `index.html`。
- 设置正确 content-type、cache-control、CSP、iframe sandbox/allowed origin。

P0 推荐本机磁盘 dist root；P1 可切到对象存储 + CDN，但 Preview Service URL 不变。

### 9.4 Preview URL 版本

```text
/preview/{previewSnapshotId}/
```

也可以在 API 层映射为：

```text
/api/projects/{projectId}/versions/{versionId}/preview
```

要求：

- preview 和 project_version 绑定。
- 一个 project_version 可以有多个 preview_snapshot，但只有一个 latest ready snapshot。
- 旧 preview 不立即删除，至少保留最近 N 个版本。
- preview iframe 加载时应带 CSP 限制。
- 修改后通过新 snapshot URL 刷新 iframe，不使用 HMR。

### 9.5 多用户并发策略

- 多用户同时查看 preview 时，只是静态文件访问，由 Preview Service/Nginx/CDN 承载。
- 多用户同时生成时，瓶颈是 Codex/build worker，并通过队列限流。
- 每个用户可设置 active job 上限。
- 每台 worker 可设置最大并发 Codex job。
- dist 和 workspace 应设置过期清理策略。

---

## 10. Preview iframe 与 Inspector Bridge

### 10.1 注入方式

P0 推荐在生成代码时内置 inspector runtime，仅在静态 preview 环境启用。

```ts
if (import.meta.env.VITE_PREVIEW_INSPECTOR === 'true') {
  import('./inspector-runtime');
}
```

也可以由 Preview Service 在返回 `index.html` 时注入 inspector bridge，但必须保持可审计和可关闭。

### 10.2 消息协议

iframe -> parent：

```ts
type InspectorMessage =
  | {
      type: 'INSPECTOR_HOVER';
      payload: {
        aiId?: string;
        tagName: string;
        text?: string;
        bbox: DOMRectLike;
      };
    }
  | {
      type: 'INSPECTOR_SELECT';
      payload: {
        aiId?: string;
        tagName: string;
        text?: string;
        className?: string;
        computedStyle?: Record<string, string>;
        bbox: DOMRectLike;
      };
    }
  | {
      type: 'INSPECTOR_ERROR';
      payload: {
        message: string;
      };
    };
```

parent -> iframe：

```ts
type ParentMessage =
  | { type: 'INSPECTOR_ENABLE' }
  | { type: 'INSPECTOR_DISABLE' }
  | { type: 'INSPECTOR_HIGHLIGHT'; payload: { aiId: string } };
```

### 10.3 Inspector Runtime 行为

- 监听 `mouseover`。
- 找最近的 `[data-ai-id]` 祖先。
- 绘制高亮框。
- click 时阻止默认事件。
- 发送元素信息到 parent。
- 不读取敏感 input value，除非该 input 是设计可编辑字段。

### 10.4 安全

- parent 校验 message origin。
- iframe 只加载平台生成 preview URL。
- 不接受来自未知 origin 的消息。
- Inspector 只在预览环境启用。

---

## 11. GitHub OAuth App 集成

### 11.1 OAuth 流程

```text
User clicks Connect GitHub
  -> GET /api/connectors/github/oauth/start
  -> backend creates state and stores it
  -> redirect to GitHub authorize URL
  -> GitHub callback with code/state
  -> backend verifies state
  -> exchange code for access token
  -> encrypt token
  -> fetch user profile
  -> save connector_account
  -> redirect back to app
```

### 11.2 OAuth state 表

```sql
create table oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  connector text not null,
  state text not null unique,
  redirect_after text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz default now()
);
```

### 11.3 Token 加密

建议：

- 使用 KMS 或环境变量主密钥。
- AES-GCM 加密 token。
- DB 中只保存 ciphertext。
- API 永不返回明文 token。

### 11.4 GitHub 提交流程

```text
User clicks commit
  -> API checks GitHub connector
  -> API reads current project files
  -> API generates file list preview
  -> User confirms
  -> Connector decrypts token
  -> Create or update files via GitHub API
  -> Save commit_sha
  -> Create deployment/version record
```

### 11.5 P0 scope 建议

- `read:user`
- `repo`
- `workflow` 仅在确实需要更新 GitHub Actions 时申请。

如果 P0 不生成 workflow，可先不申请 workflow，降低用户授权压力。

---

## 12. Supabase 集成

### 12.1 生成应用使用 Supabase 的方式

P0 生成 Web App 可以使用：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

`service_role_key` 只能在平台后端或用户自己的 server/edge function 使用。

### 12.2 配置存储

```json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "anonKeyMasked": "eyJ...abcd",
  "hasServiceRoleKey": true,
  "schemaStatus": "draft"
}
```

### 12.3 schema SQL 生成

App Spec data models -> SQL：

```sql
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  course_id uuid not null,
  status text not null default 'pending',
  created_at timestamptz default now()
);
```

P0 可以只生成 SQL，让用户复制到 Supabase 控制台。

### 12.4 RLS 策略

P0 可生成建议 SQL，不自动 apply：

```sql
alter table public.bookings enable row level security;

create policy "Users can read own bookings"
  on public.bookings
  for select
  using (auth.uid() = user_id);
```

P1 再做自动执行和校验。

---

## 13. Vercel 部署

### 13.1 P0 半自动部署

```text
Project files
  -> GitHub repo commit
  -> User imports repo in Vercel
  -> User configures env
  -> User enters deployment URL back to platform
```

优点：

- 不需要 P0 处理 Vercel OAuth。
- 标准、稳定。
- 面试作业可完成闭环。

### 13.2 P1 一键部署

```text
User authorizes Vercel
  -> backend creates Vercel project
  -> imports GitHub repo
  -> sets env vars
  -> triggers deployment
  -> polls status
```

### 13.3 发布前检查

```ts
export interface DeployChecklist {
  buildSuccess: boolean;
  githubConnected: boolean;
  repoBound: boolean;
  envReady: boolean;
  supabaseConfigured: boolean;
  secretScanPassed: boolean;
}
```

---

## 14. 小程序 Target 架构 P1

### 14.1 小程序不复用 WebContainer

小程序不是浏览器里的 Web App，不能依赖 iframe/WebContainer 预览。应由 App Spec 编译为原生小程序工程。

```text
App Spec
  -> Mini Program UI Schema
  -> WXML/WXSS/TS/JSON
  -> miniprogram-ci preview
  -> QR code
  -> upload dev version
```

### 14.2 生成文件结构

```text
miniprogram/
  app.json
  app.ts
  app.wxss
  project.config.json
  pages/
    index/
      index.wxml
      index.wxss
      index.ts
      index.json
    dashboard/
      dashboard.wxml
      dashboard.wxss
      dashboard.ts
      dashboard.json
  components/
  utils/
    request.ts
```

### 14.3 miniprogram-ci Worker

后端 worker 需要：

- 从 project_version workspace 或对象存储源码包读取小程序文件。
- 写入临时目录。
- 使用 appid/private key 初始化 Project。
- 调用 preview 或 upload。
- 返回二维码路径或 upload 结果。
- 清理临时目录。

### 14.4 小程序后端访问

不建议小程序直接复杂调用 Supabase。推荐：

```text
小程序 wx.request
  -> 平台 BFF / Supabase Edge Function
  -> Supabase Postgres/Auth/Storage
```

---

## 15. 安全设计

### 15.1 Secret 分类

| Secret | 存储 | 前端可见 | Agent 可见 |
|---|---|---:|---:|
| GitHub access token | encrypted DB | 否 | 否 |
| Supabase anon key | project config | 是，可进入生成 App | 可见，但注意标记为 public |
| Supabase service role key | encrypted DB | 否 | 否 |
| Vercel token P1 | encrypted DB | 否 | 否 |
| Model API key | server env | 否 | 否 |
| Mini Program private key | encrypted storage | 否 | 否 |

### 15.2 日志脱敏

需要 mask：

- GitHub token；
- Supabase service role；
- Vercel token；
- OpenAI/模型 key；
- private key；
- `.env` 内容。

### 15.3 构建安全

- Docker/gVisor。
- 非 root 用户。
- 只挂载当前 workspace。
- 禁止 Docker socket。
- 禁止读取宿主机 secret。
- 依赖安装网络可做 allowlist。
- 日志脱敏。
- 构建产物只发布 dist。

### 15.4 Preview Service 安全

- preview URL 必须映射到 `preview_snapshot`，不得直接暴露宿主机路径。
- 静态文件读取必须限制在 snapshot 的 dist root 内。
- 对 `..`、绝对路径、软链逃逸做拒绝。
- 设置 `Content-Security-Policy`，限制外部脚本与连接。
- iframe 只允许被平台 Builder 页面嵌入。
- 预览环境不注入生产密钥。

---

---

## 16. 状态机

### 16.1 Project Status

```text
draft
  -> spec_generating
  -> spec_ready
  -> design_generating
  -> design_ready
  -> code_generating
  -> building
  -> preview_ready
  -> build_failed
  -> deployed
```

### 16.2 Agent Run Status

```text
queued -> running -> success
                  -> failed
                  -> needs_confirmation
                  -> canceled
```

### 16.3 Build Job Status

```text
queued
  -> preparing_workspace
  -> codex_running
  -> validating
  -> building
  -> snapshot_ready
  -> success
  -> failed
  -> canceled
```

失败子类型：

```text
CODEX_FAILED
VALIDATION_FAILED
BUILD_FAILED
SNAPSHOT_FAILED
TIMEOUT
```

### 16.4 Connector Status

```text
not_connected -> connecting -> connected
                             -> expired
                             -> error
```

---

## 17. 前端状态管理

### 17.1 推荐 Query Key

```ts
['projects']
['project', projectId]
['project-files', projectId]
['project-file', projectId, path]
['app-specs', projectId]
['designs', projectId]
['manifest', projectId]
['build-job', buildJobId]
['github-status']
['deploy-checklist', projectId]
```

### 17.2 Builder State

```ts
interface BuilderUiState {
  mode: 'result' | 'design' | 'code' | 'deploy';
  selectedAiId?: string;
  inspectorEnabled: boolean;
  currentFilePath?: string;
  previewDevice: 'desktop' | 'mobile';
  rightPanelTab: 'inspector' | 'logs' | 'spec';
}
```

---

## 18. Codex 实施顺序

### 18.1 M0 基础工程

Codex 任务：

1. 创建 monorepo。
2. 创建 web/api/shared 三个包。
3. 建立数据库 migration。
4. 实现用户登录 mock 或 Supabase Auth。
5. 实现项目 CRUD。

验收：

- 可以登录。
- 可以创建项目。
- Dashboard 展示项目。

### 18.2 M1 App Spec

Codex 任务：

1. 定义 AppSpec TypeScript 类型。
2. 实现 `/spec/generate`。
3. 实现 Agent Orchestrator 最小版本。
4. 展示 App Spec 页面。
5. 支持确认和版本化。

验收：

- 输入 prompt 可以生成结构化 spec。
- spec 可保存和确认。

### 18.3 M2 Codex 工程生成与 Workspace

Codex 任务：

1. 创建 React/Vite 受控模板。
2. 定义 CodexTask schema。
3. 实现 Workspace Service：创建、复制、锁定、归档 workspace。
4. 实现 Docker Codex Worker：挂载 workspace、运行 codex、采集 changed_files。
5. 生成 `data-ai-id` 与 `ai-manifest.json`。
6. CodeMirror 读取 workspace 文件索引。

验收：

- 确认 Spec 和 Design 后，可以创建 project/version workspace。
- Codex Worker 可以在 Docker 中修改该 workspace。
- DB 记录 workspace_path、changed_files、hash。

### 18.4 M3 Static Preview Service

Codex 任务：

1. 创建 build_jobs。
2. 实现 builder worker。
3. 执行 `pnpm typecheck` / `pnpm build`。
4. 生成 dist。
5. 创建 preview_snapshots。
6. 实现自有 Preview Service：静态文件读取、SPA fallback、CSP。
7. 返回 preview URL。
8. iframe 加载 snapshot preview。

验收：

- 生成项目可以 build 成功。
- `dist` 可以通过 `/preview/{previewSnapshotId}/` 访问。
- Builder iframe 可以加载并点击预览。
- 不依赖 HMR 或 Vite dev server。

### 18.5 M4 Inspector

Codex 任务：

1. 实现 inspector runtime。
2. 实现 postMessage bridge。
3. 实现 InspectorPanel。
4. 实现 direct text patch。
5. 实现 AI selector patch。
6. patch 后自动 build。

验收：

- 点击按钮可以修改文案并更新预览。

### 18.6 M5 GitHub + Deploy

Codex 任务：

1. GitHub OAuth start/callback。
2. token 加密。
3. repo 列表。
4. repo 创建。
5. commit files。
6. 发布 checklist。
7. deployment URL 保存。

验收：

- 当前项目能提交到 GitHub。
- 用户能保存发布 URL。

### 18.7 M6 Supabase

Codex 任务：

1. Supabase 配置表。
2. App Spec -> SQL。
3. 生成 `src/lib/supabase.ts`。
4. env 检查。
5. 连接测试。

验收：

- 生成应用包含 Supabase client。
- 用户可复制 SQL。

---

## 19. 测试策略

### 19.1 单元测试

- AppSpec schema validation。
- Manifest generator。
- Patch apply。
- Tool Broker permission。
- OAuth state validation。
- Secret masking。

### 19.2 集成测试

- Create project -> generate spec。
- Generate code -> save files。
- Build -> preview。
- Inspector patch -> rebuild。
- GitHub OAuth mock -> commit mock。

### 19.3 E2E 测试

主路径：

```text
登录 -> 创建项目 -> 生成 Spec -> 选择设计 -> 生成代码 -> 预览 -> 选择器修改 -> GitHub 提交
```

---

## 20. 环境变量

### 20.1 API 服务

```env
DATABASE_URL=
REDIS_URL=
MODEL_API_KEY=
MODEL_BASE_URL=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_OAUTH_CALLBACK_URL=
TOKEN_ENCRYPTION_KEY=
PREVIEW_BASE_URL=
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
```

### 20.2 Web 前端

```env
VITE_API_BASE_URL=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

注意：前端 env 不得包含任何 secret。

---

## 21. 最小可演示方案

如果时间有限，Codex 应先实现以下最小闭环：

1. 登录可 mock。
2. 创建项目。
3. 生成一个固定格式 App Spec。
4. 根据 Spec 生成 CodexTask，并由 Docker Codex Worker 修改 React/Vite workspace。
5. 使用本地 API 执行 `npm run build`。
6. 自有 Preview Service 展示 dist snapshot。
7. iframe 加载 preview。
8. 选择器通过 `data-ai-id` 修改按钮文案。
9. GitHub OAuth 完成授权。
10. commit 当前文件到 repo。

这个闭环比实现复杂 Web IDE 更重要。

---
