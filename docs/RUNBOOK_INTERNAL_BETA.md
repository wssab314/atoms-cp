# Internal Beta / Real Canary Runbook

## 目标
验证 atoms-cp 在不调用真实外部 Codex CLI、GitHub 或 Vercel 的前提下，能完成后端内测闭环：

1. 创建项目与结构化 AppSpec / DesignProfile。
2. 创建并处理 dry-run CodexTask。
3. 产生 project version、build job 与 ready preview snapshot。
4. 执行 selector text patch 并产生新版本。
5. 执行版本回退并产生新快照。
6. 计算 publish readiness。

## 本地 Smoke
```bash
pnpm --filter @atoms-cp/api smoke:internal-beta
```

成功时输出 JSON，核心字段应包含：

- `status: "passed"`
- `projectId`
- `codexTaskId`
- `initialPreviewSnapshotId`
- `selectorPatchPreviewSnapshotId`
- `rollbackPreviewSnapshotId`
- `publishCanProceed: true`
- `errors: []`

该命令默认使用 dry-run worker 和确定性 build snapshot，不消耗模型额度，不访问外部发布服务。

## Worker 卡死恢复
Codex worker tick 会在配置了 TTL 时自动恢复 stale 运行态记录：

- `CODEX_TASK_STALE_MS`，默认 `900000`
- `BUILD_JOB_STALE_MS`，默认 `900000`

恢复行为：

- CodexTask 标记为 `failed`。
- BuildJob 标记为 `failed`。
- workspace 自动 unlock。
- 写入 admin trace event，payload 包含 `stale: true`。
- build job 写入一条 `system` build log。

## Admin 检查
访问 `/api/admin/operations`，检查：

- `runtimeSummary.activeCodexTasks`
- `runtimeSummary.failedCodexTasks`
- `runtimeSummary.activeBuildJobs`
- `runtimeSummary.failedBuildJobs`
- `runtimeSummary.recoveredEvents`
- `traceEvents`

Admin response 只显示配置状态，不返回 secret 原文。

## R7 回归命令
```bash
pnpm -r typecheck
pnpm -r test
docker compose config
docker compose -f docker-compose.prod.yml --env-file .env.production.example config
```

## Production Single Image
生产部署使用一张 `ATOMS_APP_IMAGE`，由 compose 拆成多个服务角色运行：

- `web`：`node scripts/serve-web-static.mjs`，只服务 `apps/web/dist`，不接收数据库或模型 secret。
- `api`：`pnpm --filter @atoms-cp/api start`。
- `builder-worker`：`pnpm --filter @atoms-cp/builder-worker start`。
- `codex-worker`：`pnpm --filter @atoms-cp/api start:codex-worker`。

本地构建和直传镜像：

```bash
pnpm docker:build:app
pnpm docker:save:app
```

### Fast Preview Build

预览构建默认使用 `PREVIEW_BUILD_MODE=fast`。镜像内预装两套标准模板：

- Web/H5：`packages/generated-app-template`，运行时路径 `PREVIEW_TEMPLATE_ROOT=/app/packages/generated-app-template`
- 微信小程序：`packages/generated-taro-template`，运行时路径 `TARO_PREVIEW_TEMPLATE_ROOT=/app/packages/generated-taro-template`

builder-worker 会按项目 `target` 选择模板，复用模板内的 `node_modules` 与构建配置，不在用户项目 workspace 中执行依赖安装，也不跑完整 TypeScript strict gate。

Web/H5 用户项目只允许覆盖：

- `src/**`
- `public/**`
- `index.html`
- `ai-manifest.json`

微信小程序用户项目只允许覆盖：

- `src/**`
- `ai-manifest.json`

Web/H5 平台预置可导入库为：`react`、`react-dom`、`react-router-dom`、`lucide-react`、`recharts`、`@tanstack/react-table`、`react-hook-form`、`zod`、`clsx`、`date-fns`、`framer-motion`。微信小程序预置可导入库为：`react`、`react-dom`、`@tarojs/taro`、`@tarojs/components`、`@tarojs/react`。生成结果如修改 `package.json`、lockfile、`node_modules`、`dist` 或导入非白名单包，预览构建会直接失败并进入用户安全错误提示。发布构建仍应使用 strict gate；微信小程序第一阶段支持 H5 预览与源码下载，不支持直接上传微信平台。

服务器 `.env.production` 只需要配置：

```bash
ATOMS_APP_IMAGE=atoms-cp-app:local
```

