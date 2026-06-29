import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDefaultDesignProfiles, generateReactViteProject } from '@atoms-cp/codegen';
import {
  aiSelectorPatchInputSchema,
  createBuildJobInputSchema,
  codegenReactViteInputSchema,
  createProjectInputSchema,
  directTextPatchInputSchema,
  githubCommitResultSchema,
  githubCommitRequestSchema,
  projectVersionRollbackResultSchema,
  projectManifestResponseSchema,
  updateProjectDeploymentInputSchema,
  updateAppSpecInputSchema,
  updateProjectInputSchema,
  type ProjectDetail,
  type ProjectVersionRecord
} from '@atoms-cp/shared';
import { getModelRuntimeConfig, loadEnv } from '../config/env.js';
import { resolveRequestUser } from '../modules/auth/requestUser.js';
import type { AppStore } from '../modules/data/appStore.js';
import { getGitHubAccessTokenForUser } from '../modules/github/githubConnector.js';
import { createGitHubCommitPlan } from '../modules/github/githubCommit.js';
import type { GitHubApiClient } from '../modules/github/githubClient.js';
import { createGitHubApiClient } from '../modules/github/githubClient.js';
import { createModelClient } from '../modules/model/modelClient.js';
import { createCodeZip, filterDownloadFiles } from '../modules/download/codeZip.js';
import { createInitialCodexTaskPlan } from '../modules/orchestrator/codexTaskPlanner.js';
import { generateSelectorPatchPlan, SelectorPatchError } from '../modules/selector/selectorPatchAgent.js';
import { applySelectorTextPatch } from '../modules/selector/selectorPatchWorkflow.js';
import { generateProjectAppSpec, SpecGenerationError } from '../modules/spec/specAgent.js';
import { ProjectVersionRollbackError, rollbackProjectVersion } from '../modules/version/rollbackWorkflow.js';
import { collectWorkspaceFiles, copyWorkspaceVersion, workspaceVersionPath } from '../modules/workspace/workspaceService.js';

interface ProjectParams {
  projectId: string;
}

interface SpecParams extends ProjectParams {
  specId: string;
}

interface DesignParams extends ProjectParams {
  designId: string;
}

interface FileQuery {
  path?: string;
}

interface BuildParams extends ProjectParams {
  buildJobId: string;
}

interface VersionParams extends ProjectParams {
  versionId: string;
}

interface CodeDownloadQuery {
  versionId?: string;
}

