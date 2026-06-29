import {
  aiManifestSchema,
  aiSelectorPatchPlanSchema,
  type AgentRun,
  type AgentErrorType,
  type ManifestEntry,
  type ModelInvocation,
  type ModelRuntimeConfig,
  type ProjectDetail,
  type ProjectFileRecord
} from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import type { ModelClient } from '../model/modelClient.js';
import { estimateCostCny, parseModelJson } from '../spec/specAgent.js';
import { applyDirectTextPatch } from './directTextPatch.js';

const SELECTOR_PATCH_SYSTEM_PROMPT = [
  'You are the Selector Patch Agent for a result-first AI app builder.',
  'Return Selector Patch JSON only.',
  'The Selector Patch JSON must be exactly: {"operation":"replace_text","text":"..."}',
  'The text value must be concise UI copy, no markdown, no code, no HTML.',
  'Do not change ai-id, file paths, props, scripts, secrets, or application logic.'
].join('\n');

export interface GenerateSelectorPatchInput {
  project: ProjectDetail;
  aiId: string;
  instruction: string;
  selectedText?: string;
  model: ModelRuntimeConfig;
  modelClient: ModelClient;
  store: AppStore;
}

export interface GenerateSelectorPatchResult {
  manifestEntry: ManifestEntry;
  projectVersion: Awaited<ReturnType<AppStore['saveProjectFilePatch']>>['projectVersion'];
  files: ProjectFileRecord[];
  agentRun: NonNullable<Awaited<ReturnType<AppStore['updateAgentRun']>>>;
  modelInvocation: Awaited<ReturnType<AppStore['createModelInvocation']>>;
}

export interface GenerateSelectorPatchPlanResult {
  manifestEntry: ManifestEntry;
  operation: 'replace_text' | 'update_style' | 'update_props';
  replacementText?: string;
  instruction?: string;
  agentRun: AgentRun;
  modelInvocation: ModelInvocation;
}

export class SelectorPatchError extends Error {
  constructor(
    message: string,
    readonly errorType: AgentErrorType,
    readonly statusCode = 502
  ) {
    super(message);
  }
}

