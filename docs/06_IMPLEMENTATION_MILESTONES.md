# 06｜实施里程碑与阶段成果

> 文档用途：把 `01_PRD`、`02_PAGE_SPEC`、`03_USER_STORIES`、`04_TECH_ARCH`、`05_AGENT_DESIGN`、`ARCH_UPDATE_SUMMARY` 和 `README_Codex_执行说明` 合并成可执行开发计划。
> 当前架构基线：**Result-first AI App Builder，不默认 Web IDE；P0 使用宿主机持久化 workspace + Docker Codex Worker + Vite build dist + 自有 Static Preview Service。**
> 主链路：`Prompt -> AppSpec -> DesignProfile -> CodexTask -> Workspace Service -> Docker Codex Worker -> Build Service -> Preview Snapshot -> Inspector Patch -> GitHub/Vercel/Supabase -> Deploy`。

---

## 1. 架构调整后的执行原则

### 1.1 P0 主线优先级

P0 不以“看起来像 IDE”为目标，而以真实结果闭环为目标：

```text
登录/项目
  -> 创建项目
  -> 生成 App Spec
  -> 选择设计方向
  -> 生成结构化 CodexTask
  -> 创建 project/version workspace
  -> Docker Codex Worker 修改受控 Vite 项目
  -> typecheck/build 生成 dist
  -> Preview Service 静态 snapshot iframe
  -> 选择器微调并生成新版本
  -> GitHub commit
  -> Vercel/Supabase 发布前检查与发布记录
```

任何里程碑实现如果偏离这条链路，应降级为 P1/P2。

### 1.2 P0 明确不做

- 不做 WebContainer 默认运行。
- 不做 HMR。
- 不为每个用户启动 Vite dev server。
- 不做 interactive terminal。
- 不做完整 VS Code in Browser。
- 不做自由多 Agent 对话团队。
- 不让 Agent 直接执行 OAuth、token 存储、GitHub/Vercel/Supabase 高风险操作。
- 不让 Codex 直接消费原始用户 prompt。
- 不让 Codex 在宿主机进程中执行。
- 不把 secret 写入前端代码、Agent 上下文、Codex workspace 或日志。

### 1.3 确定性系统与 Agent 边界

| 能力 | 核心 Agent | Codex Worker | 确定性系统 |
|---|---:|---:|---:|
| 需求理解 / App Spec | 是 | 否 | 存储、校验 |
| DesignProfile | 是 | 否 | 存储、选择 |
| CodexTask | 是 | 否 | 校验、入队 |
| React/Vite 源码修改 | 否 | 是，仅 Docker workspace | workspace、锁、版本 |
| 选择器 patch plan | 是 | 可执行局部修改 | manifest、patch 校验 |
| 文件写入 / 版本创建 | 否 | 当前 workspace 内 | 是 |
| 构建 / dist / preview | 否 | 可执行命令 | Build/Preview Service |
| OAuth / token / deploy | 只提建议 | 否 | Connector/Tool Broker |

### 1.4 Chrome 视觉验收

每个包含前端界面的里程碑完成后，必须用 Chrome 验收。

验收记录至少包含：

- 访问的本地 URL；
- 桌面主视口截图；
- 关键交互是否可点击；
- 页面是否有明显遮挡、溢出、空白或布局错位；
- 如果有 iframe preview，确认 iframe 非空、可交互，且 preview URL 来自平台 Preview Service；
- 如果有移动/窄屏状态，至少检查无横向溢出。

### 1.5 ChatGPT Web Review Gate

每个产品里程碑完成后，需要调用网页版 ChatGPT，使用最高思考模式但不使用 Pro，做一次 review。

Review 输入应包含：

- 本里程碑目标；
- 已完成文件/模块摘要；
- 当前运行方式；
- 测试结果；
- Chrome 验收结果；
- 已知限制；
- 需要重点审查的问题。

Review 产物保存到：

```text
docs/reviews/YYYY-MM-DD-M{n}-review.md
```

禁止发送：

- API key；
- OAuth token；
- service role key；
- private key；
- 用户隐私数据；
- 未经用户确认的敏感本地文件。

### 1.6 ChatGPT Image Asset Gate

