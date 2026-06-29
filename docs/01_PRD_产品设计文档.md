# 01｜产品设计文档 PRD

> 项目暂名：**Result-first AI App Builder**
> 文档用途：作为与 Codex 协作开发的产品基线。
> 产品方向：面向非技术用户的 AI 应用生成、微调、预览与部署平台。
> 关键取舍：**结果优先，不默认展示 Web IDE；P0 使用“宿主机持久化 workspace + Docker 隔离执行 Codex + Vite build 生成 dist + 自有 Preview Service 静态预览”；不默认 WebContainer、不做 per-user Vite dev server、不做 HMR。Agent 负责生成和判断，OAuth、部署、文件写入、构建、预览承载等工程动作由确定性系统执行。**

---

## 1. 背景与问题定义

### 1.1 背景

Bolt、Atoms、v0、Stitch、OpenDesign 等产品都在解决同一类问题：用户通过自然语言、截图或设计意图，快速得到一个可运行或可交付的应用雏形。

但这些产品在默认体验上有明显差异：

| 类型 | 代表 | 默认体验 | 适合用户 |
|---|---|---|---|
| IDE-first | Bolt / Atoms | Chat + 文件树 + Preview + Terminal + Deploy | 会一点代码，愿意看工程细节的人 |
| Design-first | Stitch / OpenDesign | 设计画布、视觉方案、选择器微调、交付代码 | 产品、设计、创业者、视觉优先用户 |
| Result-first | 本项目 | 用户描述需求，直接看到结果、可交互预览、选择器微调、一键部署 | 非技术用户、小团队、业务人员 |

当前判断：

- 非技术用户不关心 `pnpm install`、`package.json`、终端、文件树。
- 用户真正关心的是：**效果是否像、能否点击、能否保存数据、能否发布、能否继续改。**
- 因此本项目不默认做完整 Web IDE，而是把代码编辑器、日志、文件树放到高级模式。
- 默认主路径是：**Prompt → App Spec → 设计方向 → CodexTask → Docker 内 Codex 修改受控 Vite workspace → build dist → 自有 Preview Service 静态预览 → 选择器微调 → 版本级重建 → GitHub/Vercel/Supabase → 发布。**

### 1.2 要解决的核心问题

用户想要创建一个业务应用，但通常缺少以下能力：

1. 不会把业务需求拆成页面、数据表、API 和状态流。
2. 不会设计页面视觉和交互。
3. 不会搭建前端工程。
4. 不会处理登录、数据库、文件存储、权限等后端能力。
5. 不会部署到线上。
6. 不知道 AI 修改了哪里，也不敢持续迭代。

本产品的目标是把上述能力封装为一个连续体验：

```text
自然语言需求
  -> 结构化 App Spec
  -> 设计方向
  -> CodexTask 工程任务
  -> Docker 隔离环境中修改持久化 Vite workspace
  -> build 生成 dist 静态快照
  -> 自有 Preview Service iframe 展示
  -> 选择器微调并生成新版本快照
  -> 绑定后端
  -> 一键部署
  -> 版本回滚
```

---

## 2. 产品定位

### 2.1 一句话定位

**一个面向非技术用户的 Result-first AI 应用生成与部署平台：用户描述业务目标，系统生成真实可运行的 Web 应用，并通过选择器微调和一键部署完成交付。**

### 2.2 产品不是

本项目 P0 阶段不是：

- 完整 VS Code in Browser。
- 完整 WebContainer 替代品。
- 低代码拖拽平台。
- Figma 替代品。
- 纯静态 UI 生成器。
- 完全自治的 Agent 团队。
- 终端优先的开发者工具。

### 2.3 产品是

本项目 P0 阶段是：

- AI 应用生成平台。
- 设计结果优先的应用构建器。
- 可交互预览平台。
- 选择器微调平台。
- Supabase/Vercel/GitHub 的受控集成平台。
- 可被开发者接手的项目生成器。
- 为 P1 小程序 Target 打基础的 App Spec 编译平台。

---

## 3. 目标用户

### 3.1 Persona A：非技术创业者

