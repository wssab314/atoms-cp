# 05｜Agent 设计文档

> 文档用途：定义本项目的自研轻量 Agent Orchestrator、Agent 职责、上下文、工具、JSON schema、状态机、护栏与 Codex 实现步骤。
> 关键原则：**核心 Agent 不负责 OAuth、部署、token、文件系统权限、workspace 管理等确定性工程动作；核心 Agent 负责理解、生成、规划、产出结构化 CodexTask；Codex 作为工程执行 agent，只能在 Docker 隔离 workspace 中修改当前 Vite 项目。**

---

## 1. 总体设计原则

### 1.1 不做“自由多 Agent 聊天”

本项目不是让多个 Agent 在后端自由对话。P0 的 Agent 设计应是：

```text
确定性 Orchestrator
  -> 根据任务选择 Agent
  -> 组装最小上下文
  -> 调用模型 API
  -> 校验结构化输出
  -> 转成 tool call / patch / spec / design
  -> 交给确定性后端执行
```

### 1.2 Agent、Codex 与确定性系统职责边界

| 能力 | 核心 Agent | Codex Worker | 确定性系统 |
|---|---:|---:|---:|
| 理解用户需求 | 是 | 否 | 否 |
| 生成 App Spec | 是 | 否 | 存储、校验 |
| 生成设计方向 | 是 | 否 | 存储、展示 |
| 生成 CodexTask | 是 | 否 | 校验、入队 |
| 修改 React/Vite 源码 | 否 | 是，在 Docker workspace 中 | workspace、锁、版本管理 |
| 选择器局部修改 | 生成 patch plan / CodexTask | 可执行局部工程修改 | manifest 查找、patch 应用 |
| OAuth 授权 | 否 | 否 | 是 |
| token 换取和存储 | 否 | 否 | 是 |
| GitHub commit | 提出请求 | 否 | 是 |
| Supabase schema 执行 | 提出 SQL | 否 | 是 |
| Vercel 部署 | 提出建议 | 否 | 是 |
| 构建项目 | 否 | 可触发验证命令 | 是 |
| 解析构建错误 | 是 | 是，用于 repair | 提供日志和错误摘要 |
| Preview 承载 | 否 | 否 | 自有 Preview Service 静态承载 dist |
| interactive shell | 否 | 否 | P0 不做 |

### 1.3 Agent 结果必须结构化

所有 Agent 输出必须符合 JSON schema。禁止依赖自然语言解析关键字段。

原因：

- 便于后端校验。
- 便于重试和 repair。
- 便于 Codex 实现。
- 便于 trace 和审计。

### 1.4 默认最小上下文

不要把完整项目和完整聊天记录塞给模型。

按任务选择上下文：

| 任务 | 上下文 |
|---|---|
| 生成 App Spec | 用户 prompt、创建表单字段、少量行业模板 |
| 生成设计 | confirmed App Spec、视觉偏好 |
| 生成 CodexTask | App Spec、design profile、目标模板、允许/禁止路径、validation commands |
| 选择器修改 | ai-id、manifest entry、相关文件片段、当前样式、用户指令 |
| 修复 build | 构建错误摘要、相关文件、package 信息 |
| 发布建议 | checklist、项目状态，不包含 token |

---

## 2. Orchestrator 总体架构

### 2.1 核心组件

```text
Agent Orchestrator
  ├─ Intent Router
  ├─ Context Assembler
  ├─ Model Client
  ├─ Schema Validator
  ├─ Repair Loop
  ├─ Tool Broker Client
  ├─ Patch Planner
  ├─ Trace Recorder
  └─ Budget Controller
```

### 2.2 Orchestrator 状态机

```text
created
  -> context_assembled
  -> model_called
  -> output_validated
  -> tool_requested
  -> waiting_confirmation
  -> tool_executed
  -> patch_applied
  -> build_requested
  -> completed
  -> failed
```

不是每个任务都经过所有状态。例如生成 App Spec 不需要 tool_requested。

### 2.3 AgentRun 输入

```ts
export type AgentMode =
  | 'router'
  | 'spec'
  | 'design'
  | 'codex_task'
  | 'selector_patch'
  | 'repair'
  | 'deploy_advice'
  | 'chat';

export interface AgentRunInput {
  projectId: string;
  userId: string;
  mode: AgentMode;
  userInstruction: string;
  selectedAiId?: string;
  projectVersionId?: string;
  specVersionId?: string;
  designProfileId?: string;
  allowedTools: string[];
  maxModelCalls?: number;
  maxToolCalls?: number;
}
```