当应用需要插图、空状态图、示例封面、演示图或其他 bitmap 资源时，使用网页版 ChatGPT Image 生成并保存。

默认保存路径：

```text
apps/web/public/assets/generated/<feature-or-milestone>/
```

如果 `apps/web` 尚未创建，则临时保存到：

```text
docs/assets/images/<feature-or-milestone>/
```

规则：

- 不覆盖已有图片，除非用户明确要求替换；
- 保存生成 prompt、用途和文件名；
- 生成图不能包含 secret、真实用户隐私或未经授权的品牌资产。

### 1.7 Docker Runtime Baseline

后端、数据库、队列、Codex Worker、Build Worker 应通过 Docker 环境运行或可由 Docker Compose 拉起。

P0 Docker 服务：

```text
web              可选，前端演示/生产容器
api              后端 API / BFF / Agent Orchestrator / Tool Broker
codex-worker     Docker Codex Worker + build worker
postgres         应用数据库
redis            队列与长任务状态
preview          可选独立 Preview Service，P0 可先由 api 承载
```

前端开发期可以在宿主机运行 Vite，以便快速迭代；但用户项目 preview 不能依赖 per-user Vite dev server。

### 1.8 DeepSeek Model Baseline

模型调用默认走 DeepSeek API，通过后端环境变量配置。

推荐环境变量：

```env
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_FALLBACK_MODEL=deepseek-v4-flash
MODEL_BUDGET_CNY=25
```

规则：

- API key 只放本地 `.env` 或部署 secret，不写入代码、文档或前端 env；
- 前端永远不接触模型 API key；
- 记录每次模型调用的 provider、model、token usage、耗时和错误；
- 增加预算护栏，超过预算阈值时阻止非必要模型调用；
- 本地开发保留 mock model client，避免无谓消耗额度。

### 1.9 Admin 后台 Baseline

`/admin` 在 P0 作为运营和调试后台，不承担企业权限体系。

P0 管理能力：

- 用户列表和基础状态；
- 项目列表、当前状态、当前 spec/version/preview；
- build job 列表、状态、错误摘要；
- codex task / agent run 列表、trace 摘要和 token usage；
- connector 状态查看；
- 系统配置查看，敏感值必须 mask；
- 模型预算和调用量概览。

P0 不做：

- 查看明文 secret；
- 直接编辑用户项目文件；
- 绕过用户确认执行 GitHub/Vercel/Supabase 高风险操作；
- 多租户企业权限体系。

---

## 2. 里程碑总览

| 里程碑 | 名称 | 核心目标 | 阶段成果 |
|---|---|---|---|
| M0 | 工程、Docker 与数据底座 | 建立可运行基础设施 | monorepo、Docker Compose、DB migrations、auth/project CRUD、Admin shell |
| M1 | App Spec、Design 与 Orchestrator Skeleton | Prompt 变成可确认的结构化产品方案 | DeepSeek/mock ModelClient、Spec Agent、Design Agent、trace、Spec/Design UI |
| M2 | CodexTask、Workspace 与 Docker Codex Worker | 真正的 code agent 执行层成型 | CodexTask schema、Workspace Service、版本化 workspace、Docker Codex Worker、changed_files/hash |
| M3 | Build Service 与 Static Preview Service | 生成项目能以 dist snapshot 真实预览 | build_jobs、typecheck/build、preview_snapshots、`/preview/:id/*`、iframe |
| M4 | Inspector 与选择器微调 | 做出 Result-first 差异化编辑闭环 | inspector runtime、postMessage、manifest 查找、direct patch、AI selector patch、新版本 rebuild |
| M5 | 高级代码模式与版本历史 | 半技术用户可接手和追踪 | CodeMirror、文件索引、版本冲突、logs、version history |
| M6 | GitHub、Supabase 与发布中心 | 完成交付闭环 | GitHub OAuth/commit、Supabase SQL/client/env check、Vercel 手动发布路径、deploy checklist |
| M7 | QA Fix、Tool Broker 与运营硬化 | 提升演示稳定性和安全性 | QA Fix Agent、Tool Broker、secret masking、Admin trace/build/model 运营视图、E2E 主流程 |

P0 最小可演示闭环必须至少完成 M0-M6；M7 是进入稳定内测前必须完成的硬化阶段。

---

## 3. 分阶段细化

