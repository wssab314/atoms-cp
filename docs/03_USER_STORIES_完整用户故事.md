# 03｜完整用户故事

> 文档用途：把产品需求转成 Codex 可执行的用户故事与验收标准。
> 格式：Epic → Story → Acceptance Criteria。
> 优先级：P0 必须完成；P1 后续增强；P2 长期能力。

---

## 1. 用户角色

| 角色 | 说明 |
|---|---|
| Guest | 未登录访问者 |
| Creator | 普通应用创建者，非技术用户 |
| PowerUser | 半技术用户，会看代码 |
| Admin | 平台管理员 |
| AgentSystem | Agent 编排系统 |
| ConnectorSystem | 确定性连接器工具层 |
| BuildSystem | Codex 工程生成、构建与静态预览系统 |

---

## 2. Epic A：账号与项目管理

### Story A1：未登录用户进入产品首页

**As a** Guest
**I want** 看到产品价值和创建入口
**So that** 我能快速开始生成应用。

优先级：P0

验收标准：

```gherkin
Given 我未登录
When 我访问首页
Then 我应该看到产品定位、核心能力和“开始创建”按钮
And 页面不应该默认展示复杂代码或终端
```

### Story A2：用户登录

**As a** Creator
**I want** 使用邮箱或第三方方式登录
**So that** 我的项目可以保存到云端。

优先级：P0

验收标准：

```gherkin
Given 我在登录页
When 我输入有效邮箱并完成验证
Then 系统应创建或恢复我的账号
And 跳转到项目列表页
```

### Story A3：查看项目列表

**As a** Creator
**I want** 查看我创建过的应用
**So that** 我可以继续编辑或发布。

优先级：P0

验收标准：

```gherkin
Given 我已登录且有项目
When 我进入 Dashboard
Then 我应看到项目卡片列表
And 每张卡片显示项目名称、状态、最近更新时间
```

### Story A4：空项目列表引导

**As a** Creator
**I want** 在没有项目时看到明确引导
**So that** 我知道下一步怎么做。

优先级：P0

验收标准：

```gherkin
Given 我已登录但没有项目
When 我进入 Dashboard
Then 我应看到空状态文案
And 我应看到“创建新应用”按钮
```

### Story A5：项目重命名

**As a** Creator
**I want** 修改项目名称
**So that** 我可以管理多个项目。

优先级：P0

验收标准：

```gherkin
Given 我在项目工作台
When 我修改项目名称并保存
Then 项目名称应更新
And Dashboard 中显示新名称
```

---

## 3. Epic B：项目创建与需求输入

### Story B1：通过自然语言创建项目

**As a** Creator
**I want** 用自然语言描述我要的应用
**So that** 系统可以帮我生成应用方案。

优先级：P0

验收标准：

```gherkin
Given 我在创建项目页
When 我输入不少于 20 个字符的需求描述
And 点击“生成应用方案”
Then 系统应创建一个 project
And 进入 App Spec 生成状态
```

### Story B2：Prompt 太短时提示

**As a** Creator
**I want** 在需求过短时得到提示
**So that** 我能补充必要信息。

优先级：P0

验收标准：

```gherkin
Given 我在创建项目页
When 我输入非常短的内容
Then “生成应用方案”按钮应禁用或提示补充需求
```

### Story B3：选择目标类型

**As a** Creator
**I want** 指定应用类型
**So that** 生成结果更贴近我的预期。

优先级：P0

验收标准：

```gherkin
Given 我在创建项目页
When 我选择 Web App 或 Dashboard 类型
Then 该类型应传入 App Spec 生成请求
```

### Story B4：选择视觉风格

**As a** Creator
**I want** 在创建时给出视觉偏好
**So that** 设计方向更接近我想要的风格。

优先级：P0

验收标准：

```gherkin
Given 我在创建项目页
When 我选择“简洁高级”风格
Then 生成的设计方向应参考该风格
```