### 2.4 AgentRun 输出

```ts
export interface AgentRunOutput {
  status: 'success' | 'failed' | 'needs_confirmation';
  summary: string;
  resultType:
    | 'app_spec'
    | 'design_profiles'
    | 'codex_task'
    | 'patch_plan'
    | 'tool_call_request'
    | 'repair_plan'
    | 'message';
  result: unknown;
  warnings?: string[];
  nextActions?: Array<{
    label: string;
    action: string;
  }>;
}
```

---

## 3. Agent 角色设计

P0 推荐只实现 6 个 Agent。不要一开始实现很多人格化 Agent。

### 3.1 Router Agent

#### 目的

判断用户当前输入属于哪类任务，并选择后续工作流。

#### 输入

- 用户输入；
- 当前项目状态；
- 是否选中元素；
- 最近一次失败状态；
- 当前页面模式。

#### 输出 schema

```ts
export interface RouterOutput {
  taskType:
    | 'create_spec'
    | 'edit_spec'
    | 'generate_design'
    | 'generate_codex_task'
    | 'selector_edit'
    | 'global_style_edit'
    | 'add_page'
    | 'fix_build'
    | 'connect_github'
    | 'deploy'
    | 'answer_question'
    | 'unknown';
  targetAgent:
    | 'spec'
    | 'design'
    | 'codex_task_planner'
    | 'selector_patch'
    | 'qa_fix'
    | 'deploy_advice'
    | 'none';
  riskLevel: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  reasoningSummary: string;
  requiredContext: string[];
}
```

#### 示例

用户输入：

```text
把这个按钮改得更像 Apple 风格
```

当前有 `selectedAiId`。

输出：

```json
{
  "taskType": "selector_edit",
  "targetAgent": "selector_patch",
  "riskLevel": "low",
  "requiresConfirmation": false,
  "reasoningSummary": "用户要求修改当前选中元素的视觉样式。",
  "requiredContext": ["selected_element", "manifest_entry", "source_snippet", "computed_style"]
}
```

### 3.2 Spec Agent

#### 目的

把用户自然语言需求转换成结构化 App Spec。

#### 职责

- 提取应用目标。
- 识别目标用户。
- 拆解页面。
- 识别用户角色。
- 识别核心流程。
- 生成数据模型草案。
- 生成功能优先级。
- 标记风险和待确认问题。

#### 不负责

- 不生成完整代码。
- 不执行数据库迁移。
- 不连接 Supabase。

#### 输出 schema

```ts
export interface AppSpec {
  appName: string;
  oneLineGoal: string;
  targetUsers: Array<{
    name: string;
    description: string;
  }>;
  appType: 'landing' | 'dashboard' | 'saas' | 'booking' | 'content' | 'admin' | 'other';
  target: 'web' | 'mini_program';
  pages: Array<{
    id: string;
    name: string;
    route: string;
    purpose: string;
    priority: 'P0' | 'P1' | 'P2';
    sections: Array<{
      id: string;
      name: string;
      purpose: string;
      keyElements: string[];
    }>;
  }>;
  userFlows: Array<{
    id: string;
    name: string;
    steps: string[];
  }>;
  dataModels: Array<{
    id: string;
    tableName: string;
    description: string;
    fields: Array<{
      name: string;
      type: 'uuid' | 'text' | 'number' | 'boolean' | 'timestamp' | 'json' | 'enum';
      required: boolean;
      description: string;
    }>;
    relationships?: Array<{
      field: string;
      references: string;
    }>;
  }>;
  features: Array<{
    id: string;
    name: string;
    description: string;
    priority: 'P0' | 'P1' | 'P2';
  }>;
  authRequired: boolean;
  backendRequired: boolean;
  integrations: Array<'github' | 'supabase' | 'vercel' | 'stripe' | 'notion' | 'none'>;
  designHints: {
    styleKeywords: string[];
    tone: string;
    avoid: string[];
  };
  openQuestions: string[];
  risks: string[];
}
```

#### Prompt 要点

System Prompt 应强调：

- 输出必须是 JSON。
- 不要生成代码。
- 页面数量 P0 控制在 3-6 个。
- 数据模型只生成草案。
- 如果需求不清晰，用合理默认值并写 openQuestions。
- 不要包含投资、医疗、法律等高风险建议内容。