export async function generateSelectorPatch(input: GenerateSelectorPatchInput): Promise<GenerateSelectorPatchResult> {
  const plan = await generateSelectorPatchPlan(input);
  if (plan.operation !== 'replace_text' || !plan.replacementText) {
    throw new SelectorPatchError('Selector patch requires a queued code edit task', 'SCHEMA_VALIDATION_FAILED', 409);
  }
  const targetFile = await input.store.getProjectFile(input.project.id, plan.manifestEntry.file);

  if (!targetFile) {
    throw new SelectorPatchError('Manifest target file not found', 'INTERNAL_ERROR', 409);
  }

  let patchedContent: string;
  try {
    patchedContent = applyDirectTextPatch({
      source: targetFile.content,
      aiId: input.aiId,
      text: plan.replacementText
    });
  } catch {
    await input.store.updateAgentRun(plan.agentRun.id, {
      status: 'failed',
      errorType: 'SCHEMA_VALIDATION_FAILED',
      errorMessage: 'Selected element does not support direct text patch'
    });
    throw new SelectorPatchError('Selected element does not support direct text patch', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  const saved = await input.store.saveProjectFilePatch({
    projectId: input.project.id,
    source: 'agent_patch',
    summary: `AI selector patch for ${input.aiId}`,
    files: [
      {
        path: targetFile.path,
        content: patchedContent,
        purpose: `AI selector patch for ${input.aiId}`
      }
    ]
  });
  const agentRun = await input.store.updateAgentRun(plan.agentRun.id, {
    status: 'succeeded',
    outputSnapshot: {
      aiId: input.aiId,
      operation: 'replace_text',
      projectVersionId: saved.projectVersion.id,
      changedFiles: saved.projectVersion.changedFiles
    }
  });

  if (!agentRun) {
    throw new SelectorPatchError('AgentRun disappeared during selector patch', 'INTERNAL_ERROR');
  }

  return {
    manifestEntry: plan.manifestEntry,
    projectVersion: saved.projectVersion,
    files: saved.files,
    agentRun,
    modelInvocation: plan.modelInvocation
  };
}

export async function generateSelectorPatchPlan(input: GenerateSelectorPatchInput): Promise<GenerateSelectorPatchPlanResult> {
  const manifestFile = await input.store.getProjectFile(input.project.id, 'ai-manifest.json');

  if (!manifestFile) {
    throw new SelectorPatchError('AI manifest not found', 'INTERNAL_ERROR', 409);
  }

  const manifest = aiManifestSchema.parse(JSON.parse(manifestFile.content));
  const manifestEntry = manifest.entries[input.aiId];

  if (!manifestEntry) {
    throw new SelectorPatchError('Selected element not found in manifest', 'INTERNAL_ERROR', 404);
  }

  if (!manifestEntry.editable.includes('text')) {
    throw new SelectorPatchError('Selected element is not text editable', 'SCHEMA_VALIDATION_FAILED', 409);
  }

  const run = await input.store.createAgentRun({
    projectId: input.project.id,
    purpose: 'selector_patch',
    provider: input.model.provider,
    status: 'queued',
    inputSnapshot: {
      aiId: input.aiId,
      instructionLength: input.instruction.length,
      selectedText: input.selectedText,
      targetFile: manifestEntry.file
    }
  });
  await input.store.updateAgentRun(run.id, { status: 'waiting_for_model' });

  const budgetLimitCny = input.model.budgetCny ?? 25;

  if ((await input.store.getEstimatedSpendCny()) >= budgetLimitCny) {
    const invocation = await input.store.createModelInvocation({
      projectId: input.project.id,
      agentRunId: run.id,
      provider: input.model.provider,
      model: input.model.model,
      purpose: 'selector_patch',
      status: 'skipped',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      estimatedCostCny: 0,
      budgetLimitCny,
      errorType: 'MODEL_BUDGET_EXCEEDED',
      errorMessage: 'Model budget exceeded'
    });
    const failedRun = await input.store.updateAgentRun(run.id, {
      status: 'failed',
      errorType: 'MODEL_BUDGET_EXCEEDED',
      errorMessage: 'Model budget exceeded'
    });
    throw new SelectorPatchError(`Budget exceeded before ${invocation.id}`, failedRun?.errorType ?? 'MODEL_BUDGET_EXCEEDED', 402);
  }

  const startedAt = Date.now();
  const modelResult = await input.modelClient.generateText({
    system: SELECTOR_PATCH_SYSTEM_PROMPT,
    user: JSON.stringify({
      projectName: input.project.name,
      aiId: input.aiId,
      elementType: manifestEntry.elementType,
      selectedText: input.selectedText,
      instruction: input.instruction
    }),
    responseFormat: 'json',
    maxOutputTokens: 200
  });
  const durationMs = Math.max(0, Date.now() - startedAt);
  const invocation = await input.store.createModelInvocation({
    projectId: input.project.id,
    agentRunId: run.id,
    provider: input.model.provider,
    model: modelResult.model,
    purpose: 'selector_patch',
    status: 'succeeded',
    inputTokens: modelResult.usage?.inputTokens ?? 0,
    outputTokens: modelResult.usage?.outputTokens ?? 0,
    durationMs,
    estimatedCostCny: estimateCostCny(
      input.model.provider,
      modelResult.model,
      modelResult.usage?.inputTokens ?? 0,
      modelResult.usage?.outputTokens ?? 0
    ),
    budgetLimitCny
  });

  let plan: ReturnType<typeof aiSelectorPatchPlanSchema.parse>;

  try {
    plan = aiSelectorPatchPlanSchema.parse(parseModelJson(modelResult.text));
  } catch {
    await input.store.updateAgentRun(run.id, {
      status: 'failed',
      errorType: 'MODEL_INVALID_JSON',
      errorMessage: 'Model did not return valid selector patch JSON'
    });
    throw new SelectorPatchError('Model did not return valid selector patch JSON', 'MODEL_INVALID_JSON');
  }
  const inferredOperation = inferSelectorPatchOperation(input.instruction, plan.operation);
  const instruction = plan.operation === 'replace_text'
    ? input.instruction
    : plan.instruction;

  return {
    manifestEntry,
    operation: inferredOperation,
    replacementText: inferredOperation === 'replace_text' && plan.operation === 'replace_text' ? plan.text : undefined,
    instruction: inferredOperation === 'replace_text' ? undefined : instruction,
    agentRun: run,
    modelInvocation: invocation
  };
}

function inferSelectorPatchOperation(
  instruction: string,
  modelOperation: 'replace_text' | 'update_style' | 'update_props'
): 'replace_text' | 'update_style' | 'update_props' {
  if (/属性|链接|href|url|placeholder|aria|alt|props?/i.test(instruction)) {
    return 'update_props';
  }

  if (/样式|颜色|字号|字体|加粗|背景|间距|圆角|阴影|布局|对齐|醒目|品牌蓝|style|color|font|spacing|radius/i.test(instruction)) {
    return 'update_style';
  }

  return modelOperation;
}
