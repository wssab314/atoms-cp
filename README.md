# Atoms-CP ｜ 新一代 Prompt-to-App AI 协同创作工坊

`Atoms-CP` 是一个由 AI 驱动的低代码应用生成平台，旨在将用户的自然语言（Prompt）精准转化为高品质、生产级的响应式 Web 应用及多端小程序。用户不仅可以与 AI 协同对话进行持续迭代，还可以通过可视化界面微调选择器直接修改页面元素，并支持多版本快照回退、GitHub 推送、以及一键多渠道部署。

---

## 🏗️ 核心业务架构

平台抛弃了低效、重度依赖内存的 WebContainer 方案，采用了**持久化工作区（Workspace）+ 隔离沙箱（Docker Codex）+ 静态快照服务（Preview Service）**的现代云计算体系：

```text
               ┌────────────────────────────────────────────────────────┐
               │                      用户 Prompt                       │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │           Core Agent (解析 AppSpec / CodexTask)        │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │     Workspace Service (创建宿主机 project/version)      │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │      Docker Codex Sandbox (挂载沙箱，LLM 生成修改)     │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │       Build Service (执行 Typecheck / Vite Build)      │
               └──────────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
               ┌────────────────────────────────────────────────────────┐
               │      Preview Service (承载 dist 静态快照以 iframe 渲染) │
               └────────────────────────────────────────────────────────┘
```

1. **核心解析**：Core Agent 摄入用户需求，规划出应用规格文件（`AppSpec`）、界面风格文件（`DesignProfile`）与任务描述（`CodexTask`）。
2. **工作区隔离**：`Workspace Service` 在宿主机上为项目版本创建专属的工作目录，隔离并发任务。
3. **安全沙箱构建**：在隔离的 `Docker` 环境下由 `Codex` 调用大模型对 Vite 项目源码进行逻辑与样式调整。
4. **编译与分发**：`Build Service` 触发 TS 类型检测和打包，将 `dist` 移交至 `Preview Service` 以静态 HTML 的形式安全挂载至前端工作台。

---

## 📂 仓库项目结构

本项目采用 `pnpm workspaces` 组织的多包单体仓库（Monorepo）：

```text
├── apps/
│   ├── web/               # 前端工作台（Vite + React + TypeScript + Vanilla CSS）
│   ├── api/               # 后端 API 接口服务器（Express / NestJS 架构）
│   └── builder-worker/    # 执行 Codex 任务与 Docker 任务的后台构建队列 Worker
├── packages/
│   ├── shared/            # 跨端共享的数据 Schema 校验、TypeScript 类型与通用逻辑
│   ├── codegen/           # 核心代码生成器，支持 AST 解析与代码级精确修改
│   ├── templates/         # 预设的原子组件与业务版面模板库
│   ├── generated-app-template/ # 用于生成 Web 应用的脚手架模板 (Vite/React)
│   └── generated-taro-template/# 用于生成多端小程序的脚手架模板 (Taro)
├── docs/                  # 完整的 PRD、技术架构及各轮迭代记录
├── scripts/               # 辅助开发、构建及模拟静态预览服务的脚本
└── docker-compose.yml     # 容器化本地环境依赖栈（PostgreSQL, Redis 等）
```

---

## ⚡ 核心技术栈

* **前端工作台**：
  * **基础**：Vite 5.x / React 18 / TypeScript
  * **样式系统**：精细化 Vanilla CSS 配合现代 CSS Variables 变量（包含极光毛玻璃微光边界、不对称聊天泡泡、超平滑 Apple 级 `cubic-bezier` 交互动画）。
  * **图标库**：`lucide-react`（严格禁用 Emoji 标签，保证企业级 UI 高端质感）。
* **后端与队列**：
  * **主服务**：Node.js (Express / Fastify)
  * **异步任务队列**：BullMQ (由 Redis 提供后端承载)
* **宿主与隔离**：
  * **容器**：Docker Engine 
  * **编译**：Vite Build + Taro Compile (小程序)

---

## 🚀 本地开发快速启动

### 1. 准备环境

确保您的系统上已安装 Node.js (v18+)、pnpm (v8+) 以及 Docker。

复制环境变量配置文件并根据本地需求进行微调：
```bash
cp .env.example .env
```

### 2. 安装项目依赖

在项目根目录下执行安装（pnpm 会自动建立 Workspace 内部软链接）：
```bash
pnpm install
```

### 3. 运行本地开发服务

启动前端调试服务器 (Vite dev server)：
```bash
pnpm --filter @atoms-cp/web dev
```

启动后端 API 接口服务：
```bash
pnpm --filter @atoms-cp/api dev
```

启动后台构建任务队列 Worker：
```bash
pnpm --filter @atoms-cp/builder-worker dev
```

---

## 🧪 自动化测试与质量守则

本项目在 CI/CD 与本地开发阶段设置了极度严密的类型与单元测试防线，以确保任何 UI 重构不会导致 Regression。

### 1. 静态类型检查
```bash
pnpm --filter @atoms-cp/web typecheck
```

### 2. 运行 Vitest 单元测试
```bash
pnpm --filter @atoms-cp/web test
```

### 3. 运行 Web App 生产打包
```bash
pnpm --filter @atoms-cp/web build
```

### 4. 运行全库端到端测试
```bash
pnpm -r test
```

---

## 🔒 安全与脱敏规范

为向普通用户提供完全产品化的体验，前端代码与 DOM 节点中设置了严格的**开发禁用词屏蔽**：
* 严禁在普通用户 UI 中透露任何系统级技术背景词汇（例如：`Codex`, `Docker`, `Vite`, `pnpm`, `dist`, `HMR`, `WebContainer`, `terminal`, `stdout`, `stderr`, `workspace`, `node_modules` 等）。
* 异常情况（如 GitHub 代码提交失败、构建被阻断）已全部在前端进行友好中文化拦截与物理路径脱敏转译。