### 3.3 Design Agent

#### 目的

根据 App Spec 生成 2-3 个设计方向。

#### 职责

- 生成设计风格。
- 定义色彩、字体、空间、卡片风格。
- 生成页面布局描述。
- 给代码生成器提供设计 token。

#### 输出 schema

```ts
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

export interface DesignAgentOutput {
  profiles: DesignProfile[];
}
```

#### P0 限制

- 只生成 JSON 设计描述，不直接生成图片。
- 前端可以用设计描述渲染简单卡片预览。
- 代码生成使用用户选择的 `DesignProfile`。

### 3.4 CodexTask Planner Agent

#### 目的

根据 App Spec 和 Design Profile 生成结构化工程任务，让 Codex 在受控 Vite workspace 中完成真实代码修改。

#### 职责

- 将产品需求转成工程目标。
- 指定允许修改的文件路径。
- 指定禁止触碰的路径和安全限制。
- 指定 design tokens、组件约束、依赖策略。
- 指定 validation commands。
- 给 Codex 明确 expected outputs。

#### 不负责

- 不直接写入宿主机文件。
- 不直接运行 shell。
- 不直接启动 build。
- 不直接生成 preview URL。
- 不读取 secret。

#### 输出 schema

```ts
export interface CodexTaskOutput {
  summary: string;
  task: {
    type: 'initial_generate' | 'selector_edit' | 'code_edit' | 'repair';
    goal: string;
    affectedPages: string[];
    affectedAiIds?: string[];
    allowedPaths: string[];
    forbiddenPaths: string[];
    dependencyPolicy: 'forbid_new_dependencies' | 'allow_package_json_with_review';
    implementationRules: string[];
    validationCommands: string[];
    expectedOutputs: string[];
  };
  risks: string[];
}
```

#### P0 推荐方式

```text
AppSpec + DesignProfile
  -> CodexTask Planner Agent
  -> Schema Validator
  -> Workspace Service 创建/复制 workspace
  -> Docker Codex Worker 执行
  -> Build Service 校验
  -> Preview Service 发布 dist snapshot
```

Codex 的能力应该放大到“工程闭环执行”：代码修改、读取项目结构、修复 build 错误、保持 manifest，但不要让它直接承担产品大脑。

#### Codex 防线

- 限制文件路径。
- 默认禁止新增依赖。
- 禁止读取 `.env`、vault、其他用户 workspace。
- 禁止改平台后端代码。
- 输出必须包含 changed_files 与 summary。
- build 失败只能进入有限次数 repair loop。

### 3.5 Selector Patch Agent

#### 目的

处理用户对选中元素的自然语言微调。

#### 输入

- selected ai-id；
- manifest entry；
- 源码文件片段；
- 当前 text/className/computedStyle；
- 用户指令；
- 允许修改文件列表。

#### 输出 schema

```ts
export interface SelectorPatchOutput {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  filesToChange: string[];
  patchPlan: Array<{
    file: string;
    operation: 'replace_text' | 'replace_className' | 'replace_block' | 'edit_css_token';
    targetAiId?: string;
    description: string;
  }>;
  patches: Array<{
    file: string;
    originalSnippet: string;
    newSnippet: string;
  }>;
  requiresBuild: boolean;
  warnings: string[];
}
```

#### 修改边界

- 默认只允许修改 manifest entry 指向的文件。
- 如果需要改 CSS token，可以允许修改 `src/styles/tokens.css`。
- 不允许修改 connector、env、auth、package.json。

#### 示例

用户选中 `home.hero.primaryCta`，输入：

```text
这个按钮更高级一点，弱化纯黑，圆角更自然
```

Agent 应返回：

- 修改 button className；
- 不改业务逻辑；
- 不改其他页面。

### 3.6 QA Fix Agent

#### 目的

根据 build 错误自动修复代码。

#### 输入

- build error summary；
- build logs 截断版；
- 相关文件；
- package.json；
- 最近一次改动摘要。

#### 输出 schema

```ts
export interface QaFixOutput {
  summary: string;
  rootCause: string;
  filesToChange: string[];
  patches: Array<{
    file: string;
    originalSnippet: string;
    newSnippet: string;
  }>;
  confidence: 'low' | 'medium' | 'high';
  retryBuild: boolean;
  warnings: string[];
}
```