- 有产品想法，但不会写代码。
- 希望 1 天内看到可点击 Demo。
- 不想看终端和文件树。
- 关心页面是否好看、是否能分享、是否能上线。
- 可能愿意连接 GitHub/Vercel，但不理解细节。

核心诉求：

> “我只想描述我要什么，然后看到一个能用的结果。”

### 3.2 Persona B：产品经理 / 设计师

- 懂页面结构和用户流程。
- 不一定会完整开发。
- 希望通过自然语言和视觉选择器快速调整页面。
- 需要把 Demo 交给工程师继续开发。

核心诉求：

> “我想快速表达产品想法，并让工程师能接着做。”

### 3.3 Persona C：独立开发者 / 半技术用户

- 能看懂代码，但不想从零搭项目。
- 关心代码质量、文件结构、部署方式。
- 需要高级模式查看代码、diff、日志。

核心诉求：

> “让我先看到结果，必要时我再进代码模式。”

### 3.4 Persona D：平台管理员

- 关心模型成本、安全、构建失败、部署失败、异常任务。
- 需要查看 Agent trace、构建日志、用户连接器授权状态。

核心诉求：

> “平台要可观测、可限流、可回滚、可审计。”

---

## 4. 产品原则

### 4.1 结果优先

用户默认看到的是结果，而不是代码。

主界面必须优先呈现：

- 页面预览；
- 页面结构；
- 当前修改建议；
- 可点击元素；
- 发布状态。

### 4.2 工程动作确定性

以下动作必须由确定性后端执行，不能由 Agent 随机处理：

- OAuth 授权；
- token 换取；
- token 存储；
- scope 校验；
- 文件写入；
- GitHub commit；
- Vercel deploy；
- Supabase schema apply；
- 小程序上传；
- 环境变量注入；
- 权限校验；
- 审计日志。

Agent 可以提出工具调用请求，但工具执行必须经过后端 Tool Broker。

### 4.3 选择器优先于代码编辑

用户想修改一个按钮，不应先去找文件。应先点击预览中的元素。

选择器点击后系统展示：

- 元素类型；
- 文案；
- 样式属性；
- 关联组件；
- 关联源码文件；
- 可直接编辑项；
- AI 修改输入框。

### 4.4 App Spec 是核心中间层

本项目不直接从 Prompt 到代码，而是：

```text
Prompt -> App Spec -> Target Code
```

App Spec 包括：

- 产品目标；
- 页面；
- 用户角色；
- 数据模型；
- 业务流程；
- 组件结构；
- API 能力；
- 权限；
- 部署目标。

后续 Web、小程序、H5、管理后台都可以由 App Spec 编译。

### 4.5 可追溯

每次 AI 修改应记录：

- 用户输入；
- Agent 计划；
- 修改文件；
- 关联页面；
- build 结果；
- preview 版本；
- deploy 版本；
- 是否用户确认。

### 4.6 默认安全

- 不默认开放 interactive terminal。
- 不把 token 暴露给模型。
- 不把 secret 写入前端代码。
- 不自动执行高风险操作。
- 不在用户无确认情况下部署生产版本。

---

## 5. 产品范围

## 5.1 P0 MVP 范围

P0 目标：完成一个可用于面试展示和 Codex 开发的端到端闭环。

### P0 必做

| 模块 | 能力 |
|---|---|
| 项目创建 | 用户输入需求，创建 AI 项目 |
| App Spec | AI 生成结构化需求、页面、数据模型、功能清单 |
| 设计方向 | 生成 2-3 个设计方向，用户选择一个 |
| Codex 工程生成 | 核心 Agent 生成 `CodexTask`，Codex 在 Docker 隔离环境中修改受控 React/Vite 模板 |
| Workspace 持久化 | 每个 project/version 对应宿主机 workspace 文件夹，DB 记录路径、hash、版本、锁状态 |
| 静态 Preview | 运行 `pnpm build` 生成 `dist`，由自有 Preview Service 按 version 提供 iframe 静态预览 |
| 选择器微调 | `data-ai-id + manifest` 选择元素并修改，修改后生成新版本并重建静态 preview |
| 高级代码模式 | 文件树 + CodeMirror + diff + 只读 logs；保存后标记 preview stale 并触发重建 |
| GitHub 集成 | OAuth App 授权，创建/选择 repo，提交源码 workspace |
| Vercel 部署 | 通过 GitHub repo 触发 Vercel 部署或生成部署指引 |
| Supabase 基础绑定 | 生成 Supabase schema plan，支持用户配置项目参数 |
| 版本记录 | 保存每次生成、修改、构建、preview snapshot、发布版本 |
| 只读日志 | codex log / build log / deploy log / agent trace 简化展示 |

