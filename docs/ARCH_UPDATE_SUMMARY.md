# 架构更新摘要｜Workspace + Docker Codex + Static Preview Service

本次修改将所有相关文档统一到以下 P0 方案：

```text
用户 Prompt
  -> Core Agent 生成 AppSpec / DesignProfile / CodexTask
  -> Workspace Service 创建宿主机持久化 project/version workspace
  -> Docker Codex Worker 只挂载当前 workspace 并修改 Vite 项目
  -> Build Service 执行 typecheck/build，生成 dist
  -> 自有 Preview Service 读取 dist 静态快照并提供 iframe URL
  -> 选择器微调创建新版本 workspace，重新 build 并切换 snapshot preview
```

## 已统一的关键决策

- P0 不使用 WebContainer。
- P0 不使用 HMR。
- P0 不为每个用户启动 Vite dev server。
- workspace 是宿主机文件夹，但 Codex 执行必须在 Docker 隔离环境中。
- Codex 不直接接收原始用户 prompt，只接收核心 Agent 生成的结构化 CodexTask。
- Preview 使用自有 Preview Service 承载 `dist` 静态快照。
- 多用户并发主要由队列、worker 并发上限和静态 Preview Service 承载能力控制。
- 每次生成/修改都创建新的 `project_version` 和 preview snapshot，避免覆盖旧版本。

## 修改范围

- `01_PRD_产品设计文档.md`
- `02_PAGE_SPEC_页面说明文档.md`
- `03_USER_STORIES_完整用户故事.md`
- `04_TECH_ARCH_技术架构文档.md`
- `05_AGENT_DESIGN_Agent设计文档.md`
- `README_Codex_执行说明.md`