#### 防线

- 修复次数限制：例如每个 build 最多自动修复 2 次。
- 低置信度时要求用户确认。
- 不允许大规模重写整个项目。

### 3.7 Deploy Advice Agent

#### 目的

解释发布 checklist、生成用户可理解的部署建议。

#### 不负责

- 不调用 Vercel。
- 不提交 GitHub。
- 不读取 token。

#### 输出 schema

```ts
export interface DeployAdviceOutput {
  readiness: 'ready' | 'needs_action' | 'blocked';
  summary: string;
  checklist: Array<{
    item: string;
    status: 'pass' | 'warning' | 'fail';
    action?: string;
  }>;
  userInstructions: string[];
}
```

---

## 4. ProjectState 设计

### 4.1 ProjectState 定义

```ts
export interface ProjectState {
  project: {
    id: string;
    name: string;
    target: 'web' | 'mini_program';
    status: string;
  };
  currentSpec?: AppSpec;
  currentDesignProfile?: DesignProfile;
  currentVersion?: {
    id: string;
    version: number;
    source: string;
    summary: string;
  };
  filesSummary: Array<{
    path: string;
    hash: string;
    version: number;
    size: number;
  }>;
  manifestSummary?: {
    entriesCount: number;
    sampleAiIds: string[];
  };
  buildState?: {
    status: 'none' | 'queued' | 'running' | 'success' | 'failed';
    errorSummary?: string;
    previewUrl?: string;
  };
  connectors: {
    github: 'not_connected' | 'connected' | 'expired';
    supabase: 'not_configured' | 'configured' | 'error';
    vercel: 'not_connected' | 'manual' | 'connected';
  };
}
```

### 4.2 ProjectState 用途

- Router 判断任务。
- Chat 左侧显示摘要。
- Deploy checklist。
- Agent 上下文裁剪。
- Trace 回放。

### 4.3 不应放入 ProjectState 的内容

- GitHub token。
- Supabase service role key。
- Vercel token。
- 原始完整 build log。
- 大文件全文。

---

## 5. Memory 设计

### 5.1 P0 Memory 分层

| 层 | 存储 | 内容 |
|---|---|---|
| Conversation Memory | agent_runs / trace_events | 最近用户指令与 Agent 摘要 |
| Project Memory | app_specs / project_versions | 项目结构和版本 |
| Code Memory | project_files / manifest | 文件和元素映射 |
| User Preference | users metadata P1 | 用户偏好 |

### 5.2 Memory 写入规则

- 只写结构化摘要，不写模型长篇输出。
- 每条 memory 有 source 和 version。
- 选择器修改只写变更摘要和 ai-id。
- build 错误写 error_summary，不写完整超长日志。
- secret 不进入 memory。

### 5.3 Context Assembler 策略

```ts
export interface ContextBundle {
  projectState: ProjectState;
  appSpec?: AppSpec;
  designProfile?: DesignProfile;
  selectedElement?: {
    aiId: string;
    manifestEntry: ManifestEntry;
    sourceSnippet: string;
    text?: string;
    className?: string;
    computedStyle?: Record<string, string>;
  };
  buildError?: {
    summary: string;
    relevantFiles: Array<{ path: string; content: string }>;
  };
  recentHistory: Array<{
    role: 'user' | 'assistant' | 'system';
    summary: string;
  }>;
}
```

---

## 6. Tool 设计

### 6.1 Tool 定义

```ts
export interface ToolCallProposal {
  toolName: string;
  args: Record<string, unknown>;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
}
```

### 6.2 P0 Tool 列表

#### project.read_file

```json
{
  "path": "src/pages/Home.tsx"
}
```

返回：

```json
{
  "path": "src/pages/Home.tsx",
  "content": "...",
  "version": 3
}
```

#### project.read_manifest

返回当前 manifest。

#### project.apply_patches

```json
{
  "patches": [
    {
      "file": "src/pages/Home.tsx",
      "originalSnippet": "...",
      "newSnippet": "..."
    }
  ],
  "source": "selector_edit",
  "summary": "Updated primary CTA style"
}
```

#### build.create_job

```ts
{
  projectId: string;
  projectVersionId: string;
  workspacePath: string;
  reason: 'initial_generate' | 'selector_edit' | 'code_edit' | 'repair';
}
```

后端执行：

