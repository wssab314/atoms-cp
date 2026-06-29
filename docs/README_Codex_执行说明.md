# README｜给 Codex 的执行说明

> 本目录包含 5 份核心文档，用于指导 Codex 从零实现一个 Result-first AI App Builder。
> 核心方向：不默认复刻 Bolt/Atoms 的 Web IDE，而是实现 Prompt → App Spec → CodexTask → Docker Codex Worker 修改 Vite workspace → build dist → 自有 Preview Service 静态预览 → 选择器微调 → GitHub/Vercel/Supabase 发布闭环。

---

## 1. 文档清单

| 文件 | 用途 |
|---|---|
| `01_PRD_产品设计文档.md` | 产品定位、范围、需求、里程碑 |
| `02_PAGE_SPEC_页面说明文档.md` | 页面结构、交互、组件、状态 |
| `03_USER_STORIES_完整用户故事.md` | Epic、用户故事、验收标准 |
| `04_TECH_ARCH_技术架构文档.md` | 技术架构、数据模型、API、构建、部署 |
| `05_AGENT_DESIGN_Agent设计文档.md` | Agent Orchestrator、Agent 职责、schema、工具、护栏 |

---

## 2. 已确认的关键决策

1. **GitHub 使用 OAuth App**，P1 再考虑 GitHub App。
2. **Agent SDK 自研轻量 Orchestrator**，直接调用模型 API。
3. **Codex 作为工程执行 agent**，接收核心 Agent 生成的结构化 CodexTask，不直接接收原始用户 prompt。
4. **Workspace 使用宿主机文件夹持久化**，每个 project/version 独立目录。
5. **Codex 必须在 Docker 容器中执行**，只 bind mount 当前 workspace，非 root 运行。
6. **Preview 使用自有 Preview Service**，读取 `pnpm build` 生成的 `dist` 静态快照。
7. **P0 不做 WebContainer、HMR、per-user Vite dev server、interactive terminal**。
8. **CodeMirror 作为高级代码模式**，不作为默认主界面。
9. **选择器使用 `data-ai-id + manifest`** 作为主路径。
10. **OAuth、token、部署、workspace 管理、构建、预览承载由确定性系统执行**。
11. **P0 主线是 Web App Builder**，小程序作为 P1 延展能力。

## 3. Codex 开发优先级

### 第一优先级：跑通主链路

```text
登录/项目
  -> 创建项目
  -> 生成 App Spec
  -> 选择设计方向
  -> 生成 CodexTask
  -> 创建宿主机 Vite workspace
  -> Docker Codex Worker 修改代码
  -> pnpm build 生成 dist
  -> Preview Service iframe 展示静态 snapshot
  -> 选择器修改文案
  -> 新版本 build + snapshot refresh
  -> GitHub OAuth
  -> Commit workspace files
```

### 第二优先级：完善稳定性

```text
版本历史
构建失败摘要
QA Fix Agent
Supabase schema SQL
发布 checklist
```

### 第三优先级：增强体验

```text
CodeMirror diff
移动预览
Vercel API
小程序 target
WebContainer Developer Mode P1
```

---

## 4. 不要实现的内容

P0 阶段不要实现：

- interactive terminal；
- WebContainer；
- HMR / per-user Vite dev server；
- 完整 VS Code；
- 多人协同编辑；
- GitHub App；
- Supabase OAuth 自动 apply；
- Vercel API 一键部署；
- 小程序上传；
- Stripe 支付；
- Notion/Asana 连接器。

---

## 5. 建议开发顺序

### M0：基础工程

任务：

- 建 monorepo。
- 建 web / api / shared。
- 建基础数据库表。
- 实现登录或 mock auth。
- 实现项目 CRUD。

验收：

- 能创建项目并在 Dashboard 看到。

### M1：App Spec

任务：

- 定义 `AppSpec` schema。
- 实现 Spec Agent。
- 实现 `/spec/generate`。
- 展示 Spec 审核页。
- 支持确认 Spec。

验收：

- 输入 prompt 可以生成结构化 App Spec。

### M2：Codex 工程生成与 Workspace

任务：

- React/Vite 受控模板。
- CodexTask schema。
- Workspace Service：创建、复制、锁定、归档宿主机 workspace。
- Docker Codex Worker：挂载当前 workspace，运行 Codex，采集 changed_files。
- `data-ai-id` 注入。
- `ai-manifest.json`。
- CodeMirror 只读/编辑。

验收：

- 能看到文件树和代码。
- Codex 可以在 Docker workspace 中修改 Vite 项目。
- DB 记录 project_version、workspace_path、changed_files。

### M3：静态 Preview Service

任务：

- build_jobs。
- builder worker。
- 执行 `pnpm typecheck` / `pnpm build`。
- 生成 dist。
- preview_snapshots。
- 自有 Preview Service：静态文件读取、SPA fallback、CSP、iframe 支持。
- 返回 preview URL。

验收：

- 生成项目能在 iframe 中点击预览。
- 预览来自 dist 静态快照。
- 不依赖 HMR、Vite dev server 或 WebContainer。

### M4：选择器

任务：

- inspector runtime。
- postMessage bridge。
- Inspector 面板。
- direct text patch。
- AI selector patch。

验收：

- 点击预览中的按钮，可以修改文案并重建预览。

### M5：GitHub

任务：

- OAuth start/callback。
- token 加密保存。
- list repos。
- create repo。
- commit files。

验收：

- 当前项目文件可提交到 GitHub。

### M6：Supabase + 发布

任务：

- Supabase 配置。
- SQL schema 生成。
- 发布 checklist。
- Vercel 手动部署 URL 保存。

验收：

- 用户可以完成从项目生成到发布记录的闭环。

---

## 6. Codex 生成代码时必须遵守

1. 所有前后端共享类型放在 `packages/shared`。
2. 所有 Agent 输出都需要 schema 校验。
3. 所有文件写入都必须创建或关联 project_version。
4. 所有外部 connector 调用都在后端。
5. 前端不出现 GitHub token、service role key、model API key。
6. codex/build logs 展示前需要 mask secret。
7. selector patch 不允许删除 `data-ai-id`。
8. direct text patch 不需要调用模型。
9. 不要把用户项目文件只存在浏览器本地。
10. 每个长任务都要有 status、SSE events 和错误摘要。
11. Codex 不允许直接在宿主机进程中执行。
12. Preview Service 不允许按用户输入路径直接读取宿主机文件。

---

## 7. 最小演示脚本

演示时按这个脚本走：

1. 登录。
2. 创建项目：输入“做一个私教预约 Web 应用”。
3. 等待 App Spec 生成。
4. 确认页面和数据模型。
5. 选择一个设计方向。
6. 生成应用。
7. 等待 Codex Worker 生成代码、build dist 和 Preview Service snapshot。
8. 在 Preview 中点击 CTA 按钮。
9. 修改按钮文案为“立即预约”。
10. 等待新版本 snapshot preview 更新。
11. 打开高级代码模式，展示 `data-ai-id` 和 manifest。
12. 连接 GitHub OAuth。
13. 创建 repo 或选择 repo。
14. 提交项目文件。
15. 打开版本历史，展示每一步记录。

---
