import type { AppStore } from '../data/appStore.js';
import {
  processNextCodexTask as defaultProcessNextCodexTask,
  type DryRunCodexWorkerConfig,
  type DryRunCodexWorkerResult
} from './dryRunCodexWorker.js';
import { createContainerExecutionAdapter } from './containerExecutionAdapter.js';
import { createDockerExecutionAdapter } from './dockerExecutionAdapter.js';
import type { DockerCodexNetworkMode } from './dockerExecutionAdapter.js';
import {
  recoverStaleRuntime as defaultRecoverStaleRuntime,
  type RuntimeRecoveryResult
} from '../runtime/runtimeRecovery.js';

export type CodexWorkerMode = 'deterministic' | 'docker' | 'container';

export interface CodexWorkerTickConfig {
  workerId: string;
  workspaceRoot: string;
  mode: CodexWorkerMode;
  dockerImage?: string;
  dockerTimeoutMs?: number;
  dockerLogMaxBytes?: number;
  executionIdleTimeoutMs?: number;
  executionHeartbeatMs?: number;
  realExecutionEnabled?: boolean;
  realCommand?: string;
  dockerNetworkMode?: DockerCodexNetworkMode;
  outputMaxFiles?: number;
  outputMaxBytes?: number;
  executionEnvAllowlist?: string[];
  secretMountPath?: string;
  realPreflightOnly?: boolean;
  realUserTasksEnabled?: boolean;
  codexTaskStaleMs?: number;
  buildJobStaleMs?: number;
  recoverStaleRuntime?: (
    store: AppStore,
    config: {
      codexTaskStaleMs: number;
      buildJobStaleMs: number;
      limit?: number;
    }
  ) => Promise<RuntimeRecoveryResult>;
  processNextCodexTask?: (
    store: AppStore,
    config: DryRunCodexWorkerConfig
  ) => Promise<DryRunCodexWorkerResult | undefined>;
}

export interface CodexWorkerLoopConfig extends CodexWorkerTickConfig {
  intervalMs: number;
  onLog?: (entry: Record<string, unknown>) => void;
}

export async function processCodexWorkerTick(
  store: AppStore,
  config: CodexWorkerTickConfig
): Promise<DryRunCodexWorkerResult | undefined> {
  if (config.codexTaskStaleMs && config.buildJobStaleMs) {
    await (config.recoverStaleRuntime ?? defaultRecoverStaleRuntime)(store, {
      codexTaskStaleMs: config.codexTaskStaleMs,
      buildJobStaleMs: config.buildJobStaleMs
    });
  }

  const processNextCodexTask = config.processNextCodexTask ?? defaultProcessNextCodexTask;
  const executionAdapter = config.mode === 'docker'
    ? createDockerExecutionAdapter({
        image: config.dockerImage ?? 'node:22-alpine',
        timeoutMs: config.dockerTimeoutMs ?? 120_000,
        maxLogBytes: config.dockerLogMaxBytes,
        realExecutionEnabled: config.realExecutionEnabled,
        realCommand: config.realCommand,
        networkMode: config.dockerNetworkMode,
        outputMaxFiles: config.outputMaxFiles,
        outputMaxBytes: config.outputMaxBytes,
        executionEnvAllowlist: config.executionEnvAllowlist,
        secretMountPath: config.secretMountPath,
        realPreflightOnly: config.realPreflightOnly
      })
    : config.mode === 'container'
      ? createContainerExecutionAdapter({
        timeoutMs: config.dockerTimeoutMs ?? 120_000,
        maxLogBytes: config.dockerLogMaxBytes,
        idleTimeoutMs: config.executionIdleTimeoutMs,
        heartbeatMs: config.executionHeartbeatMs,
        realExecutionEnabled: config.realExecutionEnabled,
        realCommand: config.realCommand,
        secretFilePath: config.secretMountPath,
        outputMaxFiles: config.outputMaxFiles,
        outputMaxBytes: config.outputMaxBytes,
        realPreflightOnly: config.realPreflightOnly
      })
    : undefined;

  return await processNextCodexTask(store, {
    workerId: config.workerId,
    workspaceRoot: config.workspaceRoot,
    executionAdapter
  });
}

export function startCodexWorkerLoop(store: AppStore, config: CodexWorkerLoopConfig): NodeJS.Timeout {
  let processing = false;
  let recovering = false;
  const log = config.onLog ?? ((entry) => console.log(JSON.stringify(entry)));

  async function recoverOnly(timestamp: string): Promise<void> {
    if (!config.codexTaskStaleMs || !config.buildJobStaleMs || recovering) {
      return;
    }

    recovering = true;
    try {
      const result = await (config.recoverStaleRuntime ?? defaultRecoverStaleRuntime)(store, {
        codexTaskStaleMs: config.codexTaskStaleMs,
        buildJobStaleMs: config.buildJobStaleMs
      });

      if (result.codexTasks.length > 0 || result.buildJobs.length > 0) {
        log({
          service: 'atoms-cp-codex-worker',
          workerId: config.workerId,
          mode: config.mode,
          status: 'recovered_stale_runtime',
          codexTaskCount: result.codexTasks.length,
          buildJobCount: result.buildJobs.length,
          timestamp
        });
      }
    } catch (error) {
      log({
        service: 'atoms-cp-codex-worker',
        workerId: config.workerId,
        mode: config.mode,
        status: 'recovery_failed',
        error: error instanceof Error ? error.message : 'Unknown runtime recovery error',
        timestamp
      });
    } finally {
      recovering = false;
    }
  }

  async function tick(): Promise<void> {
    const timestamp = new Date().toISOString();

    if (processing) {
      await recoverOnly(timestamp);
      return;
    }

    processing = true;

    try {
      const result = await processCodexWorkerTick(store, config);
      log({
        service: 'atoms-cp-codex-worker',
        workerId: config.workerId,
        mode: config.mode,
        status: result ? result.status : 'idle',
        taskId: result?.taskId,
        projectId: result?.projectId,
        buildJobId: result?.buildJobId,
        timestamp
      });
    } catch (error) {
      log({
        service: 'atoms-cp-codex-worker',
        workerId: config.workerId,
        mode: config.mode,
        status: 'tick_failed',
        error: error instanceof Error ? error.message : 'Unknown Codex worker error',
        timestamp
      });
    } finally {
      processing = false;
    }
  }

  void tick();
  return setInterval(() => {
    void tick();
  }, config.intervalMs);
}
