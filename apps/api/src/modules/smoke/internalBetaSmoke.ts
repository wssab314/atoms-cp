import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDefaultDesignProfiles } from '@atoms-cp/codegen';
import {
  aiManifestSchema,
  createPreviewAccessToken,
  type AppSpec,
  type BuildJobRecord,
  type UserProfile
} from '@atoms-cp/shared';
import type { AppStore } from '../data/appStore.js';
import { processNextCodexTask } from '../codex/dryRunCodexWorker.js';
import { createInitialCodexTaskPlan } from '../orchestrator/codexTaskPlanner.js';
import { applySelectorTextPatch } from '../selector/selectorPatchWorkflow.js';
import { rollbackProjectVersion } from '../version/rollbackWorkflow.js';

export interface InternalBetaSmokeInput {
  store: AppStore;
  workspaceRoot: string;
  previewRoot: string;
  previewBaseUrl: string;
  previewAccessSecret: string;
  projectName?: string;
}

export interface InternalBetaSmokeReport {
  status: 'passed' | 'failed';
  projectId?: string;
  codexTaskId?: string;
  initialBuildJobId?: string;
  initialPreviewSnapshotId?: string;
  selectorPatchBuildJobId?: string;
  selectorPatchPreviewSnapshotId?: string;
  rollbackVersionId?: string;
  rollbackBuildJobId?: string;
  rollbackPreviewSnapshotId?: string;
  previewUrl?: string;
  publishCanProceed: boolean;
  traceCount: number;
  errors: string[];
}

const smokeUser: UserProfile = {
  id: 'user-creator',
  email: 'creator@example.local',
  name: 'Creator',
  role: 'creator'
};

function createSmokeAppSpec(projectName: string): AppSpec {
  return {
    appName: projectName,
    appGoal: '验证 atoms-cp 内测生成、预览、微调、回退和发布状态闭环。',
    targetUser: '内测运营人员',
    pages: [
      {
        id: 'home',
        name: '首页',
        route: '/',
        purpose: '展示内测应用的核心状态。',
        sections: [
          {
            id: 'hero',
            kind: 'hero',
            title: '内测应用总览',
            content: '展示生成闭环、预览快照和版本状态。'
          },
          {
            id: 'stats',
            kind: 'stats',
            title: '运行指标',
            content: '展示任务、快照和发布状态。'
          }
        ],
        actions: [
          {
            id: 'continue',
            label: '继续修改',
            type: 'submit'
          }
        ]
      }
    ],
    styleIntent: {
      tone: 'quiet',
      layoutDensity: 'comfortable'
    },
    dataModels: [],
    integrations: [],
    constraints: ['普通用户界面不出现底层技术词。'],
    nonGoals: ['不连接真实外部发布服务。'],
    acceptanceCriteria: ['可以生成预览快照', '可以进行一次文本微调', '可以回退版本']
  };
}

function redactSmokeText(value: string, input: InternalBetaSmokeInput): string {
  return [
    input.workspaceRoot,
    input.previewRoot,
    input.previewAccessSecret
  ].reduce((text, token) => text.split(token).join('[redacted]'), value);
}