### P0 不做

| 不做 | 原因 |
|---|---|
| WebContainer 默认运行 | 增加浏览器兼容、文件同步和商业授权复杂度，非技术用户不需要 |
| per-user Vite dev server / HMR | 多用户下端口、WebSocket、资源回收复杂；P0 采用 build 后静态快照 |
| interactive terminal | 风险大，收益小 |
| 完整多人协作 | 工程量大 |
| GitHub App | P0 先用 OAuth App，P1 再升级 |
| 完整 Supabase OAuth | P0 先支持手动连接 / 项目配置 |
| 小程序上传 | P1 做 miniprogram-ci |
| 复杂支付 | P1/P2 |
| 企业权限体系 | P2 |

---

---

## 5.2 P1 范围

| 模块 | 能力 |
|---|---|
| WebContainer 高级模式 | 给开发者快速本地浏览器运行 |
| 小程序 Target | 由 App Spec 生成 WXML/WXSS/TS |
| miniprogram-ci | 预览二维码、上传开发版本 |
| GitHub App | 更细粒度 repo 权限 |
| Supabase OAuth | 选择 Supabase project，管理 schema |
| Race Design | 多个设计 Agent 并行生成方案 |
| Visual Diff | 选择器修改后截图对比 |
| PR 模式 | 向 GitHub 创建分支和 PR |
| 组件库 | 常用业务组件和设计 token |

---

## 5.3 P2 范围

| 模块 | 能力 |
|---|---|
| 企业团队 | workspace、成员、权限、审计 |
| 第三方平台小程序 | 代开发、代上传、多 appid 管理 |
| Stripe / 支付 | 订阅、订单、支付 webhook |
| Notion/Asana/Linear | 需求和任务连接器 |
| 多 Target | Web、H5、小程序、管理后台多端编译 |
| Agent Marketplace | 可插拔 Agent / Worker |
| 模板市场 | 行业模板、组件模板、数据模板 |

---

## 6. 核心用户路径

### 6.1 创建应用主路径

```text
进入首页
  -> 点击“创建新应用”
  -> 输入自然语言需求
  -> 系统生成 App Spec 草案
  -> 用户确认或修改 Spec
  -> 系统生成 2-3 个设计方向
  -> 用户选择设计方向
  -> 核心 Agent 生成 CodexTask
  -> Workspace Service 从 Vite 模板复制出 project/version workspace
  -> Codex Worker 在 Docker 中挂载当前 workspace 并修改代码
  -> 构建服务执行 typecheck/build
  -> Preview Service 挂载 dist 静态快照
  -> Builder iframe 展示可交互 Preview
  -> 用户通过选择器微调
  -> 系统复制上一版本 workspace，生成新版本并重建 dist
  -> 用户连接 GitHub
  -> 推送源码 workspace
  -> 用户连接/配置 Vercel
  -> 发布
```

### 6.2 选择器微调路径

```text
用户在 Preview 中点击一个按钮
  -> 右侧 Inspector 显示元素信息
  -> 用户直接修改文案/颜色/间距
  -> 系统生成确定性 patch
  -> 后端复制当前 workspace 为新 project_version
  -> 在新 workspace 应用 patch
  -> 构建 dist 静态快照
  -> Preview Service 生成新的 preview_url
  -> iframe 切换到新版本页面
```

AI 修改路径：

