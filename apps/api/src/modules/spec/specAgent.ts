import { appSpecSchema, type AgentErrorType, type AgentPurpose, type AppSpec, type ModelInvocation, type ProjectDetail } from '@atoms-cp/shared';
import type { ModelRuntimeConfig } from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import type { ModelClient } from '../model/modelClient.js';

const APP_SPEC_SYSTEM_PROMPT = [
  'You are the App Spec Agent for a result-first AI app builder.',
  'Return exactly one AppSpec JSON object and nothing else.',
  'Do not include markdown fences, explanations, comments, or prose outside the JSON object.',
  'The AppSpec JSON must include appName, appGoal, targetUser, pages, dataModels, integrations, styleIntent, constraints, nonGoals, and acceptanceCriteria.',
  'Each page must include id, name, route, purpose, sections, and actions.',
  'Each section must include id, kind, title, and content.',
  'Each action must include id, label, and type.',
  'Keep the JSON compact: at most 3 pages, at most 2 sections per page, at most 2 actions per page.',
  'Leave dataModels and integrations empty unless they are clearly required by the user request.',
  'Use valid JSON with double-quoted property names and no trailing commas.'
].join('\n');

const APP_SPEC_REPAIR_SYSTEM_PROMPT = [
  'You are the JSON Repair Agent for a result-first AI app builder.',
  'Convert the supplied model output into exactly one valid AppSpec JSON object.',
  'Do not add markdown fences, explanations, comments, or prose.',
  'Preserve the user intent, but fix malformed JSON, wrapper objects, and missing required fields.',
  'Keep the repaired JSON compact: at most 3 pages, 2 sections per page, and 2 actions per page.',
  'Use valid JSON with double-quoted property names and no trailing commas.'
].join('\n');

const appSpecJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'appName',
    'appGoal',
    'targetUser',
    'pages',
    'dataModels',
    'integrations',
    'styleIntent',
    'constraints',
    'nonGoals',
    'acceptanceCriteria'
  ],
  properties: {
    appName: { type: 'string' },
    appGoal: { type: 'string' },
    targetUser: { type: 'string' },
    pages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'name', 'route', 'purpose', 'sections', 'actions'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          route: { type: 'string' },
          purpose: { type: 'string' },
          sections: { type: 'array' },
          actions: { type: 'array' }
        }
      }
    },
    dataModels: { type: 'array' },
    integrations: { type: 'array', items: { type: 'string' } },
    styleIntent: {
      type: 'object',
      additionalProperties: true,
      properties: {
        tone: { type: 'string' },
        primaryColor: { type: 'string' },
        layoutDensity: { type: 'string', enum: ['compact', 'comfortable', 'spacious'] }
      }
    },
    constraints: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } }
  }
};

export interface GenerateAppSpecResult {
  appSpec: Awaited<ReturnType<AppStore['createAppSpec']>>;
  agentRun: NonNullable<Awaited<ReturnType<AppStore['updateAgentRun']>>>;
  modelInvocation: Awaited<ReturnType<AppStore['createModelInvocation']>>;
}

export class SpecGenerationError extends Error {
  constructor(
    message: string,
    readonly errorType: AgentErrorType,
    readonly statusCode = 502
  ) {
    super(message);
  }
}

class ModelStepError extends SpecGenerationError {
  constructor(
    message: string,
    errorType: AgentErrorType,
    statusCode: number,
    readonly modelText?: string
  ) {
    super(message, errorType, statusCode);
  }
}