### M0：工程、Docker 与数据底座

目标：

- 让项目具备后续所有长任务、workspace、preview 和 Admin 的基础承载能力。

任务：

- 创建或整理 monorepo：`apps/web`、`apps/api`、`apps/codex-worker`、`packages/shared`、`packages/templates`。
- 配置 `pnpm-workspace.yaml` 和统一 lint/test/typecheck/build 脚本。
- 配置 Docker Compose：`api`、`codex-worker`、`postgres`、`redis`，可选 `web`、`preview`。
- 创建 `.env.example`，只写变量名、用途和是否敏感。
- 实现 API health check 和 runtime health。
- 建立基础 migration：
  - `users`
  - `projects`
  - `app_specs`
  - `design_profiles`
  - `project_versions`
  - `project_files`
  - `build_jobs`
  - `build_logs`
  - `connector_accounts`
  - `project_connectors`
  - `agent_runs`
  - `trace_events`
- 为后续新架构预留：
  - `workspaces`
  - `codex_tasks`
  - `preview_snapshots`
  - `deployments`
  - `oauth_states`
- 实现 mock auth 或 Supabase Auth 适配层。
- 实现项目 CRUD 和 Dashboard 项目卡片。
- 实现 `/admin` shell，展示用户、项目、系统健康、敏感配置 mask 状态。

阶段成果：

- 用户可以登录或通过 mock auth 进入产品。
- 用户可以创建项目，并在 Dashboard 看到项目。
- Admin 可以看到用户、项目和服务健康状态。
- Docker Compose 配置可通过校验，数据库 migration 可重复执行。

验收命令：

```text
pnpm lint
pnpm test
pnpm typecheck
docker compose config
```

Chrome 验收：

- `/`
- `/login` 或 mock 登录入口
- `/app`
- `/app/new`
- `/admin`

完成定义：

- 不包含任何真实 secret。
- Admin 配置页只显示 configured/not_configured/masked。
- 数据模型能支撑后续 workspace、codex task、preview snapshot。

### M1：App Spec、Design 与 Orchestrator Skeleton

目标：

- 把用户 prompt 转成可确认、可版本化、可继续生成工程任务的中间层。

任务：

- 定义 shared schema：
  - `AppSpec`
  - `DesignProfile`
  - `AgentRun`
  - `TraceEvent`
  - `ProjectState`
- 实现 `ModelClient`，支持 DeepSeek 与 mock provider。
- 实现轻量 Orchestrator skeleton：
  - mode：`spec`、`design`、`codex_task`、`selector_patch`、`repair`、`deploy_advice`
  - Context Assembler
  - Schema Validator
  - Repair Loop
  - Trace Recorder
  - Budget Controller
- 实现 Spec Agent：
  - 输入 prompt / app type / visual style / backend needed；
  - 输出结构化 `AppSpec`；
  - 失败时 schema repair 一次；
  - 保存 `app_specs` 版本。
- 实现 App Spec 审核 UI：
  - 产品摘要；
  - 页面列表；
  - 用户流程；
  - 数据模型；
  - open questions；
  - 可编辑关键字段；
  - 确认按钮。
- 实现 Design Agent：
  - 基于 confirmed App Spec 生成 2-3 个 DesignProfile；
  - 保存 `design_profiles`；
  - 用户可选择其中一个方向。
- Admin 展示 agent runs、model usage、错误摘要。

阶段成果：

- 输入“私教预约 Web 应用”可以生成结构化 App Spec。
- App Spec 可以编辑、确认并版本化。
- 至少展示 2 个可区分设计方向。
- 选中 DesignProfile 后，项目进入可生成 CodexTask 的状态。
- 模型调用不暴露 key，调用记录可在 Admin 查看。

验收重点：

- Agent 输出必须是 schema-valid JSON。
- App Spec 页面不默认展示代码或终端。
- DesignProfile 是后续 CodexTask 的输入，不是纯展示文本。

测试：

- AppSpec schema 单元测试。
- DesignProfile schema 单元测试。
- ModelClient mock/deepseek 配置测试。
- Spec generation API 集成测试。
- Trace/model usage 写入测试。

### M2：CodexTask、Workspace 与 Docker Codex Worker

目标：