```text
用户选中元素并输入“这个按钮更高级一点”
  -> UI Patch Agent 获取 ai-id、manifest、源码片段、当前样式
  -> 生成受限 CodexTask 或 patch plan
  -> Codex Worker / Patch Service 在新 workspace 中修改相关文件
  -> build
  -> Preview Service 挂载新 dist
  -> 展示新 preview 与 diff 摘要
```

### 6.3 发布路径

```text
用户点击发布
  -> 系统检查 build 状态
  -> 系统检查 secret / env / connector 状态
  -> 用户授权 GitHub OAuth
  -> 用户选择 repo 或创建 repo
  -> 系统 commit 当前版本
  -> 用户配置 Vercel
  -> 系统触发部署
  -> 展示部署 URL 和日志
```

### 6.4 高级代码路径

```text
用户点击“查看代码”
  -> 进入高级模式
  -> 左侧文件树
  -> 中间 CodeMirror
  -> 右侧 Preview / Logs
  -> 用户修改代码
  -> 后端复制当前 workspace 为新 project_version
  -> 系统重新构建 dist 并生成新的 snapshot preview
```

---

## 7. 功能需求

### 7.1 项目管理

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-PROJ-001 | 用户可以创建新项目 | P0 |
| FR-PROJ-002 | 用户可以查看项目列表 | P0 |
| FR-PROJ-003 | 用户可以重命名项目 | P0 |
| FR-PROJ-004 | 用户可以归档项目 | P1 |
| FR-PROJ-005 | 用户可以复制项目 | P1 |
| FR-PROJ-006 | 项目必须保存当前 App Spec、文件版本和 preview 状态 | P0 |

### 7.2 Prompt 与 App Spec

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-SPEC-001 | 用户输入自然语言需求后生成 App Spec | P0 |
| FR-SPEC-002 | App Spec 包含页面、角色、功能、数据模型、部署目标 | P0 |
| FR-SPEC-003 | 用户可以编辑 App Spec 中的关键字段 | P0 |
| FR-SPEC-004 | 系统能基于 App Spec 生成代码 | P0 |
| FR-SPEC-005 | App Spec 每次修改必须生成版本 | P0 |
| FR-SPEC-006 | App Spec 和代码文件之间建立 manifest 关系 | P0 |

### 7.3 设计方向

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-DESIGN-001 | 系统基于 App Spec 生成 2-3 个设计方向 | P0 |
| FR-DESIGN-002 | 每个设计方向包含风格名、色彩、字体、页面截图或预览 | P0 |
| FR-DESIGN-003 | 用户可以选择一个方向作为生成基线 | P0 |
| FR-DESIGN-004 | 用户可以要求重新生成设计方向 | P1 |
| FR-DESIGN-005 | 用户可以上传参考图 | P1 |

### 7.4 代码生成

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-CODE-001 | 系统基于受控 React/Vite 模板创建 project/version workspace | P0 |
| FR-CODE-002 | 核心 Agent 必须先生成结构化 `CodexTask`，不可把用户 prompt 原样交给 Codex | P0 |
| FR-CODE-003 | Codex 只能在 Docker 容器中挂载当前 workspace 并修改允许路径 | P0 |
| FR-CODE-004 | 生成代码必须包含 `data-ai-id` 和 `ai-manifest.json` | P0 |
| FR-CODE-005 | 每次生成/修改必须创建新的 `project_version`，不能覆盖旧版本 | P0 |
| FR-CODE-006 | 构建失败时系统可以把错误摘要交给 Codex 修复，最多自动重试有限次数 | P0 |

### 7.5 Preview

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-PREVIEW-001 | 用户可以看到可交互 iframe Preview | P0 |
| FR-PREVIEW-002 | Preview 来源必须是 `pnpm build` 后生成的 `dist` 静态快照 | P0 |
| FR-PREVIEW-003 | Preview 由自有 Preview Service 承载，不为每个用户启动 Vite dev server | P0 |
| FR-PREVIEW-004 | Preview 构建失败时展示错误摘要，并允许自动修复/重试 | P0 |
| FR-PREVIEW-005 | Preview URL 与 `project_version` / `preview_snapshot` 绑定 | P0 |
| FR-PREVIEW-006 | Preview 支持手动刷新 iframe；修改后通过新版本 URL 刷新，不依赖 HMR | P0 |
| FR-PREVIEW-007 | Preview 支持移动/桌面尺寸切换 | P1 |