---

## 4. Epic C：App Spec 生成与审核

### Story C1：生成 App Spec

**As a** Creator
**I want** 系统把我的需求拆成页面、功能和数据模型
**So that** 我可以先确认应用结构。

优先级：P0

验收标准：

```gherkin
Given 我提交了项目需求
When Agent 完成需求理解
Then 系统应展示 App Spec
And App Spec 至少包含应用名称、目标用户、页面列表、核心功能、数据模型草案
```

### Story C2：编辑应用名称

**As a** Creator
**I want** 修改系统生成的应用名称
**So that** 应用符合我的表达。

优先级：P0

验收标准：

```gherkin
Given App Spec 已生成
When 我修改应用名称
Then 新名称应保存到 spec version
```

### Story C3：编辑页面说明

**As a** Creator
**I want** 修改某个页面的说明
**So that** 后续代码生成更准确。

优先级：P0

验收标准：

```gherkin
Given App Spec 已生成且包含页面列表
When 我修改某个页面说明
Then 修改后的说明应出现在 App Spec 中
And 后续代码生成应使用新说明
```

### Story C4：确认 App Spec

**As a** Creator
**I want** 确认应用结构
**So that** 系统可以开始生成设计方向和代码。

优先级：P0

验收标准：

```gherkin
Given App Spec 已生成
When 我点击“确认并生成设计方向”
Then 当前 App Spec 应被标记为 confirmed
And 系统进入设计方向生成状态
```

### Story C5：App Spec 版本化

**As a** Creator
**I want** 每次 Spec 修改被记录
**So that** 我可以理解应用结构变化。

优先级：P0

验收标准：

```gherkin
Given 我修改了 App Spec
When 修改保存成功
Then 系统应创建新的 spec_version
And 记录修改来源为 user_edit
```

---

## 5. Epic D：设计方向

### Story D1：生成多个设计方向

**As a** Creator
**I want** 看到多个视觉方向
**So that** 我可以选择更贴近目标的风格。

优先级：P0

验收标准：

```gherkin
Given App Spec 已确认
When 系统生成设计方向
Then 至少展示 2 个设计方向
And 每个方向包含风格名称、说明和预览
```

### Story D2：选择设计方向

**As a** Creator
**I want** 选择一个设计方向
**So that** 系统基于它生成应用。

优先级：P0

验收标准：

```gherkin
Given 我看到设计方向列表
When 我选择其中一个方向
Then 系统应把该方向保存到 design_profile
And 允许我点击“生成应用”
```

### Story D3：重新生成设计方向

**As a** Creator
**I want** 重新生成设计方向
**So that** 当前方案不满意时有替代选择。

优先级：P1

验收标准：

```gherkin
Given 我不满意当前设计方向
When 我点击“重新生成”
Then 系统应生成新的设计方向版本
And 保留旧方向记录
```

---

## 6. Epic E：代码生成与项目文件

### Story E1：生成 React/Vite 项目

**As a** Creator
**I want** 系统根据 App Spec 生成真实前端项目
**So that** 我能获得可运行应用。

优先级：P0

验收标准：

```gherkin
Given App Spec 和 design_profile 已确认
When 我点击“生成应用”
Then 核心 Agent 应生成结构化 CodexTask
And Workspace Service 应从受控 Vite 模板创建 project/version workspace
And Codex Worker 应在 Docker 容器中挂载该 workspace 并修改项目文件
And 文件应保存在宿主机持久化 workspace 中
And 数据库应记录 project_version、changed_files、hash 和 workspace_path
```

### Story E2：生成 manifest

**As a** AgentSystem
**I want** 为生成代码中的关键元素写入 `data-ai-id` 并建立 manifest
**So that** 选择器可以定位源码。

优先级：P0

验收标准：