- 建立真正的 code agent 执行层：核心 Agent 生成结构化 CodexTask，Codex 只在隔离 workspace 中修改当前项目。

任务：

- 定义 `CodexTask` shared schema：
  - `goal`
  - `appSpec`
  - `designProfile`
  - `targetChange`
  - `allowedPaths`
  - `forbiddenPaths`
  - `dependencyPolicy`
  - `validationCommands`
  - `expectedOutputs`
- 实现 CodexTask Planner Agent：
  - 输入 confirmed AppSpec + selected DesignProfile + 模板约束；
  - 输出 CodexTask；
  - 不直接写文件、不运行命令。
- 实现 React/Vite 受控模板：
  - `package.json`
  - `index.html`
  - `src/main.tsx`
  - `src/App.tsx`
  - `src/pages/*`
  - `src/components/*`
  - `src/styles/tokens.css`
  - `src/lib/supabase.ts`
  - `ai-manifest.json`
  - `codex-rules.md`
- 实现 Workspace Service：
  - 从模板创建 project/version workspace；
  - 复制旧版本 workspace；
  - workspace lock/unlock；
  - workspace archive/delete；
  - 文件路径 allowlist/denylist；
  - DB 记录 `workspaces`、`project_versions`、`project_files`。
- 实现 Docker Codex Worker：
  - 只 bind mount 当前 workspace 到 `/workspace/project`；
  - 非 root 用户运行；
  - 不挂载 Docker socket；
  - 不挂载宿主机 `.env`、vault、其他用户 workspace；
  - 运行 Codex 执行结构化任务；
  - 采集 changed_files、hash、summary、known issues；
  - 写入 `codex_tasks` 和 `build_logs`。
- 生成或维护 `data-ai-id` 与 `ai-manifest.json`。
- 实现 job status：`queued -> preparing_workspace -> codex_running -> validating -> failed/success`。

阶段成果：

- 确认 Spec 和 Design 后，可以创建 project/version workspace。
- CodexTask Planner 输出结构化 CodexTask。
- Docker Codex Worker 可以在当前 workspace 中修改受控 Vite 项目。
- DB 记录 workspace_path、changed_files、content_hash、codex_task 状态。
- Codex 不接收原始用户 prompt，不可访问平台仓库、secret 或其他用户文件。

验收重点：

- `allowedPaths` 和 `forbiddenPaths` 生效。
- `.env`、`node_modules`、`dist`、`.git`、`../`、绝对路径均禁止。
- 默认禁止修改 `package.json`，除非 dependency policy 明确允许。
- 所有写入型任务同一 project 同一时间只允许一个。

测试：

- CodexTask schema 单元测试。
- Workspace create/copy/lock/archive 单元测试。
- 路径穿越和 forbidden path 测试。
- Docker Worker dry-run/integration 测试。
- changed_files/hash 采集测试。

### M3：Build Service 与 Static Preview Service

目标：

- 让生成项目通过真实 build 产生 dist，并由自有 Preview Service 以静态 snapshot 形式展示。

任务：

- 实现 `build_jobs` 状态机：
  - `queued`
  - `preparing_workspace`
  - `codex_running`
  - `validating`
  - `building`
  - `snapshot_ready`
  - `success`
  - `failed`
  - `canceled`
- Build Service 从 `project_version.workspace_path` 读取源码。
- 在 Docker 隔离环境中执行：
  - `pnpm install` 或复用模板依赖缓存；
  - `pnpm typecheck`；
  - `pnpm build`。
- 生成 dist 并写入 preview artifact root：
  - P0 本机磁盘；
  - P1 可迁移对象存储/CDN。
- 创建 `preview_snapshots`：
  - project_id；
  - project_version_id；
  - build_job_id；
  - dist_path；
  - preview_url；
  - status。
- 实现 Preview Service：
  - `GET /preview/:previewSnapshotId/*`；
  - 只读取 snapshot 对应 dist root；
  - 防路径穿越；
  - SPA fallback 到 `index.html`；
  - content-type；
  - cache-control；
  - CSP；
  - iframe embedding 限制。
- Builder iframe 加载 preview URL。
- 前端展示生成步骤时间线：
  - 理解需求；
  - 生成 App Spec；
  - 生成 CodexTask；
  - 准备 workspace；
  - Codex 修改代码；
  - 构建 dist；
  - 发布 snapshot preview。
