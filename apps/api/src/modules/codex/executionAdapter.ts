import type { CodexTaskRecord, WorkspaceRecord } from '@atoms-cp/shared';

export type CodexExecutionProgressStage = 'coding_app' | 'validating' | 'repairing_app' | 'building_preview';
export type CodexExecutionProgressStatus = 'start' | 'progress' | 'done' | 'failed';

export interface CodexExecutionProgressEvent {
  stage: CodexExecutionProgressStage;
  stepKey: string;
  status: CodexExecutionProgressStatus;
  message: string;
  nextAction?: string;
}

export interface CodexExecutionInput {
  task: CodexTaskRecord;
  workspace: WorkspaceRecord;
  onProgress?: (event: CodexExecutionProgressEvent) => void | Promise<void>;
}

export interface CodexExecutionResult {
  summary: string;
  changedFiles: string[];
}

export interface CodexExecutionAdapter {
  name: string;
  execute(input: CodexExecutionInput): Promise<CodexExecutionResult>;
}