- 校验 workspace ownership。
- 入队 build job。
- 执行 `pnpm typecheck` / `pnpm build`。
- 创建 preview snapshot。

#### codex.create_task

```ts
{
  projectId: string;
  projectVersionId: string;
  task: CodexTaskOutput['task'];
}
```

后端执行：

- 校验 allowed/forbidden paths。
- 创建 codex_task。
- 入队 Docker Codex Worker。
- Codex 完成后再触发 build job。

#### github.commit_files

Agent 可以建议，但需要用户确认。

```json
{
  "repoFullName": "user/app",
  "branch": "main",
  "message": "Initial generated app",
  "projectVersionId": "uuid"
}
```

### 6.3 高风险工具确认

以下工具必须用户确认：

- github.create_repo
- github.commit_files
- github.update_workflow
- supabase.apply_schema
- vercel.create_deployment
- mini_program.upload

确认 payload：

```ts
export interface ConfirmationRequest {
  id: string;
  toolName: string;
  riskLevel: 'medium' | 'high';
  title: string;
  description: string;
  impact: string[];
  argsPreview: Record<string, unknown>;
}
```

---

## 7. Prompt 模板

### 7.1 全局 System Prompt

```text
You are an agent inside a result-first AI app builder.
You must produce structured JSON that matches the provided schema.
You do not execute OAuth, deployment, database migration, shell commands, or external API calls.
You may propose tool calls, but tools are executed only by the deterministic backend.
Never include secrets, tokens, private keys, or environment variables in generated code except public client-side variables explicitly marked as public.
Prefer small, safe, scoped changes.
When editing selected UI elements, only modify files provided in the allowed context.
```

中文版本：

```text
你是一个结果优先 AI 应用生成平台中的 Agent。
你必须输出符合指定 JSON schema 的结构化结果。
你不执行 OAuth、部署、数据库迁移、shell 命令或外部 API 调用。
你可以提出工具调用请求，但工具只能由确定性后端执行。
不要在生成代码或输出中包含 secret、token、private key 或环境变量明文；只有明确标记为 public 的前端变量可以出现。
优先做小范围、安全、可回滚的修改。
当处理选择器选中的 UI 元素时，只能修改上下文允许的文件。
```

### 7.2 Spec Agent Prompt Skeleton

```text
Task: Convert the user's app idea into an AppSpec JSON.

User prompt:
{{userPrompt}}

Constraints:
- Target defaults to web unless specified.
- Keep P0 page count between 3 and 6.
- Include data model draft if backend is needed.
- Do not generate code.
- Output JSON only.

Schema:
{{AppSpecSchema}}
```

### 7.3 Selector Patch Prompt Skeleton

```text
Task: Modify only the selected UI element or its directly related style tokens.

User instruction:
{{instruction}}

Selected element:
{{selectedElement}}

Manifest entry:
{{manifestEntry}}

Allowed files:
{{allowedFiles}}

Source snippets:
{{sourceSnippets}}

Rules:
- Do not modify unrelated files.
- Do not remove data-ai-id.
- Do not change business logic unless explicitly requested.
- Output patch JSON only.

Schema:
{{SelectorPatchSchema}}
```

### 7.4 QA Fix Prompt Skeleton

```text
Task: Fix the build error with the smallest safe patch.

Build error summary:
{{errorSummary}}

Relevant logs:
{{logs}}

Relevant files:
{{files}}

Rules:
- Do not rewrite the whole project.
- Prefer minimal fixes.
- Do not add new dependencies unless necessary.
- Output JSON only.

Schema:
{{QaFixSchema}}
```

---

## 8. Schema 校验与 Repair

### 8.1 校验流程

```text
model output
  -> parse JSON
  -> validate schema
  -> if pass: continue
  -> if fail: call repair prompt once
  -> if still fail: mark run failed
```

### 8.2 Repair Prompt

```text
Your previous output did not match the required JSON schema.
Return only valid JSON.
Do not include markdown.
Validation errors:
{{errors}}
Original output:
{{output}}
Schema:
{{schema}}
```

### 8.3 Repair 限制

- 每个 Agent run 最多 repair 1-2 次。
- repair 失败后返回用户可理解错误。
- trace 中记录 schema errors。

---

## 9. Patch 应用设计

### 9.1 Patch 格式选择

P0 建议使用 snippet replace，而不是通用 diff。

原因：

- 更容易校验。
- 更容易定位。
- 适合选择器局部修改。

格式：