```gherkin
Given 代码生成完成
When 系统保存项目文件
Then HTML/React 元素应包含稳定 data-ai-id
And ai-manifest.json 应映射 ai-id 到文件、组件和用途
```

### Story E3：代码生成失败处理

**As a** Creator
**I want** 在代码生成失败时看到明确错误
**So that** 我可以重试或修改需求。

优先级：P0

验收标准：

```gherkin
Given Codex Worker 执行失败
When 我查看 Builder
Then 系统应展示失败摘要
And 提供“重试生成”按钮
And 不应暴露原始 secret、宿主机路径或其他用户 workspace 信息
```

### Story E4：项目文件版本化

**As a** PowerUser
**I want** 文件每次修改都有版本
**So that** 我可以追踪和回滚。

优先级：P0

验收标准：

```gherkin
Given 文件发生修改
When 修改保存成功
Then 系统应创建新的 project_version
And 该版本应对应一个独立 workspace_path
And 记录 changed_files、content_hash 和 source
```

### Story E5：Workspace 隔离

**As a** PlatformOwner
**I want** 每个用户项目版本都有隔离 workspace
**So that** Codex 修改不会污染其他项目。

优先级：P0

验收标准：

```gherkin
Given 两个用户同时生成项目
When BuildSystem 派发 Codex job
Then 每个 job 只能挂载自己的 project/version workspace
And 容器内不得访问其他用户 workspace
And 同一 project 同一时间只允许一个写入型 job
```

---

## 7. Epic F：静态 Snapshot Preview

### Story F1：构建静态预览

**As a** Creator
**I want** 看到可交互预览
**So that** 我知道应用是否真实可用。

优先级：P0

验收标准：

```gherkin
Given project_version 的 workspace 已生成
When BuildSystem 执行 typecheck 和 pnpm build
Then 成功后应生成 dist 静态产物
And Preview Service 应创建 preview_snapshot
And Builder 中 iframe 应加载 snapshot preview_url
And 系统不应为该用户启动长期 Vite dev server
```

### Story F2：构建状态展示

**As a** Creator
**I want** 看到生成与构建进度
**So that** 我知道系统正在工作。

优先级：P0

验收标准：

```gherkin
Given Codex 或 build 任务正在进行
When 我查看 Builder
Then 应显示 queued / preparing_workspace / codex_running / validating / building / snapshot_ready 等步骤提示
And 不展示 terminal 交互入口
```

### Story F3：构建失败摘要

**As a** Creator
**I want** 构建失败时看到可理解的摘要
**So that** 我不需要阅读完整终端日志。

优先级：P0

验收标准：

```gherkin
Given 构建失败
When 我查看 Builder
Then 应显示错误摘要、相关文件和“自动修复”按钮
```

### Story F4：重新构建

**As a** Creator
**I want** 手动重新构建预览
**So that** 我可以修复异常状态。

优先级：P0

验收标准：

```gherkin
Given 当前项目有 workspace 版本
When 我点击“重新构建”
Then 系统应创建 build_job
And 读取该版本 workspace 执行 build
And 完成后创建新的 preview_snapshot
And 更新 preview_url
```

### Story F5：移动端尺寸预览

**As a** Creator
**I want** 切换桌面和手机预览
**So that** 我能检查响应式效果。

优先级：P1

验收标准：

```gherkin
Given preview 已生成
When 我切换到 mobile 模式
Then iframe 宽度应切换到移动设备尺寸
```

---

## 8. Epic G：选择器微调

### Story G1：开启选择器模式

**As a** Creator
**I want** 点击预览中的元素
**So that** 我可以直接修改它。

优先级：P0

验收标准：

```gherkin
Given preview 已加载
When 我开启选择器模式
Then 鼠标 hover 元素时应显示高亮边框
```

### Story G2：选中元素

**As a** Creator
**I want** 选中具体按钮或文本
**So that** 右侧展示可编辑属性。

优先级：P0

验收标准：