### 7.6 选择器微调

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-INSPECT-001 | 用户可开启选择器模式 | P0 |
| FR-INSPECT-002 | hover 元素时展示边框高亮 | P0 |
| FR-INSPECT-003 | click 元素后锁定选中状态 | P0 |
| FR-INSPECT-004 | 系统读取 `data-ai-id` 并查 manifest | P0 |
| FR-INSPECT-005 | 右侧 Inspector 显示文案、样式、组件、文件 | P0 |
| FR-INSPECT-006 | 用户可直接修改文案 | P0 |
| FR-INSPECT-007 | 用户可直接修改基础样式 | P0 |
| FR-INSPECT-008 | 用户可输入 AI 微调指令 | P0 |
| FR-INSPECT-009 | AI 只能修改选中元素相关文件 | P0 |
| FR-INSPECT-010 | 修改后复制当前 workspace，生成新版本并重新构建静态 preview snapshot | P0 |

### 7.7 CodeMirror 高级模式

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-IDE-001 | 用户可以打开高级代码模式 | P0 |
| FR-IDE-002 | 显示文件树 | P0 |
| FR-IDE-003 | 使用 CodeMirror 编辑文件 | P0 |
| FR-IDE-004 | 编辑后保存到云端 | P0 |
| FR-IDE-005 | 文件保存需做版本冲突检测 | P0 |
| FR-IDE-006 | 显示 build logs | P0 |
| FR-IDE-007 | 显示 git diff | P1 |
| FR-IDE-008 | 不提供 interactive terminal | P0 |

### 7.8 GitHub OAuth App

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-GH-001 | 用户可以连接 GitHub OAuth App | P0 |
| FR-GH-002 | 后端生成 OAuth state 并校验 callback | P0 |
| FR-GH-003 | token 加密保存 | P0 |
| FR-GH-004 | 用户可以选择已有 repo 或创建 repo | P0 |
| FR-GH-005 | 系统可以提交当前项目文件 | P0 |
| FR-GH-006 | 提交前展示风险和文件列表 | P0 |
| FR-GH-007 | workflow 文件修改需二次确认 | P1 |

### 7.9 Supabase 绑定

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-SUPA-001 | 系统可以根据 App Spec 生成数据表草案 | P0 |
| FR-SUPA-002 | 用户可以手动填写 Supabase URL / anon key | P0 |
| FR-SUPA-003 | 用户可以配置 service role key 到后端 vault | P0，但可选 |
| FR-SUPA-004 | 平台不把 service role key 暴露给前端或 Agent | P0 |
| FR-SUPA-005 | 生成应用可使用 anon key 访问 Supabase | P0 |
| FR-SUPA-006 | 复杂写操作可走平台 BFF / Edge Function | P1 |
| FR-SUPA-007 | 支持 Supabase OAuth 选择项目 | P1 |

### 7.10 Vercel 部署

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-DEPLOY-001 | 用户可在 build 成功后发布 | P0 |
| FR-DEPLOY-002 | P0 优先通过 GitHub repo 接 Vercel | P0 |
| FR-DEPLOY-003 | 发布前检查 env | P0 |
| FR-DEPLOY-004 | 发布后展示 URL | P0 |
| FR-DEPLOY-005 | 记录 deployment version | P0 |
| FR-DEPLOY-006 | 支持 rollback | P1 |
| FR-DEPLOY-007 | 直接调用 Vercel API 创建部署 | P1 |

### 7.11 小程序 Target

| 编号 | 需求 | 优先级 |
|---|---|---|
| FR-MP-001 | App Spec 可以转换为小程序页面规格 | P1 |
| FR-MP-002 | 生成 WXML/WXSS/TS/JSON | P1 |
| FR-MP-003 | 支持 miniprogram-ci preview | P1 |
| FR-MP-004 | 返回预览二维码 | P1 |
| FR-MP-005 | 支持 upload 开发版本 | P1 |
| FR-MP-006 | 正式提审发布不放 P1 | P2 |