async function generateSpecFromModel(input: {
  project: ProjectDetail;
  model: ModelRuntimeConfig;
  modelClient: ModelClient;
  store: AppStore;
  agentRunId: string;
  budgetLimitCny: number;
  purpose: AgentPurpose;
  system: string;
  user: string;
}): Promise<{ parsedSpec: AppSpec; invocation: ModelInvocation }> {
  const startedAt = Date.now();

  try {
    const modelResult = await input.modelClient.generateText({
      system: input.system,
      user: input.user,
      responseFormat: 'json',
      jsonSchema: {
        name: 'app_spec',
        schema: appSpecJsonSchema
      },
      maxOutputTokens: 1600
    });
    const durationMs = Math.max(0, Date.now() - startedAt);
    const inputTokens = modelResult.usage?.inputTokens ?? 0;
    const outputTokens = modelResult.usage?.outputTokens ?? 0;
    const estimatedCostCny = estimateCostCny(input.model.provider, modelResult.model, inputTokens, outputTokens);

    try {
      const parsedJson = parseModelJson(modelResult.text);
      const parsedSpec = normalizeModelAppSpec(input.project, parsedJson);
      const invocation = await input.store.createModelInvocation({
        projectId: input.project.id,
        agentRunId: input.agentRunId,
        provider: input.model.provider,
        model: modelResult.model,
        purpose: input.purpose,
        status: 'succeeded',
        inputTokens,
        outputTokens,
        durationMs,
        estimatedCostCny,
        budgetLimitCny: input.budgetLimitCny
      });

      return {
        parsedSpec,
        invocation
      };
    } catch (error) {
      const specError = normalizeSpecGenerationError(error);
      await input.store.createModelInvocation({
        projectId: input.project.id,
        agentRunId: input.agentRunId,
        provider: input.model.provider,
        model: modelResult.model,
        purpose: input.purpose,
        status: 'failed',
        inputTokens,
        outputTokens,
        durationMs,
        estimatedCostCny,
        budgetLimitCny: input.budgetLimitCny,
        errorType: specError.errorType,
        errorMessage: specError.message
      });
      throw new ModelStepError(specError.message, specError.errorType, specError.statusCode, modelResult.text);
    }
  } catch (error) {
    if (error instanceof ModelStepError) {
      throw error;
    }

    const failure = classifyModelClientError(error);
    const durationMs = Math.max(0, Date.now() - startedAt);
    await input.store.createModelInvocation({
      projectId: input.project.id,
      agentRunId: input.agentRunId,
      provider: input.model.provider,
      model: input.model.model,
      purpose: input.purpose,
      status: 'failed',
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      estimatedCostCny: 0,
      budgetLimitCny: input.budgetLimitCny,
      errorType: failure.errorType,
      errorMessage: failure.message
    });
    throw failure;
  }
}

function classifyModelClientError(error: unknown): SpecGenerationError {
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out|abort/i.test(message)) {
    return new SpecGenerationError('Model request timed out', 'MODEL_TIMEOUT', 504);
  }

  if (/401|403|unauthorized|forbidden|api key|auth/i.test(message)) {
    return new SpecGenerationError('Model provider authentication failed', 'MODEL_AUTH_FAILED', 502);
  }

  if (/429|rate limit|too many requests/i.test(message)) {
    return new SpecGenerationError('Model provider rate limit exceeded', 'MODEL_RATE_LIMIT', 429);
  }

  return new SpecGenerationError('Model provider request failed', 'INTERNAL_ERROR', 502);
}

function normalizeSpecGenerationError(error: unknown): SpecGenerationError {
  if (error instanceof SpecGenerationError) {
    return error;
  }

  return classifyModelClientError(error);
}

async function failAppSpecGeneration(input: {
  store: AppStore;
  projectId: string;
  agentRunId: string;
  error: SpecGenerationError;
}): Promise<void> {
  await input.store.updateAgentRun(input.agentRunId, {
    status: 'failed',
    errorType: input.error.errorType,
    errorMessage: input.error.message
  });
  await input.store.setProjectStatus(input.projectId, 'draft');
  await input.store.appendTraceEvent({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    type: 'error',
    visibility: 'admin',
    message: 'AppSpec generation failed',
    payload: {
      errorType: input.error.errorType,
      statusCode: input.error.statusCode
    }
  });
  await input.store.appendTraceEvent({
    projectId: input.projectId,
    agentRunId: input.agentRunId,
    type: 'error',
    visibility: 'user',
    message: input.error.errorType === 'MODEL_TIMEOUT'
      ? '需求整理超时，请稍后重试。'
      : '需求整理失败，请稍后重试。',
    payload: {
      stage: 'app_spec_generation'
    }
  });
}