```gherkin
Given 选择器模式已开启
When 我点击带 data-ai-id 的元素
Then Inspector 应显示该元素信息
And selected_ai_id 应被保存到当前 UI state
```

### Story G3：直接修改文案

**As a** Creator
**I want** 修改选中元素的文字
**So that** 我不用看代码也能调整文案。

优先级：P0

验收标准：

```gherkin
Given 我选中了一个文本或按钮元素
When 我在 Inspector 中修改文案并点击应用
Then 后端应生成文件 patch
And 新版本 snapshot preview 显示新文案
```

### Story G4：直接修改基础样式

**As a** Creator
**I want** 修改颜色、圆角、间距等基础样式
**So that** 页面更符合我的审美。

优先级：P0

验收标准：

```gherkin
Given 我选中了一个元素
When 我修改背景色或圆角
Then 系统应更新对应 className 或 CSS token
And 不应修改无关文件
```

### Story G5：AI 微调选中元素

**As a** Creator
**I want** 对选中元素输入自然语言修改要求
**So that** AI 帮我做更复杂但局部的调整。

优先级：P0

验收标准：

```gherkin
Given 我选中了一个元素
When 我输入“让这个按钮更高级一点”
Then UI Patch Agent 应只获取该元素相关上下文
And 生成 patch plan
And 后端应用 patch 后重新构建
```

### Story G6：未找到 manifest 时降级

**As a** Creator
**I want** 当元素无法定位源码时得到提示
**So that** 我知道为什么不能编辑。

优先级：P0

验收标准：

```gherkin
Given 我点击了没有 data-ai-id 的元素
When 系统无法通过 manifest 定位
Then Inspector 应提示“该元素暂不支持直接编辑”
And 提供“让 AI 尝试定位”选项 P1
```

### Story G7：选择器修改生成版本

**As a** Creator
**I want** 每次选择器修改都生成版本记录
**So that** 我可以追踪变化。

优先级：P0

验收标准：

```gherkin
Given 我完成了一次选择器修改
When snapshot preview 更新成功
Then 版本历史中应出现一条 selector_edit 记录
```

---

## 9. Epic H：高级代码模式

### Story H1：打开代码模式

**As a** PowerUser
**I want** 查看项目代码
**So that** 我可以手动调整细节。

优先级：P0

验收标准：

```gherkin
Given 我在 Builder
When 我点击“查看代码”
Then 系统应打开高级代码模式
And 展示文件树、CodeMirror 和 preview/logs
```

### Story H2：打开文件

**As a** PowerUser
**I want** 从文件树打开文件
**So that** 我能查看源码。

优先级：P0

验收标准：

```gherkin
Given 高级代码模式已打开
When 我点击 src/App.tsx
Then CodeMirror 应加载该文件内容
```

### Story H3：保存文件

**As a** PowerUser
**I want** 修改并保存文件
**So that** 我可以手动修正 AI 生成的代码。

优先级：P0

验收标准：

```gherkin
Given 我编辑了一个文件
When 我点击保存
Then 前端应提交 file_path、content、version
And 后端保存成功后返回新 version
```

### Story H4：文件版本冲突

**As a** PowerUser
**I want** 当文件已被其他修改更新时收到冲突提示
**So that** 我不会覆盖新内容。

优先级：P0

验收标准：

```gherkin
Given 我打开的文件版本为 3
And 后端该文件已更新到版本 4
When 我提交版本 3 的保存请求
Then 后端应拒绝保存
And 前端提示版本冲突
```

### Story H5：查看只读构建日志

**As a** PowerUser
**I want** 查看构建日志
**So that** 我可以理解构建失败原因。

优先级：P0

验收标准：

```gherkin
Given 构建任务已完成或失败
When 我打开 Logs 面板
Then 我应看到只读 stdout/stderr
And 不应看到可输入终端
```

---

## 10. Epic I：GitHub OAuth App

### Story I1：连接 GitHub