然后通过 `docker load` 导入同一张镜像，compose 会用不同 command 启动各个服务。

## R9.1 Staging Real Canary
真实 Codex CLI 只允许在 staging canary 中单任务启用；默认 production 仍关闭。

推荐顺序：

1. 确认 `.env.staging` 中显式配置：
   - `CODEX_WORKER_MODE=docker`
   - `CODEX_REAL_EXECUTION_ENABLED=true`
   - `CODEX_REAL_CANARY_ENABLED=true`
   - `CODEX_REAL_PREFLIGHT_ONLY=false`
   - `CODEX_DOCKER_NETWORK_MODE=bridge`
   - `CODEX_REAL_TASK_LIMIT_PER_RUN=1`
   - `CODEX_REAL_DAILY_BUDGET_TASKS=3`
   - `CODEX_REAL_MAX_RUNTIME_MS=600000`
   - `CODEX_SECRET_MOUNT_PATH=/run/secrets/codex_api_key`
   - `ATOMS_APP_IMAGE=<registry>/atoms-cp-app:<tag>`
   - `CODEX_DOCKER_IMAGE=$ATOMS_APP_IMAGE`
   - `CODEX_REAL_COMMAND=/app/scripts/codex-doubao21-exec.sh`
   - `CODEX_EXECUTION_ENV_ALLOWLIST=CODEX_DOUBAO_MODEL,CODEX_DOUBAO_BASE_URL`
   - `CODEX_DOUBAO_MODEL=doubao-seed-2-1-pro-260628`
   - `CODEX_DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3`
2. 将真实凭证放入只读 secret 文件，并通过 staging override 挂载；不要把 key 放进命令参数、普通 env 或日志。
   火山方舟 Doubao 2.1 的 Codex 接入参考官方文档：
   https://www.volcengine.com/docs/82379/2160841?lang=zh
   Responses API endpoint 参考官方 API 文档：
   https://www.volcengine.com/docs/82379/1569618
   当前默认模型为 `doubao-seed-2-1-pro-260628`，后续如火山方舟更新模型 ID，只需要在 staging env 中覆盖 `CODEX_DOUBAO_MODEL`。
3. 先运行 preflight：
   ```bash
   pnpm --filter @atoms-cp/api codex-worker:preflight
   ```
   预期 `realExecutionArmed` 为 `true`，且 `hasDockerSocketMount`、`hasHomeMount`、`hasEnvFileMount` 均为 `false`。
4. 运行单任务 canary：
   ```bash
   pnpm --filter @atoms-cp/api codex-worker:real-canary
   ```
   或使用根目录显式 gate：
   ```bash
   pnpm e2e:real-canary
   ```
5. 等 builder-worker 处理 queued build 后查看报告：
   ```bash
   pnpm --filter @atoms-cp/api codex-worker:real-canary:report
   ```
6. 验收成功后立即恢复关闭态：
   - `CODEX_REAL_EXECUTION_ENABLED=false`
   - `CODEX_REAL_CANARY_ENABLED=false`
   - `CODEX_REAL_PREFLIGHT_ONLY=true`

Staging compose 示例：

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.staging-canary.yml \
  --env-file .env.staging \
  config
```

默认 staging canary 使用 `/app/scripts/codex-doubao21-exec.sh`：

- 默认 `CODEX_DOUBAO_EXECUTOR=chat_codegen`，直接使用火山方舟 `/chat/completions` 生成允许文件的完整内容，再交给平台做 allowlist、manifest、import 与 build 校验。
- 如需验证兼容 Responses 的 provider，可显式设置 `CODEX_DOUBAO_EXECUTOR=codex_cli`；此时 wrapper 会在容器内生成 `CODEX_HOME/doubao21.config.toml`，Codex provider 使用 `wire_api = "responses"`。
- 火山方舟 API Key 只从 `/run/secrets/codex_api_key` 读取；不会进入 compose env、命令参数、Admin response 或 trace。
- Codex CLI 路径会设置 `shell_environment_policy.inherit=none`，避免执行 workspace 命令时继承 provider token。
- `@openai/codex@0.138.0` 已在 codex-worker 镜像中预装，国内服务器只拉取镜像，不在运行时下载 CLI。

安全要求：

- 不挂载 Docker socket、宿主 HOME、宿主 `.env` 或平台 secrets。
- secret 只以只读文件挂载，Admin 只显示 `configured/not_configured`。
- canary 失败后默认自动熔断，除非显式设置 `CODEX_REAL_AUTO_DISABLE_ON_FAILURE=false`。