- Admin 展示 build jobs、错误摘要、preview snapshot 状态。

阶段成果：

- 生成项目可以 build 成功。
- `dist` 可以通过 `/preview/{previewSnapshotId}/` 访问。
- Builder iframe 可以加载并点击预览。
- 修改后通过新的 previewSnapshotId 刷新，不依赖 HMR。
- 构建失败时展示用户可理解错误摘要，不展示交互式终端。

验收重点：

- Preview Service 不按用户输入路径直接读取宿主机文件。
- 不启动 per-user Vite dev server。
- iframe 非空、可点击、无明显布局错位。
- build log 展示前做 secret mask。

测试：

- Build job 状态机测试。
- Preview Service 路径穿越测试。
- SPA fallback 测试。
- iframe preview API 集成测试。
- 构建失败摘要测试。

### M4：Inspector 与选择器微调

目标：

- 让用户不看代码也能点击 preview 中的元素，做局部修改，并生成新版本 snapshot。

任务：

- 实现 inspector runtime：
  - 仅 preview 环境启用；
  - hover 高亮；
  - click 选中；
  - 查找最近 `[data-ai-id]`；
  - 不读取敏感 input value。
- 实现 iframe `postMessage` bridge：
  - `INSPECTOR_HOVER`
  - `INSPECTOR_SELECT`
  - `INSPECTOR_ERROR`
  - `INSPECTOR_ENABLE`
  - `INSPECTOR_DISABLE`
  - `INSPECTOR_HIGHLIGHT`
- Parent 校验 message origin。
- 实现 InspectorPanel：
  - ai-id；
  - tag；
  - text；
  - className；
  - computed style；
  - manifest entry；
  - 关联文件；
  - direct edit；
  - AI tweak。
- 实现 direct text patch：
  - 不调用模型；
  - 后端通过 manifest 定位源码；
  - snippet 唯一匹配；
  - 保留 `data-ai-id`；
  - 复制当前 workspace 为新 project_version；
  - 应用 patch；
  - 创建 build job。
- 实现基础 style token patch：
  - 限制为 className / CSS variable / token；
  - 不改业务逻辑。
- 实现 Selector Patch Agent：
  - 输入 selected ai-id、manifest entry、source snippet、computed style、用户指令；
  - 输出 patch plan 或受限 CodexTask；
  - patch validator 校验；
  - 失败时提示用户。
- patch 成功后自动 build，并切换 iframe 到新 snapshot URL。
- 版本历史写入 `selector_edit`。

阶段成果：

- 用户点击 preview 中的 CTA。
- Inspector 显示元素信息和可编辑字段。
- 用户把按钮文案改成“立即预约”。
- 后端创建新 project_version。
- build 成功后 iframe 显示新文案。
- 版本历史出现 selector_edit。

验收重点：

- 选择器主路径是 `data-ai-id + ai-manifest`。
- direct patch 不调用模型。
- AI selector patch 不改无关文件。
- patch 不允许删除 `data-ai-id`。
- 修改后不是 HMR，而是新 snapshot URL。

测试：

- manifest lookup 测试。
- direct patch 单元测试。
- snippet 多匹配/不匹配测试。
- `data-ai-id` 删除拦截测试。
- selector patch API 集成测试。
- iframe message origin 测试。

### M5：高级代码模式与版本历史

目标：

- 给 PowerUser 提供有限代码查看/编辑能力，同时保持 Result-first 默认体验。

任务：

- 实现高级代码模式路由或 Builder tab：
  - File Tree；
  - CodeMirror；
  - Preview/Logs；
  - 返回结果模式。
- File Tree 读取当前 project_version 的 workspace 文件索引。
- CodeMirror 支持：
  - 打开文件；
  - 编辑；
  - 保存；
  - 未保存提示；
  - file_version 检查；
  - P1 diff。
- 保存文件流程：
  - 提交 path/content/file_version/project_version_id；
  - 后端检查 ownership + lock + allowlist；
  - 复制当前 workspace 为新版本；
  - 写入文件；
  - 更新 project_files hash；
  - 标记 preview stale；
  - 可手动或自动创建 build job。