**As a** Creator
**I want** 授权 GitHub
**So that** 系统可以把项目代码提交到我的仓库。

优先级：P0

验收标准：

```gherkin
Given 我在连接器设置页
When 我点击“连接 GitHub”
Then 后端应生成 OAuth authorization URL
And 浏览器跳转到 GitHub 授权页
```

### Story I2：OAuth callback

**As a** ConnectorSystem
**I want** 处理 GitHub callback
**So that** 获取并安全保存 token。

优先级：P0

验收标准：

```gherkin
Given GitHub callback 携带 code 和 state
When 后端收到 callback
Then 后端应校验 state
And 使用 code 换取 access token
And 加密保存 token
And 重定向回连接器页
```

### Story I3：列出仓库

**As a** Creator
**I want** 选择目标仓库
**So that** 代码提交到正确位置。

优先级：P0

验收标准：

```gherkin
Given 我已连接 GitHub
When 我打开 GitHub 设置
Then 系统应列出我可访问的仓库
```

### Story I4：创建仓库

**As a** Creator
**I want** 创建新仓库
**So that** 我不用离开平台。

优先级：P0

验收标准：

```gherkin
Given 我已连接 GitHub
When 我输入 repo 名称并点击创建
Then 后端应调用 GitHub API 创建仓库
And 保存 repo 绑定关系
```

### Story I5：提交项目文件

**As a** Creator
**I want** 把当前版本提交到 GitHub
**So that** 项目可以部署和交付。

优先级：P0

验收标准：

```gherkin
Given 项目已有当前版本且 GitHub 已连接
When 我点击“提交到 GitHub”
Then 系统应展示将提交的文件列表
And 用户确认后后端执行 commit
And 保存 commit_sha
```

### Story I6：Agent 不接触 GitHub token

**As a** Admin
**I want** token 不进入模型上下文
**So that** 降低泄露风险。

优先级：P0

验收标准：

```gherkin
Given Agent 需要执行 GitHub 工具调用
When Orchestrator 组装上下文
Then access_token 不应出现在任何 model input 中
And GitHub API 调用只能由 ConnectorSystem 执行
```

---

## 11. Epic J：Supabase 绑定

### Story J1：生成数据模型草案

**As a** Creator
**I want** 系统基于需求生成数据表
**So that** 应用可以保存数据。

优先级：P0

验收标准：

```gherkin
Given App Spec 已生成
When 数据模型模块完成
Then 页面应展示表名、字段、关系和说明
```

### Story J2：配置 Supabase URL 和 anon key

**As a** Creator
**I want** 填写 Supabase 配置
**So that** 生成应用可以访问数据库。

优先级：P0

验收标准：

```gherkin
Given 我打开 Supabase 设置
When 我填写 Supabase URL 和 anon key
Then 后端应保存配置
And 生成应用环境变量应引用这些值
```

### Story J3：service role key 只进 vault

**As a** Admin
**I want** service role key 不出现在前端或 Agent 上下文
**So that** 避免严重安全风险。

优先级：P0

验收标准：

```gherkin
Given 用户填写 service role key
When 后端保存该 key
Then key 应加密保存
And API 返回中不应包含明文 key
And Agent 上下文中不应包含该 key
```

### Story J4：生成 SQL 草案

**As a** Creator
**I want** 获得可复制的 SQL schema
**So that** 我可以在 Supabase 手动执行。

优先级：P0

验收标准：

```gherkin
Given App Spec 包含数据模型
When 我进入 Supabase 设置页
Then 系统应展示 SQL 草案
And 提供复制按钮
```

### Story J5：自动 apply migration

**As a** Creator
**I want** 系统自动应用 Supabase schema
**So that** 不需要手动复制 SQL。

优先级：P1

验收标准：

```gherkin
Given 我已授权 Supabase 或提供 service role key
When 我点击“应用数据库结构”
Then 后端应执行 migration
And 展示执行结果
```