async function completeSmokeBuild(input: {
  store: AppStore;
  buildJob: BuildJobRecord;
  previewRoot: string;
  previewBaseUrl: string;
  previewAccessSecret: string;
}) {
  const startedAt = new Date().toISOString();
  await input.store.updateBuildJob(input.buildJob.id, {
    status: 'running',
    command: 'internal-beta-smoke-build',
    startedAt
  });
  await input.store.appendTraceEvent({
    projectId: input.buildJob.projectId,
    buildJobId: input.buildJob.id,
    type: 'build_started',
    visibility: 'admin',
    message: 'Internal beta smoke build started.',
    payload: {
      projectVersionId: input.buildJob.projectVersionId
    }
  });

  const previewPath = join(input.previewRoot, input.buildJob.id);
  await mkdir(previewPath, { recursive: true });
  await writeFile(
    join(previewPath, 'index.html'),
    await createSmokePreviewHtml(input.store, input.buildJob.projectId),
    'utf8'
  );
  const token = createPreviewAccessToken({
    buildJobId: input.buildJob.id,
    secret: input.previewAccessSecret
  });
  const previewUrl = `${input.previewBaseUrl.replace(/\/$/, '')}/${input.buildJob.id}/index.html?token=${encodeURIComponent(token)}`;
  const snapshot = await input.store.createPreviewSnapshot({
    projectId: input.buildJob.projectId,
    projectVersionId: input.buildJob.projectVersionId ?? input.buildJob.id,
    buildJobId: input.buildJob.id,
    status: 'ready',
    path: previewPath,
    url: previewUrl,
    active: true
  });
  await input.store.appendTraceEvent({
    projectId: input.buildJob.projectId,
    buildJobId: input.buildJob.id,
    type: 'preview_snapshot_created',
    visibility: 'admin',
    message: 'Internal beta smoke preview snapshot created.',
    payload: {
      previewSnapshotId: snapshot.id,
      projectVersionId: snapshot.projectVersionId
    }
  });
  await input.store.appendTraceEvent({
    projectId: input.buildJob.projectId,
    buildJobId: input.buildJob.id,
    type: 'preview_snapshot_created',
    visibility: 'user',
    message: '预览快照已准备完成。',
    payload: {
      previewSnapshotId: snapshot.id,
      projectVersionId: snapshot.projectVersionId
    }
  });
  await input.store.updateBuildJob(input.buildJob.id, {
    status: 'success',
    previewUrl,
    finishedAt: new Date().toISOString()
  });
  await input.store.setProjectStatus(input.buildJob.projectId, 'preview_ready');
  await input.store.appendTraceEvent({
    projectId: input.buildJob.projectId,
    buildJobId: input.buildJob.id,
    type: 'build_completed',
    visibility: 'admin',
    message: 'Internal beta smoke build completed.',
    payload: {
      previewSnapshotId: snapshot.id
    }
  });

  return snapshot;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function createSmokePreviewHtml(store: AppStore, projectId: string): Promise<string> {
  const manifestFile = await store.getProjectFile(projectId, 'ai-manifest.json');
  const manifest = manifestFile
    ? aiManifestSchema.parse(JSON.parse(manifestFile.content))
    : { entries: {} };
  const entries = Object.values(manifest.entries);
  const editableEntries = entries.length > 0
    ? entries
    : [
        {
          aiId: 'home.hero.title',
          file: 'src/App.tsx',
          component: 'GeneratedApp',
          elementType: 'heading',
          editable: ['text' as const]
        }
      ];
  const cards = editableEntries.map((entry, index) => {
    const title = index === 0 ? '内测应用总览' : `可编辑区域 ${index + 1}`;
    return [
      '<article class="card">',
      `<p class="eyebrow">${escapeHtml(entry.component)}</p>`,
      `<h2 data-ai-id="${escapeHtml(entry.aiId)}">${escapeHtml(title)}</h2>`,
      `<p>这个区块用于验证预览快照、选择器微调和版本回退链路。</p>`,
      '</article>'
    ].join('');
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atoms CP Internal Preview</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f8f8f6; color: #171a1f; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(1080px, calc(100vw - 40px)); margin: 0 auto; padding: 40px 0; }
    .hero { border: 1px solid #e7e8ec; border-radius: 18px; background: white; box-shadow: 0 14px 34px rgba(23, 26, 31, 0.08); padding: 28px; }
    .hero h1 { margin: 8px 0 10px; font-size: clamp(30px, 4vw, 48px); line-height: 1.05; }
    .lede { color: #667085; line-height: 1.7; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 18px; }
    .card { min-height: 156px; border: 1px solid #e7e8ec; border-radius: 16px; background: white; padding: 20px; box-shadow: 0 10px 26px rgba(23, 26, 31, 0.06); }
    .card h2 { margin: 8px 0 10px; font-size: 22px; }
    .card p { color: #667085; line-height: 1.65; }
    .eyebrow { margin: 0; color: #315cf6; font-size: 12px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <p class="eyebrow">Internal Beta Preview</p>
      <h1 data-ai-id="${escapeHtml(editableEntries[0]?.aiId ?? 'home.hero.title')}">真实内测闭环预览</h1>
      <p class="lede">用于验收项目生成、预览快照、选择器微调、版本回退和发布状态。</p>
    </section>
    <section class="grid" aria-label="Generated application">
      ${cards}
    </section>
  </main>
  <script>
${createSmokeInspectorRuntimeScript()}
  </script>
</body>
</html>
`;
}

function createSmokeInspectorRuntimeScript(): string {
  return `(function () {
  var inspectorEnabled = new URL(window.location.href).searchParams.get('inspector') === '1';
  var highlightedElement = null;

  function parentTargetOrigin() {
    try {
      return document.referrer ? new URL(document.referrer).origin : '*';
    } catch (_error) {
      return '*';
    }
  }

  function findByAiId(aiId) {
    var nodes = document.querySelectorAll('[data-ai-id]');
    for (var index = 0; index < nodes.length; index += 1) {
      if (nodes[index].getAttribute('data-ai-id') === aiId) {
        return nodes[index];
      }
    }
    return null;
  }

  function closestInspectableElement(target) {
    return target instanceof HTMLElement ? target.closest('[data-ai-id]') : null;
  }

  function readableElementText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return undefined;
    }
    var text = element.textContent ? element.textContent.trim() : '';
    return text ? text.slice(0, 500) : undefined;
  }

  function messageForElement(element, eventName) {
    return {
      type: eventName === 'INSPECTOR_SELECT' ? 'atoms-cp:preview-element-selected' : 'atoms-cp:preview-element-hovered',
      event: eventName,
      aiId: element.getAttribute('data-ai-id') || '',
      text: readableElementText(element),
      className: typeof element.className === 'string' ? element.className.slice(0, 500) : undefined,
      tagName: element.tagName
    };
  }

  function setHighlight(element) {
    if (highlightedElement) {
      highlightedElement.style.outline = '';
      highlightedElement.style.outlineOffset = '';
    }
    highlightedElement = element;
    if (highlightedElement) {
      highlightedElement.style.outline = '2px solid #315cf6';
      highlightedElement.style.outlineOffset = '3px';
    }
  }

  window.addEventListener('message', function (event) {
    var allowedOrigin = parentTargetOrigin();
    if (event.source !== window.parent) {
      return;
    }
    if (allowedOrigin !== '*' && event.origin && event.origin !== allowedOrigin) {
      return;
    }
    var command = event.data || {};
    if (command.type === 'INSPECTOR_ENABLE') {
      inspectorEnabled = true;
    } else if (command.type === 'INSPECTOR_DISABLE') {
      inspectorEnabled = false;
      setHighlight(null);
    } else if (command.type === 'INSPECTOR_HIGHLIGHT' && typeof command.aiId === 'string') {
      setHighlight(findByAiId(command.aiId));
    }
  });

  document.addEventListener('pointerover', function (event) {
    if (!inspectorEnabled) {
      return;
    }
    var element = closestInspectableElement(event.target);
    if (!element) {
      return;
    }
    setHighlight(element);
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_HOVER'), parentTargetOrigin());
  }, true);

  document.addEventListener('click', function (event) {
    if (!inspectorEnabled) {
      return;
    }
    var element = closestInspectableElement(event.target);
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_SELECT'), parentTargetOrigin());
  }, true);
}());`;
}

async function getFirstEditableAiId(store: AppStore, projectId: string): Promise<string> {
  const manifestFile = await store.getProjectFile(projectId, 'ai-manifest.json');

  if (!manifestFile) {
    throw new Error('AI manifest missing after deterministic worker.');
  }

  const manifest = aiManifestSchema.parse(JSON.parse(manifestFile.content));
  const entry = Object.values(manifest.entries).find((item) => item.editable.includes('text'));

  if (!entry) {
    throw new Error('AI manifest has no text-editable entry.');
  }

  return entry.aiId;
}

export async function runInternalBetaSmoke(input: InternalBetaSmokeInput): Promise<InternalBetaSmokeReport> {
  const report: InternalBetaSmokeReport = {
    status: 'failed',
    publishCanProceed: false,
    traceCount: 0,
    errors: []
  };

  try {
    const projectName = input.projectName ?? 'R7 Internal Beta Smoke';
    const user = await input.store.ensureUser(smokeUser);
    const project = await input.store.createProject(user, {
      name: projectName,
      prompt: '生成一个用于验证内测闭环的 Web 应用，包含首页、指标和继续修改入口。',
      target: 'web'
    });
    report.projectId = project.id;
    await input.store.appendTraceEvent({
      projectId: project.id,
      type: 'agent_started',
      visibility: 'admin',
      message: 'Internal beta smoke started.',
      payload: {
        mode: 'deterministic'
      }
    });

    const appSpec = createSmokeAppSpec(project.name);
    const agentRun = await input.store.createAgentRun({
      projectId: project.id,
      purpose: 'app_spec_generation',
      provider: 'volcengine',
      status: 'succeeded',
      inputSnapshot: {
        smoke: true
      },
      outputSnapshot: {
        appName: appSpec.appName
      }
    });
    const appSpecRecord = await input.store.createAppSpec({
      projectId: project.id,
      sourceAgentRunId: agentRun.id,
      spec: appSpec
    });
    const [designRecord] = await input.store.createDesignProfiles({
      projectId: project.id,
      specVersionId: appSpecRecord.id,
      profiles: createDefaultDesignProfiles(appSpec)
    });

    if (!designRecord) {
      throw new Error('Smoke design profile was not created.');
    }

    await input.store.selectDesignProfile(project.id, designRecord.id);
    const workspace = await input.store.createWorkspace({
      projectId: project.id,
      path: join(input.workspaceRoot, project.id, 'initial'),
      status: 'ready'
    });
    const taskPlan = createInitialCodexTaskPlan({
      project,
      appSpec,
      designProfile: designRecord.profile
    });
    const codexTask = await input.store.createCodexTask({
      projectId: project.id,
      workspaceId: workspace.id,
      ...taskPlan
    });
    report.codexTaskId = codexTask.id;
    await input.store.appendTraceEvent({
      projectId: project.id,
      codexTaskId: codexTask.id,
      type: 'codex_task_created',
      visibility: 'admin',
      message: 'Internal beta smoke CodexTask created.',
      payload: {
        workspaceId: workspace.id
      }
    });

    const processed = await processNextCodexTask(input.store, {
      workerId: 'internal-beta-smoke-worker',
      workspaceRoot: input.workspaceRoot
    });

    if (!processed || processed.status !== 'succeeded' || !processed.buildJobId) {
      throw new Error(processed?.errorSummary ?? 'Deterministic worker did not produce a build job.');
    }

    report.initialBuildJobId = processed.buildJobId;
    const initialBuildJob = await input.store.getBuildJob(project.id, processed.buildJobId);

    if (!initialBuildJob) {
      throw new Error('Initial smoke build job not found.');
    }

    const initialSnapshot = await completeSmokeBuild({
      store: input.store,
      buildJob: initialBuildJob,
      previewRoot: input.previewRoot,
      previewBaseUrl: input.previewBaseUrl,
      previewAccessSecret: input.previewAccessSecret
    });
    report.initialPreviewSnapshotId = initialSnapshot.id;
    report.previewUrl = initialSnapshot.url;

    const aiId = await getFirstEditableAiId(input.store, project.id);
    const selectorPatch = await applySelectorTextPatch({
      store: input.store,
      projectId: project.id,
      aiId,
      text: 'R7 内测已完成微调',
      source: 'selector_edit',
      summary: 'Internal beta smoke selector patch',
      purpose: 'Smoke selector text patch',
      workspaceRoot: input.workspaceRoot
    });
    report.selectorPatchBuildJobId = selectorPatch.buildJob.id;
    const selectorSnapshot = await completeSmokeBuild({
      store: input.store,
      buildJob: selectorPatch.buildJob,
      previewRoot: input.previewRoot,
      previewBaseUrl: input.previewBaseUrl,
      previewAccessSecret: input.previewAccessSecret
    });
    report.selectorPatchPreviewSnapshotId = selectorSnapshot.id;

    const rollback = await rollbackProjectVersion({
      store: input.store,
      projectId: project.id,
      targetVersionId: processed.projectVersionId ?? selectorPatch.projectVersion.parentVersionId ?? selectorPatch.projectVersion.id,
      workspaceRoot: input.workspaceRoot
    });
    report.rollbackVersionId = rollback.projectVersion.id;
    report.rollbackBuildJobId = rollback.buildJob.id;
    const rollbackSnapshot = await completeSmokeBuild({
      store: input.store,
      buildJob: rollback.buildJob,
      previewRoot: input.previewRoot,
      previewBaseUrl: input.previewBaseUrl,
      previewAccessSecret: input.previewAccessSecret
    });
    report.rollbackPreviewSnapshotId = rollbackSnapshot.id;

    await input.store.updateProjectGitHubCommit(project.id, {
      repoFullName: 'atoms-cp/internal-beta-smoke',
      commitSha: 'abcdef1234567890'
    });
    const updatedProject = await input.store.getProjectById(user, project.id);
    const latestBuildJob = await input.store.getLatestBuildJob(project.id);
    const [currentVersion] = await input.store.listProjectVersions(project.id);
    const activePreviewSnapshot = (await input.store.listPreviewSnapshots(project.id))
      .find((snapshot) => snapshot.active && snapshot.status === 'ready');

    if (!updatedProject) {
      throw new Error('Smoke project not found after publish state setup.');
    }

    const publishState = await input.store.getProjectPublishState({
      project: updatedProject,
      latestBuildJob,
      currentVersionId: currentVersion?.id,
      activePreviewSnapshot,
      githubConfigured: true,
      supabaseConfigured: false,
      supabaseFrontendEnvConfirmed: false
    });
    report.publishCanProceed = publishState.canPublish;
    const traces = await input.store.listTraceEvents(project.id, 100);
    report.traceCount = traces.length;
    report.status = 'passed';
    await input.store.appendTraceEvent({
      projectId: project.id,
      type: 'agent_completed',
      visibility: 'admin',
      message: 'Internal beta smoke completed.',
      payload: {
        traceCount: traces.length,
        publishCanProceed: publishState.canPublish
      }
    });
    report.traceCount = (await input.store.listTraceEvents(project.id, 100)).length;
    return report;
  } catch (error) {
    const errorSummary = redactSmokeText(error instanceof Error ? error.message : String(error), input);
    report.errors = [errorSummary];

    if (report.projectId) {
      await input.store.appendTraceEvent({
        projectId: report.projectId,
        type: 'error',
        visibility: 'admin',
        message: 'Internal beta smoke failed.',
        payload: {
          errorSummary
        }
      });
      report.traceCount = (await input.store.listTraceEvents(report.projectId, 100)).length;
    }

    return report;
  }
}