```ts
export interface SnippetPatch {
  file: string;
  originalSnippet: string;
  newSnippet: string;
}
```

### 9.2 Patch 应用规则

1. 文件必须存在。
2. 文件路径必须在 allowlist。
3. `originalSnippet` 必须唯一匹配。
4. 替换后不能删除关键 `data-ai-id`，除非 patch 明确替换为同一个 id。
5. 替换后保存新文件版本。
6. 创建 project_version。

### 9.3 Patch 失败处理

| 失败原因 | 处理 |
|---|---|
| snippet 不存在 | 请求 Agent 重新基于最新文件生成 patch |
| snippet 多处匹配 | 要求 Agent 提供更长上下文 |
| 文件不允许修改 | 拒绝并提示越界 |
| 删除 data-ai-id | 拒绝并要求修复 |

---

## 10. Selector Edit 详细流程

### 10.1 选择元素

```text
User enables selector
  -> iframe runtime highlights elements
  -> user clicks element
  -> iframe posts aiId + bbox + text + className
  -> parent fetches manifest entry
  -> Inspector shows editable fields
```

### 10.2 直接修改文案

```text
User edits text
  -> POST /inspector/direct-patch
  -> backend loads manifest entry
  -> backend loads source file
  -> deterministic text replacement
  -> save file version
  -> create project version
  -> create build job
```

直接修改不一定需要模型。

### 10.3 AI 微调

```text
User enters instruction
  -> Router detects selector_edit
  -> Context Assembler loads selected element context
  -> Selector Patch Agent returns deterministic patch 或 CodexTask
  -> Patch validator validates
  -> Copy current workspace to new project_version
  -> Apply patch or run Docker Codex Worker
  -> Build dist
  -> Preview Service creates new snapshot
  -> iframe switches to new previewUrl
```

P0 不使用 HMR。用户看到的是“修改中”步骤提示，成功后切换到新版本 snapshot preview。

### 10.4 选择器上下文示例

```json
{
  "selectedElement": {
    "aiId": "home.hero.primaryCta",
    "tagName": "BUTTON",
    "text": "开始使用",
    "className": "rounded-lg bg-black px-4 py-2 text-white",
    "computedStyle": {
      "backgroundColor": "rgb(0, 0, 0)",
      "borderRadius": "8px",
      "fontSize": "14px"
    }
  },
  "manifestEntry": {
    "file": "src/pages/Home.tsx",
    "component": "HeroSection",
    "editable": ["text", "className"]
  },
  "sourceSnippet": "<button data-ai-id=\"home.hero.primaryCta\" className=\"rounded-lg bg-black px-4 py-2 text-white\">开始使用</button>"
}
```

---

## 11. Build Error 修复流程

### 11.1 流程

```text
Build failed
  -> Build Service stores error_summary
  -> System creates repair CodexTask
  -> QA Fix Agent compresses error context if needed
  -> Docker Codex Worker receives error_summary + relevant files
  -> Codex modifies current repair workspace
  -> New build job
  -> If success: Preview Service creates new snapshot
  -> If fail: allow one more retry or ask user
```

### 11.2 相关文件选择

从错误日志中提取：

- 文件路径；
- 行号；
- import 失败模块；
- TypeScript error；
- Vite build error。

如果无法提取，提供：

- package.json；
- src/App.tsx；
- 最近修改文件；
- ai-manifest.json。

### 11.3 Repair 限制

- repair task 只能修改与错误相关的文件。
- 不允许重写整个项目。
- 不允许删除 `data-ai-id`。
- 默认不允许新增依赖。
- 自动 repair 次数必须有限。

## 12. 连接器相关 Agent 设计

### 12.1 不设置 Integration Agent 作为授权执行者

P0 不需要一个“Integration Agent”去做 OAuth。OAuth 是确定性流程。

可以设置：

```text
Connector Advisor / Deploy Advice Agent
```

它只做：

- 解释为什么需要连接 GitHub；
- 判断当前 checklist 缺少什么；
- 生成用户可理解的下一步；
- 提出工具调用请求，例如 `github.commit_files`。

### 12.2 GitHub 提交流程中 Agent 的位置

```text
User: 发布到 GitHub
  -> Router: deploy / github commit
  -> Deploy Advice Agent: 生成 checklist 和说明
  -> UI: 用户点击确认提交
  -> Tool Broker: 执行 github.commit_files
```