---

## 12. Epic K：Vercel 部署

### Story K1：发布前 checklist

**As a** Creator
**I want** 在发布前看到检查项
**So that** 我知道还缺什么。

优先级：P0

验收标准：

```gherkin
Given 我打开发布中心
Then 我应看到 build、GitHub、env、Supabase、Vercel 等检查项
```

### Story K2：通过 GitHub 发布到 Vercel

**As a** Creator
**I want** 使用 GitHub 仓库作为 Vercel 部署源
**So that** 部署流程更标准。

优先级：P0

验收标准：

```gherkin
Given 当前项目已提交到 GitHub
When 我进入 Vercel 发布步骤
Then 系统应展示 Vercel import repo 的引导或已保存的部署链接
```

### Story K3：记录 deployment URL

**As a** Creator
**I want** 保存我的线上地址
**So that** 后续可以从项目中打开。

优先级：P0

验收标准：

```gherkin
Given 我完成 Vercel 部署
When 我填写或系统获取 deployment URL
Then 项目应保存 deployment_url
And Dashboard 项目卡应展示已部署状态
```

### Story K4：直接调用 Vercel API

**As a** Creator
**I want** 一键创建 Vercel 项目
**So that** 不需要手动跳转配置。

优先级：P1

验收标准：

```gherkin
Given 我已授权 Vercel
When 我点击“一键部署”
Then 后端应创建 Vercel project 并设置 env
And 触发 deployment
```

---

## 13. Epic L：版本历史

### Story L1：查看版本列表

**As a** Creator
**I want** 查看项目历史版本
**So that** 我知道每次 AI 或我修改了什么。

优先级：P0

验收标准：

```gherkin
Given 项目经历多次修改
When 我打开版本历史
Then 我应看到版本列表、时间、来源、摘要、build 状态
```

### Story L2：查看版本详情

**As a** Creator
**I want** 查看某个版本的修改详情
**So that** 我能理解变化。

优先级：P0

验收标准：

```gherkin
Given 我在版本历史页
When 我点击一个版本
Then 系统应展示该版本的修改摘要和文件列表
```

### Story L3：回滚版本

**As a** Creator
**I want** 回滚到旧版本
**So that** 错误修改可以撤销。

优先级：P1

验收标准：

```gherkin
Given 我选择一个历史版本
When 我点击“回滚到此版本”并确认
Then 系统应基于该版本创建新版本
And 标记来源为 rollback
```

---

## 14. Epic M：Agent Orchestrator

### Story M1：Router 判断任务类型

**As a** AgentSystem
**I want** 根据用户输入判断任务类型
**So that** 选择正确工作流。

优先级：P0

验收标准：

```gherkin
Given 用户输入一条指令
When Orchestrator 调用 Router
Then Router 应返回 task_type、risk_level、required_context、next_agent
```

### Story M2：Agent 输出结构化 JSON

**As a** Developer
**I want** Agent 输出结构化结果
**So that** 后端可以稳定解析。

优先级：P0

验收标准：

```gherkin
Given 任意 Agent 完成模型调用
When 返回结果
Then 结果必须符合该 Agent 的 JSON schema
And schema 校验失败时进入 repair 流程
```

### Story M3：工具调用走 Tool Broker

**As a** Admin
**I want** 所有工具调用都经过权限检查
**So that** Agent 不能越权执行。

优先级：P0

验收标准：

```gherkin
Given Agent 请求调用 github.commit_files
When Tool Broker 收到请求
Then Tool Broker 应检查用户、项目、connector、risk_level
And 必要时要求用户确认
```

### Story M4：模型调用记录 trace

**As a** Admin
**I want** 记录模型调用和工具调用
**So that** 可以 debug 和审计。

优先级：P0

验收标准：

```gherkin
Given AgentRun 开始
When 发生 model call 或 tool call
Then 系统应记录 trace event
And 关联 run_id 和 project_id
```