---

## 8. 非功能需求

### 8.1 性能

| 指标 | P0 目标 |
|---|---|
| 首次 App Spec 生成 | 30-90 秒内 |
| 首次 Codex 工程生成 | 60-240 秒内 |
| 首次 build + preview snapshot | 30-120 秒内 |
| 简单选择器文案修改 | 20-60 秒内完成新版本 preview 更新 |
| 构建失败摘要 | 5 秒内展示 |
| 静态 preview 首屏加载 | 2 秒内 |
| 项目列表加载 | 1 秒内 |

### 8.2 安全

- OAuth state 必须防 CSRF。
- token 必须加密存储。
- Agent 不可见 secret。
- Codex 不得直接在宿主机进程中执行，必须进入 Docker 隔离环境。
- Docker 容器只挂载当前 job 的 workspace，且以非 root 用户运行。
- 禁止把 Docker socket、宿主机 `.env`、其他用户 workspace 挂进容器。
- build 环境不自动挂载生产 secret。
- GitHub 提交前展示文件列表。
- Supabase service role key 不进入前端代码。
- 只读日志默认隐藏敏感字段。

### 8.3 可观测性

每次生成/修改都应记录：

- user_id；
- project_id；
- run_id；
- prompt；
- mode；
- model；
- token usage；
- tool calls；
- files changed；
- build result；
- preview snapshot URL；
- error summary。

### 8.4 可维护性

- 所有 Agent 输出必须结构化。
- 所有工具调用必须 schema 化。
- 文件修改必须使用 patch 或完整内容版本。
- ProjectState 必须可序列化。
- 支持重放一次 Agent run 的关键步骤。

---

## 9. 成功指标

### 9.1 产品指标

| 指标 | P0 目标 |
|---|---|
| 创建项目成功率 | > 80% |
| 首次 Preview 成功率 | > 70% |
| 选择器修改成功率 | > 80% |
| GitHub 连接成功率 | > 80% |
| 发布成功率 | > 60% |
| 用户从 prompt 到 preview 中位时间 | < 5 分钟 |

### 9.2 质量指标

| 指标 | P0 目标 |
|---|---|
| build 通过率 | > 70% |
| secret 泄露事故 | 0 |
| Agent 修改越界率 | < 5% |
| manifest 丢失率 | < 5% |
| 代码保存冲突未处理率 | 0 |

---

## 10. 关键产品取舍

### 10.1 为什么不默认 WebContainer

- 用户不一定需要看开发过程。
- WebContainer 增加浏览器兼容、文件同步、商业授权和运行性能不确定性。
- 初期更应该验证生成、静态预览、微调、部署闭环。
- 宿主机 workspace + Docker Codex Worker 更接近真实工程执行环境。
- 自有 Preview Service 的静态快照更接近真实部署产物。

### 10.1.1 为什么 P0 不做 HMR / per-user Vite dev server

- 非技术用户只需要看到稳定成品，不需要看半成品热更新过程。
- 多用户场景下，每个 Vite dev server 都需要端口、WebSocket、文件监听和生命周期回收。
- HMR 不能证明项目可发布，最终仍然需要 build。
- P0 用“版本级刷新”：修改完成并 build 成功后，iframe 切换到新的 preview URL。

### 10.1.2 为什么选择自有 Preview Service

- P0 不依赖外部 preview 平台即可演示闭环。
- 可以按 project/version 做鉴权、CSP、iframe sandbox、访问记录和过期清理。
- 可以统一支持本机磁盘和对象存储两种 dist 来源。
- 后续迁移到 CDN 或对象存储时接口保持稳定。

### 10.2 为什么选择 CodeMirror

- 足够轻。
- 适合嵌入产品。
- P0 只需要编辑、保存、语法高亮、diff，不需要完整 VS Code。
- 高级模式可后续替换为 Monaco。

### 10.3 为什么 GitHub P0 用 OAuth App