Agent 不参与：

- OAuth URL 生成；
- code 换 token；
- token 存储；
- GitHub API 明文 token 调用。

---

## 13. 安全护栏

### 13.1 输入护栏

- 限制 prompt 长度。
- 检测要求泄露 secret 的输入。
- 检测要求生成恶意代码的输入。
- 高风险业务领域提示风险。

### 13.2 工具护栏

- 所有工具必须声明 schema。
- 所有写入工具必须校验 project ownership。
- `codex.create_task` 必须校验 allowed_paths / forbidden_paths。
- Docker Codex Worker 只能挂载当前 workspace。
- 不允许工具读取 vault、`.env`、其他用户 workspace。
- 高风险工具需要用户确认。
- tool result 必须脱敏。

### 13.3 输出护栏

- JSON schema validation。
- 文件路径 allowlist。
- 禁止 `.env` 明文。
- 禁止 token 进入输出。
- 代码中 public/private env 区分。
- patch 范围限制。

### 13.4 成本护栏

- 每个 AgentRun 最大模型调用次数。
- 每个项目每天最大 build 次数。
- 每次 selector patch 最大文件数。
- build 自动修复最大重试次数。

---

## 14. Trace 设计

### 14.1 Trace Event 类型

```ts
export type TraceEventType =
  | 'agent_run_started'
  | 'context_assembled'
  | 'model_call_started'
  | 'model_call_finished'
  | 'schema_validation_failed'
  | 'tool_call_proposed'
  | 'tool_call_executed'
  | 'patch_validated'
  | 'patch_applied'
  | 'build_job_created'
  | 'agent_run_finished'
  | 'agent_run_failed';
```

### 14.2 Trace Payload 示例

```json
{
  "eventType": "model_call_finished",
  "payload": {
    "agent": "selector_patch",
    "model": "gpt-x",
    "inputTokens": 3200,
    "outputTokens": 900,
    "durationMs": 4200
  }
}
```

### 14.3 用户可见与管理员可见

用户可见：

- “我已理解你的修改目标。”
- “我修改了 Home.tsx 中的主按钮样式。”
- “预览正在重新构建。”

管理员可见：

- prompt；
- model；
- token；
- tool call；
- error；
- patch details。

---

## 15. Agent 模式

### 15.1 Result Mode

默认模式。用户只看结果和步骤，不看终端。

```text
Prompt
  > App Spec
  > Design
  > CodexTask
  > Docker Codex Worker
  > Build dist
  > Snapshot Preview
```

### 15.2 Design Mode

用于视觉方向选择。

特点：

- 生成多个 design profile。
- 支持重新生成。
- 不生成完整代码。

### 15.3 Code Mode

高级模式。

特点：

- 用户可以编辑文件。
- Agent 可以基于当前文件回答和 patch。
- 更多技术日志可见。

### 15.4 Deploy Mode

发布模式。

特点：

- Agent 解释 checklist。
- 高风险工具必须用户确认。
- 连接器由确定性系统执行。

---

## 16. P0 实现建议

### 16.1 第一阶段：不实现真正多 Agent

先实现一个 Orchestrator：

```text
mode: spec | design | codex_task | selector_patch | repair | deploy_advice
```

内部用不同 prompt 和 schema。

P0 必须先打通：

```text
用户 prompt
  -> AppSpec
  -> DesignProfile
  -> CodexTask
  -> Docker Codex Worker 修改 workspace
  -> build dist
  -> Preview Service snapshot
```

### 16.2 第二阶段：拆 Agent 文件

```text
agent/
  orchestrator.ts
  modelClient.ts
  schemas.ts
  prompts/
    specPrompt.ts
    designPrompt.ts
    codexTaskPrompt.ts
    selectorPatchPrompt.ts
    qaFixPrompt.ts
  agents/
    specAgent.ts
    designAgent.ts
    codexTaskPlannerAgent.ts
    selectorPatchAgent.ts
    qaFixAgent.ts
    deployAdviceAgent.ts
```

### 16.3 第三阶段：引入 Tool Broker

Tool Broker 独立于 Agent：

```text
agent proposes
  -> tool broker validates and executes
```

---

## 17. 与 Codex 协作的开发任务

### Task 1：定义 shared schemas

文件：

```text
packages/shared/src/app-spec.ts
packages/shared/src/design.ts
packages/shared/src/manifest.ts
packages/shared/src/agent.ts
packages/shared/src/tool.ts
```