export async function generateProjectAppSpec(
  project: ProjectDetail,
  model: ModelRuntimeConfig,
  modelClient: ModelClient,
  store: AppStore
): Promise<GenerateAppSpecResult> {
  await store.setProjectStatus(project.id, 'spec_generating');
  const run = await store.createAgentRun({
    projectId: project.id,
    purpose: 'app_spec_generation',
    provider: model.provider,
    status: 'queued',
    inputSnapshot: {
      projectName: project.name,
      promptLength: project.prompt.length,
      target: project.target
    }
  });
  await store.updateAgentRun(run.id, { status: 'waiting_for_model' });

  const budgetLimitCny = model.budgetCny ?? 25;

  if ((await store.getEstimatedSpendCny()) >= budgetLimitCny) {
    const invocation = await store.createModelInvocation({
      projectId: project.id,
      agentRunId: run.id,
      provider: model.provider,
      model: model.model,
      purpose: 'app_spec_generation',
      status: 'skipped',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      estimatedCostCny: 0,
      budgetLimitCny,
      errorType: 'MODEL_BUDGET_EXCEEDED',
      errorMessage: 'Model budget exceeded'
    });
    const failedRun = await store.updateAgentRun(run.id, {
      status: 'failed',
      errorType: 'MODEL_BUDGET_EXCEEDED',
      errorMessage: 'Model budget exceeded'
    });
    await store.setProjectStatus(project.id, 'draft');
    throw new SpecGenerationError(`Budget exceeded before ${invocation.id}`, failedRun?.errorType ?? 'MODEL_BUDGET_EXCEEDED', 402);
  }

  let parsedSpec: AppSpec | undefined;
  let invocation: ModelInvocation | undefined;
  let primaryInvocationId: string | undefined;

  try {
    const primary = await generateSpecFromModel({
      project,
      model,
      modelClient,
      store,
      agentRunId: run.id,
      budgetLimitCny,
      purpose: 'app_spec_generation',
      system: APP_SPEC_SYSTEM_PROMPT,
      user: JSON.stringify({
        projectName: project.name,
        prompt: project.prompt,
        target: project.target
      })
    });
    parsedSpec = primary.parsedSpec;
    invocation = primary.invocation;
  } catch (error) {
    if (error instanceof ModelStepError && error.errorType === 'MODEL_INVALID_JSON' && error.modelText) {
      const primaryInvocation = (await store.listRecentModelInvocations(1))[0];
      primaryInvocationId = primaryInvocation?.id;

      try {
        const repair = await generateSpecFromModel({
          project,
          model,
          modelClient,
          store,
          agentRunId: run.id,
          budgetLimitCny,
          purpose: 'app_spec_repair',
          system: APP_SPEC_REPAIR_SYSTEM_PROMPT,
          user: JSON.stringify({
            projectName: project.name,
            prompt: project.prompt,
            target: project.target,
            invalidModelOutput: error.modelText.slice(0, 12000)
          })
        });
        parsedSpec = repair.parsedSpec;
        invocation = repair.invocation;
      } catch (repairError) {
        const specError = normalizeSpecGenerationError(repairError);
        await failAppSpecGeneration({
          store,
          projectId: project.id,
          agentRunId: run.id,
          error: specError
        });
        throw specError;
      }
    } else {
      const specError = normalizeSpecGenerationError(error);
      await failAppSpecGeneration({
        store,
        projectId: project.id,
        agentRunId: run.id,
        error: specError
      });
      throw specError;
    }
  }

  if (!parsedSpec || !invocation) {
    throw new SpecGenerationError('AppSpec generation did not produce a validated result', 'INTERNAL_ERROR');
  }

  const appSpec = await store.createAppSpec({
    projectId: project.id,
    sourceAgentRunId: run.id,
    spec: parsedSpec
  });
  const agentRun = await store.updateAgentRun(run.id, {
    status: 'succeeded',
    outputSnapshot: {
      appSpecId: appSpec.id,
      appSpecVersion: appSpec.version,
      modelInvocationId: invocation.id,
      ...(primaryInvocationId ? { primaryModelInvocationId: primaryInvocationId, repairModelInvocationId: invocation.id } : {})
    }
  });
  await store.setProjectStatus(project.id, 'spec_ready');

  if (!agentRun) {
    throw new SpecGenerationError('AgentRun disappeared during generation', 'INTERNAL_ERROR');
  }

  return {
    appSpec,
    agentRun,
    modelInvocation: invocation
  };
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    extractFencedJson(trimmed),
    extractJsonObject(trimmed)
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim().length > 0));

  for (const candidate of candidates) {
    try {
      return unwrapModelJson(JSON.parse(sanitizeJsonText(candidate)));
    } catch {
      continue;
    }
  }

  throw new SpecGenerationError('Model did not return valid JSON', 'MODEL_INVALID_JSON');
}