### Story M5：自动修复 build 错误

**As a** Creator
**I want** 构建失败时 AI 尝试修复
**So that** 我不用看懂技术错误。

优先级：P0

验收标准：

```gherkin
Given build failed
When 用户点击“自动修复”
Then QA Agent 应获取错误摘要和相关文件
And 生成修复 patch
And 重新 build
```

---

## 15. Epic N：安全与审计

### Story N1：敏感字段脱敏

**As a** Admin
**I want** 日志中的 secret 被隐藏
**So that** 运营人员也不能看到明文 secret。

优先级：P0

验收标准：

```gherkin
Given build log 或 deploy log 包含疑似 token
When 前端展示日志
Then 系统应对 token 做 mask
```

### Story N2：高风险操作确认

**As a** Creator
**I want** 高风险操作前被提醒
**So that** 不会误删或误发布。

优先级：P0

验收标准：

```gherkin
Given 操作会提交 GitHub 或发布
When 用户点击执行
Then 系统应展示确认弹窗和影响范围
```

### Story N3：Agent / Codex 不能访问无关文件

**As a** PlatformOwner
**I want** Agent 和 Codex 都不能访问无关文件
**So that** 多用户和密钥安全可控。

优先级：P0

验收标准：

```gherkin
Given Codex Worker 开始执行
When 容器启动
Then 容器只应挂载当前 job workspace
And 不应挂载 Docker socket
And 不应挂载宿主机 .env、vault、其他用户 workspace
And 容器应使用非 root 用户
And 日志中不应输出敏感环境变量
```

---

---

## 16. Epic O：小程序 Target P1

### Story O1：生成小程序工程

**As a** Creator
**I want** 从 App Spec 生成微信小程序工程
**So that** 我的应用可以进入微信生态。

优先级：P1

验收标准：

```gherkin
Given App Spec 已确认
When 我选择 Mini Program target
Then 系统应生成 app.json、pages、components、WXML、WXSS、TS
```

### Story O2：配置 AppID 和上传密钥

**As a** Creator
**I want** 配置小程序 AppID 和上传密钥
**So that** 系统可以调用 miniprogram-ci。

优先级：P1

验收标准：

```gherkin
Given 我在小程序发布设置页
When 我填写 AppID 和上传密钥
Then 后端应加密保存密钥
And 不在前端回显明文
```

### Story O3：生成预览二维码

**As a** Creator
**I want** 生成微信扫码预览二维码
**So that** 我可以在手机微信里查看小程序开发版。

优先级：P1

验收标准：

```gherkin
Given 小程序工程已生成且配置已完成
When 我点击“生成预览”
Then 后端应调用 miniprogram-ci preview
And 前端展示二维码
```

### Story O4：上传开发版本

**As a** Creator
**I want** 上传小程序开发版本
**So that** 我可以去微信后台体验和提交审核。

优先级：P1

验收标准：

```gherkin
Given 小程序工程 build 成功
When 我点击“上传开发版本”并确认
Then 后端应调用 miniprogram-ci upload
And 保存 upload result
```

---

## 17. P0 验收主流程

Codex 开发完成后，至少应能演示以下完整路径：

```gherkin
Given 我是一个已登录用户
When 我创建一个“私教预约应用”项目
And 系统生成 App Spec
And 我确认 Spec
And 我选择一个设计方向
And 核心 Agent 生成 CodexTask
And Codex Worker 在 Docker workspace 中生成 React/Vite 项目
And BuildSystem 生成 dist 静态产物
And Preview Service 返回 snapshot preview URL
And 我在 preview 中点击按钮并修改文案
And 新版本 snapshot preview 更新成功
And 我连接 GitHub OAuth
And 我选择或创建 repo
And 我提交当前项目代码
Then 我应得到一个 GitHub commit
And 项目版本历史中应记录所有关键步骤
```

---