- 实现快。
- 适合面试作业和 MVP。
- 可直接完成 repo 提交。
- P1 再升级 GitHub App 以获得细粒度权限。

### 10.4 为什么要 App Spec

- 避免从 prompt 直接生成混乱代码。
- 支持多 target。
- 支持可追溯。
- 让 Codex 可以分阶段完成开发。
- 方便后续支持小程序。

---

## 11. 面向 Codex 的开发边界

Codex 实现时必须遵守：

1. 不要实现 interactive terminal。
2. 不要把 OAuth token 暴露到前端。
3. 不要让 Agent 直接执行 GitHub/Vercel/Supabase API。
4. 所有外部 API 调用必须经过后端 service。
5. 所有文件保存必须带 `project_version`。
6. 选择器必须优先使用 `data-ai-id`。
7. P0 使用宿主机持久化 workspace + Docker Codex Worker + 静态 Preview Service；不实现 WebContainer。
8. P0 不实现 HMR，不为每个用户启动 Vite dev server。
9. Agent Orchestrator 自研轻量状态机，直接调用模型 API。
10. 核心 Agent 输出 `AppSpec` / `DesignProfile` / `CodexTask` 等 JSON schema。
11. Codex 只执行结构化工程任务，不能直接消费未经压缩的用户 prompt。
12. 每个 P0 功能都必须有可演示路径。

---

## 12. P0 里程碑

### M0：基础项目骨架

- 前端 React/Vite。
- 后端 API。
- 数据库 schema。
- 用户登录。
- 项目列表。

### M1：项目创建与 App Spec

- Prompt 输入。
- 调用模型生成 App Spec。
- 展示和编辑 App Spec。
- 保存版本。

### M2：Codex 工程生成与 Workspace

- 准备 React/Vite 受控模板。
- 根据 App Spec + DesignProfile 生成 CodexTask。
- Workspace Service 创建宿主机 project/version workspace。
- Codex Worker 在 Docker 中挂载 workspace 并修改代码。
- 生成 `data-ai-id` 与 `ai-manifest.json`。
- 高级模式 CodeMirror 查看文件。

### M3：静态 Preview Service

- 构建服务执行 typecheck/build。
- build 成功后生成 `dist`。
- Preview Service 读取本机磁盘或对象存储中的 dist。
- iframe 展示 preview URL。
- build logs 与错误摘要。

### M4：选择器微调

- iframe 注入 inspector。
- hover/click 选择。
- Inspector 面板。
- 文案/样式直接修改。
- AI patch 修改。

### M5：GitHub + Vercel 发布

- GitHub OAuth App。
- repo 创建/选择。
- commit 文件。
- Vercel 发布路径。
- deployment 记录。

### M6：Supabase 基础绑定

- 数据模型草案。
- Supabase 配置。
- 生成前端 Supabase client。
- env 检查。

---

## 13. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| AI 生成代码 build 失败 | preview 不可用 | Codex repair loop 自动修复，展示错误摘要 |
| Codex 越权读取宿主机文件 | 严重安全事故 | Docker 非 root、只挂当前 workspace、禁挂 Docker socket、网络/文件路径限制 |
| workspace 权限错乱 | 多用户文件污染或构建失败 | UID/GID 对齐、workspace lock、每个 project/version 独立目录 |
| selector 找不到源码 | 微调失败 | `data-ai-id` 主路径，source map fallback |
| Preview Service 路径穿越 | 泄露服务器文件 | preview_id 映射真实 dist root，禁止直接拼接用户路径，静态文件白名单 |
| OAuth scope 过大 | 用户不信任 | P0 明确说明权限，P1 GitHub App |
| Supabase secret 泄露 | 严重安全事故 | service role key 只进 vault，不进前端/Agent/Codex workspace |
| Static Snapshot Preview 成本上升 | 成本不可控 | 队列、限流、构建缓存、dist 过期清理 |
| 用户不理解 App Spec | 增加认知负担 | 默认折叠复杂字段，用自然语言摘要 |
| 发布链路复杂 | 转化下降 | P0 用 GitHub/Vercel 标准链路，减少自研 |

---