function extractFencedJson(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  return undefined;
}

function extractJsonObject(text: string): string | undefined {
  const firstBrace = text.indexOf('{');

  if (firstBrace < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = inString;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  const lastBrace = text.lastIndexOf('}');

  if (lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return undefined;
}

function sanitizeJsonText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/,\s*([}\]])/g, '$1');
}

function unwrapModelJson(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if (isRecord(value.appSpec)) {
    return value.appSpec;
  }

  if (isRecord(value.data)) {
    return value.data;
  }

  return value;
}

const sectionKinds = new Set(['hero', 'list', 'form', 'table', 'stats', 'content', 'navigation']);
const actionTypes = new Set(['navigate', 'submit', 'open_modal', 'filter', 'external_link']);
const fieldTypes = new Set(['string', 'number', 'boolean', 'date', 'datetime', 'enum', 'relation']);
const layoutDensities = new Set(['compact', 'comfortable', 'spacious']);

export function normalizeModelAppSpec(project: ProjectDetail, candidate: unknown): AppSpec {
  const source = isRecord(candidate) ? candidate : {};
  const pages = normalizePages(source.pages, project);

  return appSpecSchema.parse({
    appName: stringValue(source.appName, project.name),
    appGoal: stringValue(source.appGoal, project.prompt),
    targetUser: stringValue(source.targetUser, '目标业务用户'),
    pages,
    dataModels: normalizeDataModels(source.dataModels),
    integrations: stringArray(source.integrations),
    styleIntent: normalizeStyleIntent(source.styleIntent),
    constraints: stringArray(source.constraints),
    nonGoals: stringArray(source.nonGoals),
    acceptanceCriteria: nonEmptyStringArray(source.acceptanceCriteria, ['用户可以完成核心任务'])
  });
}

function normalizePages(value: unknown, project: ProjectDetail) {
  const rawPages = Array.isArray(value) ? value : [];
  const pages = rawPages
    .map((page, index) => normalizePage(page, index, project))
    .filter((page) => page !== undefined);

  if (pages.length > 0) {
    return pages;
  }

  return [
    {
      id: 'home',
      name: '首页',
      route: '/',
      purpose: '展示核心价值和主要操作入口',
      sections: [
        {
          id: 'hero',
          kind: 'hero',
          title: project.name,
          content: project.prompt
        }
      ],
      actions: [
        {
          id: 'primary-action',
          label: '开始使用',
          type: 'submit'
        }
      ]
    }
  ];
}

function normalizePage(value: unknown, index: number, project: ProjectDetail) {
  if (!isRecord(value)) {
    return undefined;
  }

  const fallbackId = index === 0 ? 'home' : `page-${index + 1}`;
  const id = identifierValue(value.id, fallbackId);
  const name = stringValue(value.name, index === 0 ? '首页' : `页面 ${index + 1}`);
  const route = routeValue(value.route, index === 0 ? '/' : `/${id}`);

  return {
    id,
    name,
    route,
    purpose: stringValue(value.purpose, name),
    sections: normalizeSections(value.sections, name, project),
    actions: normalizeActions(value.actions)
  };
}