- 实现只读 logs：
  - build command；
  - stdout/stderr；
  - error summary；
  - 相关文件；
  - 不提供命令输入。
- 实现版本历史：
  - version；
  - created_at；
  - source；
  - summary；
  - changed_files；
  - build_status；
  - preview_url；
  - deployment_url。
- 支持版本详情和复制版本信息。

阶段成果：

- 用户可以打开高级代码模式查看文件。
- 用户可以编辑文件并保存为新版本。
- 冲突时阻止覆盖并提示 reload/merge。
- 版本历史展示 initial_generate、selector_edit、code_edit。
- Logs 只读且脱敏。

验收重点：

- 高级代码模式不是默认主界面。
- 不提供 interactive terminal。
- 文件保存必须创建新 project_version。
- 不能直接覆盖旧 workspace。

测试：

- File Tree API 测试。
- CodeMirror save API 测试。
- file_version conflict 测试。
- 版本历史查询测试。
- log secret mask 测试。

### M6：GitHub、Supabase 与发布中心

目标：

- 让当前版本可以交付到 GitHub，并完成 P0 半自动 Vercel/Supabase 发布路径。

任务：

- GitHub OAuth App：
  - start/callback；
  - state 防 CSRF；
  - token 加密保存；
  - 获取 viewer；
  - connector status；
  - repo list；
  - create repo。
- GitHub commit：
  - 读取当前 project_version workspace 文件；
  - 排除 `node_modules`、`dist`、`.env`、私有文件；
  - 提交前展示文件列表、大小、hash；
  - 用户确认后执行 commit；
  - 保存 repo、commit_sha、deployment/version 记录。
- Supabase P0：
  - 配置 Supabase URL / anon key；
  - service role key 只进后端 vault；
  - App Spec data models -> SQL schema；
  - 生成或维护 `src/lib/supabase.ts`；
  - 生成应用引用 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；
  - 测试连接；
  - 发布前 env 检查。
- 发布中心：
  - App Spec confirmed；
  - Build success；
  - GitHub connected；
  - Repo selected/committed；
  - Supabase configured/warn；
  - Env ready；
  - Secret scan；
  - Vercel manual URL。
- Vercel P0：
  - 展示 GitHub import 指引；
  - 保存 deployment URL；
  - 不直接调用 Vercel API 创建部署；
  - P1 再做 Vercel OAuth/API。
- Dashboard 项目卡展示 deployed 状态和 deployment URL。
- Admin 展示 connector 状态、commit/deployment 摘要。

阶段成果：

- 当前项目源码可提交到 GitHub。
- 项目记录 commit sha。
- 用户可复制 SQL 到 Supabase 控制台。
- 生成应用包含 Supabase client，但不包含 service role 明文。
- 用户可保存 Vercel deployment URL。
- 发布 checklist 可以解释缺失项。

验收重点：

- Agent 不接触 GitHub token、Supabase service role、Vercel token。
- GitHub commit 前必须用户确认。
- service role key 不返回前端、不进 Agent 上下文、不进 workspace。
- P0 Vercel 是半自动，不做一键创建项目。

测试：

- OAuth state 测试。
- token 加密/不回显测试。
- repo list/create mock 测试。
- commit file allowlist 测试。
- Supabase SQL generation 测试。
- publish checklist 测试。
- deployment URL validation 测试。

### M7：QA Fix、Tool Broker 与运营硬化

目标：

- 把 P0 从“能演示”提升到“稳定内测可观察、可修复、可审计”。

任务：

- 实现 Tool Broker：
  - tool registry；
  - input schema validation；
  - project ownership；
  - connector status；
  - risk level；
  - confirmation request；
  - sensitive output mask；
  - trace event。
- 接入 P0 tools：
  - `project.read_file`
  - `project.read_manifest`
  - `project.apply_patches`
  - `workspace.copy_version`
  - `codex.create_task`
  - `build.create_job`
  - `github.list_repos`
  - `github.create_repo`
  - `github.commit_files`
  - `supabase.generate_schema_sql`
  - `supabase.test_connection`
  - `deploy.save_manual_url`
- 实现 QA Fix Agent：
  - build error summary；
  - 相关文件提取；
  - patch 或 repair CodexTask；
  - 自动修复最多 2 次；
  - 低置信度要求用户确认。