要求：

- TypeScript 类型。
- Zod schema。
- JSON schema 导出。

### Task 2：实现 Orchestrator skeleton

文件：

```text
apps/api/src/modules/agent/orchestrator.ts
apps/api/src/modules/agent/contextAssembler.ts
apps/api/src/modules/agent/modelClient.ts
apps/api/src/modules/agent/schemaValidator.ts
```

要求：

- 支持 mode。
- 支持 trace。
- 支持 schema validation。
- 支持 repair。

### Task 3：实现 Spec Agent

要求：

- 输入 prompt。
- 输出 AppSpec。
- 保存 app_specs。
- 前端展示。

### Task 4：实现 Design Agent

要求：

- 输入 AppSpec。
- 输出 2-3 个 DesignProfile。
- 用户可选择。

### Task 5：实现 CodexTask Planner + Docker Codex Worker

要求：

- 根据 AppSpec + DesignProfile 生成 CodexTask。
- 实现 Workspace Service：创建、复制、锁定、归档 workspace。
- 实现 Docker Codex Worker：只挂载当前 workspace。
- Codex 修改 React/Vite 项目。
- 生成或维护 `data-ai-id`。
- 生成或维护 `ai-manifest.json`。
- 记录 changed_files、hash、summary。

### Task 6：实现 Selector Patch Agent

要求：

- 根据 ai-id 查 manifest。
- 加载相关文件。
- 生成 patch。
- 校验并应用。
- 创建 build job。

### Task 7：实现 QA Fix Agent

要求：

- 接收 build error。
- 生成修复 patch。
- 最多自动重试。

---

## 18. 验收样例

### 18.1 Spec Agent 输入

```text
帮我做一个私教预约 Web 应用。用户可以查看教练、选择课程、提交预约。管理员可以查看预约列表。风格简洁高级。
```

### 18.2 预期输出摘要

```json
{
  "appName": "私教预约系统",
  "oneLineGoal": "帮助健身工作室展示教练课程并管理用户预约",
  "appType": "booking",
  "target": "web",
  "authRequired": true,
  "backendRequired": true,
  "pages": [
    { "id": "home", "name": "首页", "route": "/", "priority": "P0" },
    { "id": "coaches", "name": "教练列表", "route": "/coaches", "priority": "P0" },
    { "id": "booking", "name": "预约页", "route": "/booking", "priority": "P0" },
    { "id": "admin", "name": "管理后台", "route": "/admin", "priority": "P0" }
  ]
}
```

### 18.3 Selector Patch 输入

```json
{
  "aiId": "home.hero.primaryCta",
  "instruction": "按钮更高级一点，减少黑色压迫感"
}
```

### 18.4 预期 Patch 行为

- 修改该按钮 className。
- 保留 `data-ai-id="home.hero.primaryCta"`。
- 不改其他页面。
- 触发 rebuild。

---

## 19. 常见失败与处理

| 失败 | 原因 | 处理 |
|---|---|---|
| Agent 输出不是 JSON | 模型未遵守格式 | repair 一次，失败则报错 |
| patch snippet 不匹配 | 文件已变化 | 重新组装最新上下文 |
| build 失败 | 代码语法/import 错误 | QA Fix Agent |
| 选择器找不到 ai-id | 未注入或点击了容器 | fallback 到父级 ai-id |
| 修改范围过大 | Agent 越界 | Patch validator 拒绝 |
| token 泄露风险 | 输出包含 secret | 输出护栏拦截 |

---

## 20. P1 增强方向

- WebContainer Developer Mode：高级用户浏览器内运行；只作为开发者模式，不替代 P0 静态 preview。
- Visual QA Agent：根据截图差异生成 selector/Codex repair task。
- Race Design：多个设计策略并行。
- Supabase OAuth。
- GitHub App。
- Vercel API 一键部署。
- Local Agent Adapter：Codex CLI / Claude Code 作为可插拔 Code Worker。
- 对象存储 + CDN 承载 preview snapshots。

## 21. 最终建议

P0 不要追求“看起来像很多 Agent”。

正确优先级是：

```text
结构化 App Spec
  > 稳定代码生成
  > Static Snapshot Preview
  > 选择器微调
  > GitHub 提交
  > 发布闭环
  > 多 Agent 人格化
```

只要这条闭环跑通，产品就能体现差异化。

---