function normalizeSections(value: unknown, pageName: string, project: ProjectDetail) {
  const rawSections = Array.isArray(value) ? value : value == null ? [] : [value];
  const sections = rawSections
    .map((section, index) => {
      if (typeof section === 'string') {
        return {
          id: index === 0 ? 'hero' : `section-${index + 1}`,
          kind: index === 0 ? 'hero' : 'content',
          title: pageName,
          content: section
        };
      }

      if (!isRecord(section)) {
        return undefined;
      }

      return {
        id: identifierValue(section.id, index === 0 ? 'hero' : `section-${index + 1}`),
        kind: enumString(section.kind, sectionKinds, index === 0 ? 'hero' : 'content'),
        title: stringValue(section.title, pageName),
        content: stringValue(section.content, project.prompt)
      };
    })
    .filter((section) => section !== undefined);

  if (sections.length > 0) {
    return sections;
  }

  return [
    {
      id: 'hero',
      kind: 'hero',
      title: pageName,
      content: project.prompt
    }
  ];
}

function normalizeActions(value: unknown) {
  const rawActions = Array.isArray(value) ? value : value == null ? [] : [value];

  return rawActions
    .map((action, index) => {
      if (typeof action === 'string') {
        return {
          id: identifierValue(undefined, `action-${index + 1}`),
          label: action,
          type: 'submit'
        };
      }

      if (!isRecord(action)) {
        return undefined;
      }

      return {
        id: identifierValue(action.id, `action-${index + 1}`),
        label: stringValue(action.label, `操作 ${index + 1}`),
        type: enumString(action.type, actionTypes, 'submit')
      };
    })
    .filter((action) => action !== undefined);
}

function normalizeDataModels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((model, index) => {
      if (!isRecord(model)) {
        return undefined;
      }

      const fields = Array.isArray(model.fields)
        ? model.fields
          .map((field, fieldIndex) => {
            if (!isRecord(field)) {
              return undefined;
            }

            return {
              name: stringValue(field.name, `field${fieldIndex + 1}`),
              type: enumString(field.type, fieldTypes, 'string'),
              required: typeof field.required === 'boolean' ? field.required : false
            };
          })
          .filter((field) => field !== undefined)
        : [];

      if (fields.length === 0) {
        return undefined;
      }

      return {
        name: stringValue(model.name, `Model${index + 1}`),
        fields
      };
    })
    .filter((model) => model !== undefined);
}

function normalizeStyleIntent(value: unknown) {
  if (isRecord(value)) {
    return {
      tone: stringValue(value.tone, 'calm'),
      primaryColor: typeof value.primaryColor === 'string' && value.primaryColor.trim().length > 0 ? value.primaryColor : undefined,
      layoutDensity: enumString(value.layoutDensity, layoutDensities, 'comfortable')
    };
  }

  return {
    tone: stringValue(value, 'calm'),
    layoutDensity: 'comfortable'
  };
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  return [];
}

function nonEmptyStringArray(value: unknown, fallback: string[]): string[] {
  const values = stringArray(value);
  return values.length > 0 ? values : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function identifierValue(value: unknown, fallback: string): string {
  const raw = stringValue(value, fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return raw.length > 0 ? raw : fallback;
}

function routeValue(value: unknown, fallback: string): string {
  const route = stringValue(value, fallback);
  return route.startsWith('/') ? route : `/${identifierValue(route, fallback.replace(/^\//, '') || 'page')}`;
}

function enumString(value: unknown, allowed: Set<string>, fallback: string): string {
  const candidate = stringValue(value, fallback);
  return allowed.has(candidate) ? candidate : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function estimateCostCny(
  provider: ModelRuntimeConfig['provider'],
  modelName: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rates = modelName.includes('pro')
    ? { inputPerMillionCny: 3, outputPerMillionCny: 6 }
    : { inputPerMillionCny: 1, outputPerMillionCny: 2 };

  return Number((
    (inputTokens / 1_000_000) * rates.inputPerMillionCny +
    (outputTokens / 1_000_000) * rates.outputPerMillionCny
  ).toFixed(6));
}