- 强化 secret masking：
  - build logs；
  - codex logs；
  - deploy logs；
  - Admin config；
  - trace payload。
- Admin 运营视图：
  - model usage；
  - agent runs；
  - trace events；
  - codex tasks；
  - build jobs；
  - preview snapshots；
  - connector health；
  - recent errors。
- E2E 主流程：
  - 登录；
  - 创建项目；
  - 生成 Spec；
  - 选择 Design；
  - 生成 CodexTask；
  - Docker Codex Worker 修改 workspace；
  - build dist；
  - Preview Service iframe；
  - 选择器修改；
  - GitHub commit。
- 写入演示 runbook。

阶段成果：

- 构建失败可自动修复或给出可理解失败原因。
- Admin 能定位失败发生在模型、Codex、构建、Preview、文件保存还是连接器。
- 主流程 E2E 稳定通过。
- 所有日志和 Admin 视图不泄露 secret。

验收重点：

- 高风险工具必须确认。
- Tool Broker 是 Agent 执行工程动作的唯一入口。
- QA Fix 不允许无限重试。
- E2E 证明主链路端到端可用。

测试：

- Tool Broker permission 测试。
- high-risk confirmation 测试。
- QA Fix retry limit 测试。
- secret mask fuzz 测试。
- Admin operations API 测试。
- Playwright E2E 主流程。

---

## 4. 每个里程碑完成定义

一个里程碑只有同时满足以下条件，才算完成：

1. 需求功能可从 UI 走通。
2. 后端 API 有基础测试。
3. 关键 shared schema 有单元测试。
4. 写入型功能遵守 project_version/workspace 版本化规则。
5. Docker 相关服务可以启动或通过配置校验。
6. Chrome 验收完成并记录问题。
7. ChatGPT Web review 完成并保存到 `docs/reviews/`。
8. 没有新增明文 secret。
9. 日志、Admin、API 响应不会泄露 token 或 service role。
10. 已知限制写入阶段总结。

---

## 5. P0 最小演示闭环

```text
登录
  -> 创建“私教预约 Web 应用”
  -> DeepSeek/Mock 生成 App Spec
  -> 用户确认 Spec
  -> 选择 DesignProfile
  -> Core Agent 生成 CodexTask
  -> Workspace Service 创建 project/version workspace
  -> Docker Codex Worker 修改 React/Vite 项目
  -> Build Service 执行 typecheck/build
  -> Preview Service 创建 dist snapshot
  -> Builder iframe 加载 preview
  -> 选择器点击 CTA
  -> 修改文案为“立即预约”
  -> 新 project_version + rebuild + 新 snapshot preview
  -> 打开高级代码模式查看 data-ai-id 和 ai-manifest
  -> GitHub OAuth
  -> 选择或创建 repo
  -> 提交当前版本源码
  -> 保存 Vercel URL
  -> Admin 查看 agent/codex/build/preview/version 记录
```

---

## 6. 里程碑依赖关系

```text
M0 数据底座
  -> M1 AppSpec / Design / Orchestrator
    -> M2 CodexTask / Workspace / Docker Codex Worker
      -> M3 Build / Static Preview Service
        -> M4 Inspector / Selector Patch
          -> M5 Code Mode / Version History
            -> M6 GitHub / Supabase / Deploy
              -> M7 QA Fix / Tool Broker / Admin Hardening
```

关键依赖：

- M2 不能跳过 Workspace Service，否则 M3/M4/M5 的版本级 preview 都无法可靠实现。
- M3 必须先有 Static Preview Service，M4 才能做真实 iframe selector。
- M4 必须保证 `data-ai-id + manifest`，M5/M7 才能做可追踪修复。
- M6 所有 connector 动作必须经过确定性后端，不能交给 Agent 自由执行。

---

## 7. P1 延展方向

M0-M7 完成后再考虑：

- WebContainer Developer Mode；
- Vercel OAuth/API 一键部署；
- Supabase OAuth 与自动 apply migration；
- GitHub App；
- Visual Diff；
- Race Design；
- Mini Program Target；
- miniprogram-ci preview/upload；
- 对象存储 + CDN 承载 preview snapshots；
- 企业 workspace / 成员 / 权限 / 审计。