function isConfigured(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function isGitHubHandoffConfigured(env: ReturnType<typeof loadEnv>): boolean {
  return isConfigured(env.GITHUB_TOKEN)
    || (isConfigured(env.GITHUB_CLIENT_ID) && isConfigured(env.GITHUB_CLIENT_SECRET));
}

function getModelApiKey(env: ReturnType<typeof loadEnv>, model: ReturnType<typeof getModelRuntimeConfig>): string | undefined {
  if (model.provider === 'deepseek') {
    return env.DEEPSEEK_API_KEY;
  }

  if (model.provider === 'volcengine') {
    if (!env.VOLCENGINE_API_KEY_FILE) {
      return undefined;
    }

    return readFileSync(env.VOLCENGINE_API_KEY_FILE, 'utf8').trim();
  }

  return env.MODEL_API_KEY;
}

function publicProjectVersion(version: ProjectVersionRecord): ProjectVersionRecord {
  const { workspacePath: _workspacePath, ...publicVersion } = version;
  return publicVersion;
}

async function getActiveReadyPreviewSnapshot(store: AppStore, projectId: string) {
  const snapshots = await store.listPreviewSnapshots(projectId);
  return snapshots.find((snapshot) => snapshot.active && snapshot.status === 'ready');
}

async function createSelectorPatchTask(input: {
  store: AppStore;
  project: ProjectDetail;
  aiId: string;
  instruction: string;
  operation: 'update_style' | 'update_props';
  targetFile: string;
  env: ReturnType<typeof loadEnv>;
}) {
  const appSpec = await input.store.getLatestAppSpec(input.project.id);
  const selectedDesign = await input.store.getSelectedDesignProfile(input.project.id);
  const fallbackDesign = selectedDesign ?? (await input.store.listDesignProfiles(input.project.id))[0];

  if (!appSpec || !fallbackDesign) {
    throw new SelectorPatchError('Project is not ready for selector patch', 'INTERNAL_ERROR', 409);
  }

  const [latestVersion] = await input.store.listProjectVersions(input.project.id);
  const workspacePath = workspaceVersionPath({
    workspaceRoot: input.env.CODEX_WORKSPACE_ROOT,
    projectId: input.project.id,
    taskId: `selector-ai-${randomUUID()}`
  });

  if (latestVersion?.workspacePath) {
    await copyWorkspaceVersion({
      sourcePath: latestVersion.workspacePath,
      targetPath: workspacePath
    });
    await input.store.appendTraceEvent({
      projectId: input.project.id,
      type: 'workspace_copied',
      visibility: 'admin',
      message: 'Workspace copied for selector AI patch.',
      payload: {
        parentVersionId: latestVersion.id
      }
    });
  }

  const workspace = await input.store.createWorkspace({
    projectId: input.project.id,
    projectVersionId: latestVersion?.id,
    path: workspacePath,
    status: 'ready'
  });
  const basePlan = createInitialCodexTaskPlan({
    project: input.project,
    appSpec: appSpec.spec,
    designProfile: fallbackDesign.profile
  });
  const allowedPaths = [input.targetFile, 'ai-manifest.json'];
  const taskSpec = {
    ...basePlan.taskSpec,
    goal: `Apply a constrained ${input.operation} selector patch.`,
    targetChange: {
      type: 'selector_patch' as const,
      summary: input.instruction,
      affectedAiIds: [input.aiId]
    },
    allowedPaths,
    forbiddenPaths: ['.env', 'node_modules/**', 'dist/**', '.git/**', '../**', '/**'],
    expectedOutputs: ['Updated selected element only', 'Valid ai-manifest.json']
  };
  const codexTask = await input.store.createCodexTask({
    projectId: input.project.id,
    projectVersionId: latestVersion?.id,
    workspaceId: workspace.id,
    taskType: 'selector_patch',
    objective: `Apply a constrained selector patch for ${input.aiId}.`,
    inputSummary: [
      `目标元素: ${input.aiId}`,
      `目标文件: ${input.targetFile}`,
      `修改类型: ${input.operation}`,
      `用户要求: ${input.instruction.slice(0, 240)}`
    ].join('\n'),
    taskSpec,
    allowedPaths,
    forbiddenPaths: taskSpec.forbiddenPaths,
    validationCommands: basePlan.validationCommands
  });
  await input.store.appendTraceEvent({
    projectId: input.project.id,
    codexTaskId: codexTask.id,
    type: 'selector_patch_created',
    visibility: 'user',
    message: '已收到局部修改请求，正在排队生成新版本。',
    payload: {
      stage: 'queueing_app_build',
      aiId: input.aiId
    }
  });

  return {
    workspace,
    codexTask
  };
}

async function getGitHubCommitFiles(input: {
  store: AppStore;
  projectId: string;
  projectVersionId?: string;
}) {
  if (!input.projectVersionId) {
    return await input.store.listProjectFiles(input.projectId);
  }

  const versions = await input.store.listProjectVersions(input.projectId);
  const version = versions.find((item) => item.id === input.projectVersionId);

  if (!version) {
    return undefined;
  }

  if (version.workspacePath) {
    return await collectWorkspaceFiles(version.workspacePath);
  }

  return await input.store.listProjectFiles(input.projectId);
}

export interface ProjectRouteOptions {
  githubClient?: GitHubApiClient;
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  store: AppStore,
  options: ProjectRouteOptions = {}
): Promise<void> {
  const githubClient = options.githubClient ?? createGitHubApiClient(loadEnv());

  app.get('/api/projects', async (request) => {
    const user = resolveRequestUser(request);
    return await store.listProjectsForUser(user);
  });

  app.post('/api/projects', async (request, reply) => {
    const parsed = createProjectInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid project input',
        details: parsed.error.flatten()
      });
    }

    const user = resolveRequestUser(request);
    const project = await store.createProject(user, parsed.data);
    return reply.code(201).send(project);
  });

  app.get('/api/projects/:projectId', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    return project;
  });

  app.patch('/api/projects/:projectId', async (request, reply) => {
    const parsed = updateProjectInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid project input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.updateProject(user, projectId, parsed.data);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    return project;
  });

  app.post('/api/projects/:projectId/spec/generate', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    try {
      const env = loadEnv();
      const model = getModelRuntimeConfig(env);
      const apiKey = getModelApiKey(env, model);
      const modelClient = createModelClient(model, apiKey, env.MODEL_REQUEST_TIMEOUT_MS);
      const result = await generateProjectAppSpec(project, model, modelClient, store);

      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof SpecGenerationError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          errorType: error.errorType
        });
      }

      request.log.error({ error }, 'AppSpec generation failed');
      return reply.code(502).send({
        error: 'AppSpec generation failed',
        errorType: 'INTERNAL_ERROR'
      });
    }
  });

  app.get('/api/projects/:projectId/spec/latest', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.getLatestAppSpec(projectId);

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    return appSpec;
  });

  app.put('/api/projects/:projectId/spec/latest', async (request, reply) => {
    const parsed = updateAppSpecInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid AppSpec input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.updateLatestAppSpec({
      projectId,
      spec: parsed.data.spec
    });

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    return appSpec;
  });

  app.post('/api/projects/:projectId/spec/:specId/confirm', async (request, reply) => {
    const { projectId, specId } = request.params as SpecParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.confirmAppSpec({
      projectId,
      specId
    });

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    return appSpec;
  });

  app.post('/api/projects/:projectId/design/generate', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.getLatestAppSpec(projectId);

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    const profiles = await store.createDesignProfiles({
      projectId,
      specVersionId: appSpec.id,
      profiles: createDefaultDesignProfiles(appSpec.spec)
    });
    await store.setProjectStatus(projectId, 'design_ready');

    return reply.code(201).send({
      profiles
    });
  });

  app.get('/api/projects/:projectId/designs', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    return await store.listDesignProfiles(projectId);
  });

  app.post('/api/projects/:projectId/designs/:designId/select', async (request, reply) => {
    const { projectId, designId } = request.params as DesignParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const selected = await store.selectDesignProfile(projectId, designId);

    if (!selected) {
      return reply.code(404).send({
        error: 'Design profile not found'
      });
    }

    return selected;
  });

  app.post('/api/projects/:projectId/codegen/react-vite', async (request, reply) => {
    const parsed = codegenReactViteInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid codegen input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const appSpec = await store.getLatestAppSpec(projectId);

    if (!appSpec) {
      return reply.code(404).send({
        error: 'AppSpec not found'
      });
    }

    const design = parsed.data.designId
      ? (await store.listDesignProfiles(projectId)).find((record) => record.id === parsed.data.designId)
      : await store.getSelectedDesignProfile(projectId);

    if (!design) {
      return reply.code(404).send({
        error: 'Design profile not found'
      });
    }

    const supabaseConfig = await store.getProjectSupabaseConfig(projectId);
    const generated = generateReactViteProject({
      appSpec: appSpec.spec,
      designProfile: design.profile,
      projectName: project.name,
      supabaseConfig: supabaseConfig
        ? {
            supabaseUrl: supabaseConfig.supabaseUrl,
            anonKey: supabaseConfig.anonKey
          }
        : undefined
    });
    const saved = await store.saveGeneratedProject({
      projectId,
      specVersionId: appSpec.id,
      designProfileId: design.id,
      summary: generated.summary,
      files: generated.files,
      manifest: generated.manifest
    });
    await store.setProjectStatus(projectId, 'code_generating');

    return reply.code(201).send({
      summary: generated.summary,
      projectVersion: saved.projectVersion,
      files: saved.files,
      manifest: generated.manifest,
      warnings: generated.warnings
    });
  });

  app.get('/api/projects/:projectId/files', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const { path } = request.query as FileQuery;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    if (path) {
      const file = await store.getProjectFile(projectId, path);

      if (!file) {
        return reply.code(404).send({
          error: 'Project file not found'
        });
      }

      return file;
    }

    return await store.listProjectFiles(projectId);
  });

  app.get('/api/projects/:projectId/code/download', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const { versionId } = request.query as CodeDownloadQuery;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const files = await getGitHubCommitFiles({
      store,
      projectId,
      projectVersionId: versionId
    });

    if (!files) {
      return reply.code(404).send({
        error: 'Project version not found'
      });
    }

    const safeFiles = filterDownloadFiles(files);

    if (safeFiles.length === 0) {
      return reply.code(404).send({
        error: 'No downloadable files'
      });
    }

    const archive = createCodeZip(safeFiles);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="${project.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'atoms-cp-project'}.zip"`)
      .send(archive);
  });

  app.get('/api/projects/:projectId/manifest', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const manifestFile = await store.getProjectFile(projectId, 'ai-manifest.json');

    if (!manifestFile) {
      return reply.code(404).send({
        error: 'AI manifest not found'
      });
    }

    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestFile.content);
    } catch {
      return reply.code(409).send({
        error: 'AI manifest is invalid'
      });
    }

    const versions = await store.listProjectVersions(projectId);
    const parsed = projectManifestResponseSchema.safeParse({
      projectId,
      projectVersionId: versions[0]?.id,
      manifest: manifestJson,
      entries: Object.values((manifestJson as { entries?: unknown }).entries ?? {})
    });

    if (!parsed.success) {
      return reply.code(409).send({
        error: 'AI manifest is invalid',
        details: parsed.error.flatten()
      });
    }

    return parsed.data;
  });

  app.get('/api/projects/:projectId/versions', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const versions = await store.listProjectVersions(projectId);
    return versions.map(publicProjectVersion);
  });

  app.post('/api/projects/:projectId/versions/:versionId/rollback', async (request, reply) => {
    const { projectId, versionId } = request.params as VersionParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    try {
      const env = loadEnv();
      const result = await rollbackProjectVersion({
        store,
        projectId,
        targetVersionId: versionId,
        workspaceRoot: env.CODEX_WORKSPACE_ROOT
      });

      return reply.code(201).send(projectVersionRollbackResultSchema.parse({
        ...result,
        projectVersion: publicProjectVersion(result.projectVersion)
      }));
    } catch (error) {
      if (error instanceof ProjectVersionRollbackError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          errorType: error.errorType
        });
      }

      throw error;
    }
  });

  app.post('/api/projects/:projectId/selector/text-patch', async (request, reply) => {
    const parsed = directTextPatchInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid selector text patch input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const env = loadEnv();

    try {
      const result = await applySelectorTextPatch({
        store,
        projectId,
        aiId: parsed.data.aiId,
        text: parsed.data.text,
        source: 'selector_edit',
        summary: `Updated ${parsed.data.aiId} text`,
        purpose: `Selector text patch for ${parsed.data.aiId}`,
        workspaceRoot: env.CODEX_WORKSPACE_ROOT
      });

      return reply.code(201).send({
        ...result,
        projectVersion: publicProjectVersion(result.projectVersion)
      });
    } catch (error) {
      if (error instanceof SelectorPatchError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          errorType: error.errorType
        });
      }

      throw error;
    }
  });

  app.post('/api/projects/:projectId/selector/ai-patch', async (request, reply) => {
    const parsed = aiSelectorPatchInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid AI selector patch input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const env = loadEnv();
    const model = getModelRuntimeConfig(env);
    const apiKey = getModelApiKey(env, model);
    const modelClient = createModelClient(model, apiKey, env.MODEL_REQUEST_TIMEOUT_MS);

    let selectorPlan: Awaited<ReturnType<typeof generateSelectorPatchPlan>> | undefined;

    try {
      selectorPlan = await generateSelectorPatchPlan({
        project,
        aiId: parsed.data.aiId,
        instruction: parsed.data.instruction,
        selectedText: parsed.data.selectedText,
        model,
        modelClient,
        store
      });
      if (selectorPlan.operation !== 'replace_text') {
        const queued = await createSelectorPatchTask({
          store,
          project,
          aiId: parsed.data.aiId,
          instruction: selectorPlan.instruction ?? parsed.data.instruction,
          operation: selectorPlan.operation,
          targetFile: selectorPlan.manifestEntry.file,
          env
        });
        await store.updateAgentRun(selectorPlan.agentRun.id, {
          status: 'succeeded',
          outputSnapshot: {
            aiId: parsed.data.aiId,
            operation: selectorPlan.operation,
            codexTaskId: queued.codexTask.id
          }
        });

        return reply.code(202).send({
          queued: true,
          operation: selectorPlan.operation,
          manifestEntry: selectorPlan.manifestEntry,
          task: {
            taskType: queued.codexTask.taskType,
            status: queued.codexTask.status,
            allowedPaths: queued.codexTask.allowedPaths
          },
          agentRun: selectorPlan.agentRun,
          modelInvocation: selectorPlan.modelInvocation
        });
      }

      if (!selectorPlan.replacementText) {
        throw new SelectorPatchError('Selector patch text is missing', 'SCHEMA_VALIDATION_FAILED', 409);
      }
      const result = await applySelectorTextPatch({
        store,
        projectId,
        aiId: parsed.data.aiId,
        text: selectorPlan.replacementText,
        source: 'agent_patch',
        summary: `AI selector patch for ${parsed.data.aiId}`,
        purpose: `AI selector patch for ${parsed.data.aiId}`,
        workspaceRoot: env.CODEX_WORKSPACE_ROOT
      });
      const agentRun = await store.updateAgentRun(selectorPlan.agentRun.id, {
        status: 'succeeded',
        outputSnapshot: {
          aiId: parsed.data.aiId,
          operation: 'replace_text',
          projectVersionId: result.projectVersion.id,
          changedFiles: result.projectVersion.changedFiles
        }
      });

      return reply.code(201).send({
        ...result,
        projectVersion: publicProjectVersion(result.projectVersion),
        agentRun,
        modelInvocation: selectorPlan.modelInvocation
      });
    } catch (error) {
      if (selectorPlan) {
        await store.updateAgentRun(selectorPlan.agentRun.id, {
          status: 'failed',
          errorType: error instanceof SelectorPatchError ? error.errorType : 'INTERNAL_ERROR',
          errorMessage: error instanceof Error ? error.message : 'AI selector patch failed'
        });
      }

      if (error instanceof SelectorPatchError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          errorType: error.errorType
        });
      }

      throw error;
    }
  });

  app.post('/api/projects/:projectId/builds', async (request, reply) => {
    const parsed = createBuildJobInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid build input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const files = await getGitHubCommitFiles({
      store,
      projectId,
      projectVersionId: parsed.data.projectVersionId
    });

    if (!files) {
      return reply.code(404).send({
        error: 'Project version not found'
      });
    }

    if (files.length === 0) {
      return reply.code(409).send({
        error: 'Project has no generated files to build'
      });
    }

    const buildJob = await store.createBuildJob(projectId, parsed.data);
    await store.setProjectStatus(projectId, 'building');

    return reply.code(201).send(buildJob);
  });

  app.get('/api/projects/:projectId/builds/:buildJobId', async (request, reply) => {
    const { projectId, buildJobId } = request.params as BuildParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const buildJob = await store.getBuildJob(projectId, buildJobId);

    if (!buildJob) {
      return reply.code(404).send({
        error: 'Build job not found'
      });
    }

    return buildJob;
  });

  app.get('/api/projects/:projectId/builds/:buildJobId/logs', async (request, reply) => {
    const { projectId, buildJobId } = request.params as BuildParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const buildJob = await store.getBuildJob(projectId, buildJobId);

    if (!buildJob) {
      return reply.code(404).send({
        error: 'Build job not found'
      });
    }

    return await store.listBuildLogs(buildJobId);
  });

  app.post('/api/projects/:projectId/github/commit', async (request, reply) => {
    const parsed = githubCommitRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid GitHub commit input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const files = await store.listProjectFiles(projectId);

    if (files.length === 0) {
      return reply.code(409).send({
        error: 'Project has no generated files to commit'
      });
    }

    const plan = createGitHubCommitPlan({
      projectId,
      files,
      request: parsed.data
    });

    if (!parsed.data.confirmed) {
      return plan;
    }

    const env = loadEnv();
    const token = await getGitHubAccessTokenForUser({
      store,
      userId: user.id,
      env
    });
    if (!token) {
      return reply.code(409).send({
        error: 'GitHub connection is required before code handoff'
      });
    }

    let result;

    try {
      const commit = await githubClient.commitFiles(token, {
        repoFullName: plan.repoFullName,
        branch: plan.branch,
        message: plan.message,
        files
      });
      const { requiresConfirmation: _requiresConfirmation, ...confirmedPlan } = plan;

      result = githubCommitResultSchema.parse({
        ...confirmedPlan,
        provider: 'github',
        ...commit
      });
    } catch (error) {
      request.log.error({ error }, 'GitHub file commit failed');
      return reply.code(502).send({
        error: 'GitHub file commit failed'
      });
    }

    await store.updateProjectGitHubCommit(projectId, {
      repoFullName: result.repoFullName,
      commitSha: result.commitSha
    });

    return reply.code(201).send(result);
  });

  app.get('/api/projects/:projectId/publish', async (request, reply) => {
    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const env = loadEnv();
    const latestBuildJob = await store.getLatestBuildJob(projectId);
    const [currentVersion] = await store.listProjectVersions(projectId);
    const activePreviewSnapshot = await getActiveReadyPreviewSnapshot(store, projectId);
    const supabaseConfig = await store.getProjectSupabaseConfig(projectId);
    return await store.getProjectPublishState({
      project,
      latestBuildJob,
      currentVersionId: currentVersion?.id,
      activePreviewSnapshot,
      githubConfigured: isGitHubHandoffConfigured(env),
      supabaseConfigured: Boolean(supabaseConfig),
      supabaseFrontendEnvConfirmed: Boolean(supabaseConfig?.frontendEnvConfirmedAt),
      supabaseLastConnectionStatus: supabaseConfig?.lastConnectionStatus
    });
  });

  app.put('/api/projects/:projectId/publish/deployment-url', async (request, reply) => {
    const parsed = updateProjectDeploymentInputSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid deployment URL input',
        details: parsed.error.flatten()
      });
    }

    const { projectId } = request.params as ProjectParams;
    const user = resolveRequestUser(request);
    const project = await store.getProjectById(user, projectId);

    if (!project) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const supabaseConfig = await store.getProjectSupabaseConfig(projectId);

    if (supabaseConfig && !supabaseConfig.frontendEnvConfirmedAt) {
      return reply.code(409).send({
        error: 'Confirm VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deploy target before marking deployed.'
      });
    }

    if (supabaseConfig && supabaseConfig.lastConnectionStatus !== 'passed') {
      return reply.code(409).send({
        error: 'Run a passing Supabase live connection test before marking deployed.'
      });
    }

    const activePreviewSnapshot = await getActiveReadyPreviewSnapshot(store, projectId);

    if (!activePreviewSnapshot) {
      return reply.code(409).send({
        error: 'Create an active ready preview snapshot before marking deployed.'
      });
    }

    const updatedProject = await store.updateProjectDeploymentUrl(projectId, parsed.data);

    if (!updatedProject) {
      return reply.code(404).send({
        error: 'Project not found'
      });
    }

    const env = loadEnv();
    const latestBuildJob = await store.getLatestBuildJob(projectId);
    const [currentVersion] = await store.listProjectVersions(projectId);
    return await store.getProjectPublishState({
      project: updatedProject,
      latestBuildJob,
      currentVersionId: currentVersion?.id,
      activePreviewSnapshot,
      githubConfigured: isGitHubHandoffConfigured(env),
      supabaseConfigured: Boolean(supabaseConfig),
      supabaseFrontendEnvConfirmed: Boolean(supabaseConfig?.frontendEnvConfirmedAt),
      supabaseLastConnectionStatus: supabaseConfig?.lastConnectionStatus
    });
  });
}
