import { describe, expect, it } from 'vitest';
import { createPostgresStore, runPostgresMigrations, type Queryable } from './postgresStore.js';

type Row = Record<string, unknown>;

interface RecordedQuery {
  text: string;
  values: readonly unknown[];
}

function iso(offset = 0): string {
  return new Date(Date.UTC(2026, 5, 27, 0, 0, offset)).toISOString();
}

function parseJsonValue<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);
}

function createFakeDb(): Queryable & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const users: Row[] = [];
  const projects: Row[] = [];
  const agentRuns: Row[] = [];
  const modelInvocations: Row[] = [];
  const appSpecs: Row[] = [];
  const designProfiles: Row[] = [];
  const projectVersions: Row[] = [];
  const projectFiles: Row[] = [];
  const aiManifests: Row[] = [];

  return {
    queries,
    async query<T extends Row = Row>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });

      if (text.includes('insert into users')) {
        const [id, email, name, role] = values;
        const existing = users.find((user) => user.id === id || user.email === email);
        if (existing) {
          return { rows: [existing as unknown as T] };
        }
        const row = {
          id,
          email,
          name,
          role,
          created_at: iso(),
          updated_at: iso()
        };
        users.push(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('select id, email, name, role')) {
        return { rows: users as unknown as T[] };
      }

      if (text.includes('insert into projects')) {
        const [ownerId, name, prompt, target] = values;
        const row = {
          id: `project-${projects.length + 1}`,
          owner_id: ownerId,
          name,
          description: prompt,
          status: 'draft',
          target,
          created_at: iso(projects.length + 1),
          updated_at: iso(projects.length + 1)
        };
        projects.push(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('where p.owner_id = $1 or $2 =')) {
        const [ownerId, role] = values;
        return {
          rows: projects.filter((project) => project.owner_id === ownerId || role === 'admin') as unknown as T[]
        };
      }

      if (text.includes('select p.id, p.owner_id')) {
        const [projectId, ownerId, role] = values;
        return {
          rows: projects.filter((project) => project.id === projectId && (project.owner_id === ownerId || role === 'admin')) as unknown as T[]
        };
      }

      if (text.includes('update projects') && text.includes('set status =')) {
        const [status, projectId] = values;
        const project = projects.find((existing) => existing.id === projectId);
        if (!project) {
          return { rows: [] };
        }
        project.status = status;
        project.updated_at = iso(20);
        return { rows: [project as unknown as T] };
      }

      if (text.includes('insert into agent_runs')) {
        const [projectId, purpose, provider, status, inputSnapshot] = values;
        const row = {
          id: `agent-run-${agentRuns.length + 1}`,
          project_id: projectId,
          purpose,
          provider,
          status,
          input_json: inputSnapshot,
          output_json: null,
          error_type: null,
          error_message: null,
          created_at: iso(30 + agentRuns.length),
          updated_at: iso(30 + agentRuns.length)
        };
        agentRuns.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('insert into model_invocations')) {
        const [
          projectId,
          agentRunId,
          provider,
          model,
          purpose,
          status,
          inputTokens,
          outputTokens,
          durationMs,
          estimatedCostCny,
          budgetLimitCny
        ] = values;
        const row = {
          id: `model-invocation-${modelInvocations.length + 1}`,
          project_id: projectId,
          agent_run_id: agentRunId,
          provider,
          model,
          purpose,
          status,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          duration_ms: durationMs,
          estimated_cost_cny: estimatedCostCny,
          budget_limit_cny: budgetLimitCny,
          error_type: null,
          error_message: null,
          created_at: iso(40 + modelInvocations.length)
        };
        modelInvocations.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('coalesce(max(version), 0) + 1 as next_version') && text.includes('from app_specs')) {
        const [projectId] = values;
        const latestVersion = appSpecs
          .filter((spec) => spec.project_id === projectId)
          .reduce((max, spec) => Math.max(max, Number(spec.version)), 0);
        return { rows: [{ next_version: latestVersion + 1 } as unknown as T] };
      }

      if (text.includes('insert into app_specs')) {
        const [projectId, sourceAgentRunId, version, spec] = values;
        const row = {
          id: `app-spec-${appSpecs.length + 1}`,
          project_id: projectId,
          source_agent_run_id: sourceAgentRunId,
          version,
          status: 'validated',
          spec_json: spec,
          created_at: iso(50 + appSpecs.length),
          updated_at: iso(50 + appSpecs.length)
        };
        appSpecs.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('update app_specs') && text.includes("set status = 'confirmed'")) {
        const [projectId, specId] = values;
        const spec = appSpecs.find((record) => record.project_id === projectId && record.id === specId);
        if (!spec) {
          return { rows: [] };
        }
        spec.status = 'confirmed';
        spec.updated_at = iso(70);
        return { rows: [spec as unknown as T] };
      }

      if (text.includes('from app_specs') && text.includes('order by version desc')) {
        const [projectId] = values;
        return {
          rows: appSpecs.filter((spec) => spec.project_id === projectId).sort((a, b) => Number(b.version) - Number(a.version)).slice(0, 1) as unknown as T[]
        };
      }

      if (text.includes('coalesce(max(version), 0) + 1 as next_version') && text.includes('from design_profiles')) {
        const [projectId] = values;
        const latestVersion = designProfiles
          .filter((profile) => profile.project_id === projectId)
          .reduce((max, profile) => Math.max(max, Number(profile.version)), 0);
        return { rows: [{ next_version: latestVersion + 1 } as unknown as T] };
      }

      if (text.includes('insert into design_profiles')) {
        const [projectId, specVersionId, version, profile] = values;
        const row = {
          id: `design-profile-${designProfiles.length + 1}`,
          project_id: projectId,
          spec_version_id: specVersionId,
          version,
          profile_json: parseJsonValue(profile),
          selected: false,
          created_at: iso(80 + designProfiles.length)
        };
        designProfiles.push(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('from design_profiles') && text.includes('order by version asc')) {
        const [projectId] = values;
        return {
          rows: designProfiles
            .filter((profile) => profile.project_id === projectId)
            .sort((a, b) => Number(a.version) - Number(b.version)) as unknown as T[]
        };
      }

      if (text.includes('update design_profiles') && text.includes('set selected = false')) {
        const [projectId] = values;
        designProfiles.forEach((profile) => {
          if (profile.project_id === projectId) {
            profile.selected = false;
          }
        });
        return { rows: [] };
      }

      if (text.includes('update design_profiles') && text.includes('set selected = true')) {
        const [projectId, designId] = values;
        const profile = designProfiles.find((record) => record.project_id === projectId && record.id === designId);
        if (!profile) {
          return { rows: [] };
        }
        profile.selected = true;
        return { rows: [profile as unknown as T] };
      }

      if (text.includes('from design_profiles') && text.includes('selected = true')) {
        const [projectId] = values;
        return {
          rows: designProfiles
            .filter((profile) => profile.project_id === projectId && profile.selected === true)
            .sort((a, b) => Number(b.version) - Number(a.version))
            .slice(0, 1) as unknown as T[]
        };
      }

      if (text.includes('coalesce(max(version), 0) + 1 as next_version') && text.includes('from project_versions')) {
        const [projectId] = values;
        const latestVersion = projectVersions
          .filter((version) => version.project_id === projectId)
          .reduce((max, version) => Math.max(max, Number(version.version)), 0);
        return { rows: [{ next_version: latestVersion + 1 } as unknown as T] };
      }

      if (text.includes('insert into project_versions')) {
        const insertColumns = text.slice(text.indexOf('insert into project_versions'), text.indexOf('values'));
        const hasSpecDesignColumns = insertColumns.includes('spec_version_id') && insertColumns.includes('design_profile_id');
        const sourceIsBoundParam = text.includes('values ($1, $2, $3, $4, $5::jsonb');
        const projectId = values[0];
        const version = values[1];
        const source = sourceIsBoundParam ? values[2] : 'initial_generate';
        const summary = sourceIsBoundParam ? values[3] : values[2];
        const changedFiles = sourceIsBoundParam ? values[4] : values[3];
        const specVersionId = hasSpecDesignColumns ? values[5] : null;
        const designProfileId = hasSpecDesignColumns ? values[6] : null;
        const workspacePath = hasSpecDesignColumns ? values[7] : sourceIsBoundParam ? values[5] : values[6];
        const parentVersionId = hasSpecDesignColumns ? values[8] : sourceIsBoundParam ? values[6] : values[7];
        const row = {
          id: `project-version-${projectVersions.length + 1}`,
          project_id: projectId,
          version,
          source,
          summary,
          changed_files: parseJsonValue(changedFiles),
          spec_version_id: specVersionId,
          design_profile_id: designProfileId,
          workspace_path: workspacePath,
          parent_version_id: parentVersionId,
          created_at: iso(90 + projectVersions.length)
        };
        projectVersions.push(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('insert into project_files')) {
        const [projectId, path, content, contentHash] = values;
        const existing = projectFiles.find((file) => file.project_id === projectId && file.path === path);
        if (existing) {
          existing.content = content;
          existing.content_hash = contentHash;
          existing.version = Number(existing.version) + 1;
          existing.updated_at = iso(110);
          return { rows: [existing as unknown as T] };
        }
        const row = {
          id: `project-file-${projectFiles.length + 1}`,
          project_id: projectId,
          path,
          content,
          content_hash: contentHash,
          version: 1,
          created_at: iso(100 + projectFiles.length),
          updated_at: iso(100 + projectFiles.length)
        };
        projectFiles.push(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('insert into ai_manifests')) {
        const [projectId, projectVersionId, manifest] = values;
        aiManifests.push({
          id: `ai-manifest-${aiManifests.length + 1}`,
          project_id: projectId,
          project_version_id: projectVersionId,
          manifest_json: parseJsonValue(manifest),
          created_at: iso(120 + aiManifests.length)
        });
        return { rows: [] };
      }

      if (text.includes('update projects') && text.includes('current_project_version_id')) {
        const [projectId, projectVersionId] = values;
        const project = projects.find((existing) => existing.id === projectId);
        if (project) {
          project.current_project_version_id = projectVersionId;
          project.updated_at = iso(130);
        }
        return { rows: [] };
      }

      if (text.includes('from project_files') && text.includes('where project_id = $1 and path = $2')) {
        const [projectId, path] = values;
        const file = projectFiles.find((record) => record.project_id === projectId && record.path === path);
        return { rows: file ? [file as unknown as T] : [] };
      }

      if (text.includes('from project_files') && text.includes('order by path asc')) {
        const [projectId] = values;
        return {
          rows: projectFiles
            .filter((file) => file.project_id === projectId)
            .sort((a, b) => String(a.path).localeCompare(String(b.path))) as unknown as T[]
        };
      }

      if (text.includes('from project_versions') && text.includes('order by version desc')) {
        const [projectId] = values;
        return {
          rows: projectVersions
            .filter((version) => version.project_id === projectId)
            .sort((a, b) => Number(b.version) - Number(a.version)) as unknown as T[]
        };
      }

      if (text.includes('select coalesce(sum(estimated_cost_cny)') && !text.includes('users_count')) {
        const total = modelInvocations.reduce((sum, invocation) => sum + Number(invocation.estimated_cost_cny), 0);
        return { rows: [{ estimated_spend_cny: total } as unknown as T] };
      }

      if (text.includes('users_count') && text.includes('projects_count') && text.includes('model_calls_today')) {
        return {
          rows: [
            {
              users_count: users.length,
              projects_count: projects.length,
              app_specs_count: appSpecs.length,
              agent_runs_count: agentRuns.length,
              model_invocations_count: modelInvocations.length,
              model_calls_today: modelInvocations.filter((invocation) => invocation.status === 'succeeded').length,
              estimated_spend_cny: modelInvocations.reduce((sum, invocation) => sum + Number(invocation.estimated_cost_cny), 0)
            } as unknown as T
          ]
        };
      }

      if (text.includes('from agent_runs') && text.includes('order by updated_at desc')) {
        return { rows: agentRuns as unknown as T[] };
      }

      if (text.includes('from model_invocations') && text.includes('order by created_at desc')) {
        return { rows: modelInvocations as unknown as T[] };
      }

      return { rows: [] };
    }
  };
}

describe('createPostgresStore', () => {
  it('loads the root migration file from the default path even when the API package is cwd', async () => {
    const db = createFakeDb();

    await runPostgresMigrations(db);

    expect(db.queries[0]?.text).toContain('create table if not exists users');
    expect(db.queries[0]?.text).toContain('create table if not exists app_specs');
  });

  it('runs migrations inside an isolated application schema when configured', async () => {
    const db = createFakeDb();

    await runPostgresMigrations(db, {
      databaseSchema: 'atoms_cp'
    });

    expect(db.queries[0]?.text).toBe('create schema if not exists "atoms_cp"');
    expect(db.queries[1]?.text).toBe('set search_path to "atoms_cp", public');
    expect(db.queries[2]?.text).toContain('create table if not exists users');
  });

  it('persists projects, AppSpec versions, model calls, and Admin overview through SQL-backed storage', async () => {
    const db = createFakeDb();
    const store = createPostgresStore(db);
    const user = await store.ensureUser({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    });

    const project = await store.createProject(user, {
      name: 'Postgres M2 项目',
      prompt: '生成一个可以预约私教课程、查看教练并提交预约的 Web 应用。',
      target: 'web'
    });
    const run = await store.createAgentRun({
      projectId: project.id,
      purpose: 'app_spec_generation',
      provider: 'volcengine',
      status: 'queued',
      inputSnapshot: {
        projectName: project.name
      }
    });
    const modelInvocation = await store.createModelInvocation({
      projectId: project.id,
      agentRunId: run.id,
      provider: 'volcengine',
      model: 'doubao-seed-2-1-turbo-260628',
      purpose: 'app_spec_generation',
      status: 'succeeded',
      inputTokens: 12,
      outputTokens: 34,
      durationMs: 56,
      estimatedCostCny: 0,
      budgetLimitCny: 25
    });
    const firstSpec = await store.createAppSpec({
      projectId: project.id,
      sourceAgentRunId: run.id,
      spec: {
        appName: project.name,
        appGoal: '验证 Postgres 持久化',
        targetUser: '业务用户',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示入口',
            sections: [
              {
                id: 'hero',
                kind: 'hero',
                title: project.name,
                content: '预约私教课程'
              }
            ],
            actions: [
              {
                id: 'book',
                label: '立即预约',
                type: 'submit'
              }
            ]
          }
        ],
        dataModels: [],
        integrations: [],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: ['可以保存 AppSpec']
      }
    });
    const secondSpec = await store.createAppSpec({
      projectId: project.id,
      sourceAgentRunId: run.id,
      spec: {
        ...firstSpec.spec,
        appGoal: '验证 AppSpec 版本递增'
      }
    });

    const latestSpec = await store.getLatestAppSpec(project.id);
    const overview = await store.getAdminOverview({
      provider: 'volcengine',
      apiKeyConfigured: true,
      model: 'doubao-seed-2-1-turbo-260628',
      budgetCny: 25
    });

    expect(modelInvocation).toMatchObject({
      projectId: project.id,
      status: 'succeeded'
    });
    expect(firstSpec.version).toBe(1);
    expect(secondSpec.version).toBe(2);
    expect(latestSpec).toMatchObject({
      id: secondSpec.id,
      version: 2
    });
    expect(overview).toMatchObject({
      dataSource: 'postgres',
      usersCount: 1,
      projectsCount: 1,
      appSpecsCount: 2,
      agentRunsCount: 1,
      modelInvocationsCount: 1,
      modelProvider: 'volcengine'
    });
    expect(db.queries.some((query) => query.text.includes('insert into app_specs'))).toBe(true);
  });

  it('creates edited AppSpec versions and confirms a selected version', async () => {
    const db = createFakeDb();
    const store = createPostgresStore(db);
    const user = await store.ensureUser({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    });
    const project = await store.createProject(user, {
      name: 'Postgres Spec 编辑',
      prompt: '生成一个课程预约应用，需要首页、课程列表和预约提交。',
      target: 'web'
    });
    const run = await store.createAgentRun({
      projectId: project.id,
      purpose: 'app_spec_generation',
      provider: 'volcengine',
      status: 'queued',
      inputSnapshot: {
        projectName: project.name
      }
    });
    const initialSpec = await store.createAppSpec({
      projectId: project.id,
      sourceAgentRunId: run.id,
      spec: {
        appName: project.name,
        appGoal: '生成结构化方案',
        targetUser: '课程预约用户',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示预约入口',
            sections: [
              {
                id: 'hero',
                kind: 'hero',
                title: project.name,
                content: '查看课程并提交预约。'
              }
            ],
            actions: [
              {
                id: 'book',
                label: '立即预约',
                type: 'submit'
              }
            ]
          }
        ],
        dataModels: [],
        integrations: [],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: ['用户可以提交预约']
      }
    });

    const edited = await store.updateLatestAppSpec({
      projectId: project.id,
      spec: {
        ...initialSpec.spec,
        appGoal: '让用户完成预约并让管理员确认'
      }
    });
    const confirmed = await store.confirmAppSpec({
      projectId: project.id,
      specId: edited?.id ?? ''
    });

    expect(edited).toMatchObject({
      version: 2,
      status: 'validated',
      spec: {
        appGoal: '让用户完成预约并让管理员确认'
      }
    });
    expect(confirmed).toMatchObject({
      id: edited?.id,
      status: 'confirmed'
    });
    expect(db.queries.some((query) => query.text.includes('update app_specs'))).toBe(true);
  });

  it('persists M3 design profiles, selected design, generated files, and project versions', async () => {
    const db = createFakeDb();
    const store = createPostgresStore(db);
    const user = await store.ensureUser({
      id: 'user-creator',
      email: 'creator@example.local',
      name: 'Creator',
      role: 'creator'
    });
    const project = await store.createProject(user, {
      name: 'Postgres M3 项目',
      prompt: '生成一个可以预约私教课程的 Web 应用。',
      target: 'web'
    });
    const run = await store.createAgentRun({
      projectId: project.id,
      purpose: 'app_spec_generation',
      provider: 'volcengine',
      status: 'queued',
      inputSnapshot: {
        projectName: project.name
      }
    });
    const appSpec = await store.createAppSpec({
      projectId: project.id,
      sourceAgentRunId: run.id,
      spec: {
        appName: project.name,
        appGoal: '让用户提交私教预约',
        targetUser: '健身会员',
        pages: [
          {
            id: 'home',
            name: '首页',
            route: '/',
            purpose: '展示预约入口',
            sections: [
              {
                id: 'hero',
                kind: 'hero',
                title: '预约你的下一节私教课',
                content: '查看教练和课程。'
              }
            ],
            actions: [
              {
                id: 'book',
                label: '立即预约',
                type: 'submit'
              }
            ]
          }
        ],
        dataModels: [],
        integrations: [],
        styleIntent: {
          tone: 'calm',
          layoutDensity: 'comfortable'
        },
        constraints: [],
        nonGoals: [],
        acceptanceCriteria: ['用户可以提交预约']
      }
    });
    const [design] = await store.createDesignProfiles({
      projectId: project.id,
      specVersionId: appSpec.id,
      profiles: [
        {
          id: 'studio-minimal',
          name: 'Studio Minimal',
          description: 'A quiet service-product layout.',
          bestFor: 'Service booking flows.',
          designTokens: {
            colors: {
              background: '#f7f8f6',
              foreground: '#18201f',
              primary: '#1e6f62',
              secondary: '#dfe8e4',
              muted: '#65716e',
              border: '#dce4e0',
              accent: '#b96f4a'
            },
            typography: {
              headingFont: 'Inter',
              bodyFont: 'Inter',
              scale: 'comfortable'
            },
            radius: 'md',
            shadow: 'subtle',
            density: 'balanced'
          },
          layoutGuidelines: ['Lead with one clear action.'],
          componentGuidelines: ['Use restrained cards.'],
          previewDescription: 'A restrained service landing experience.'
        }
      ]
    });

    expect(design).toBeDefined();
    const selected = await store.selectDesignProfile(project.id, design!.id);
    const saved = await store.saveGeneratedProject({
      projectId: project.id,
      specVersionId: appSpec.id,
      designProfileId: selected?.id,
      summary: 'Generated React/Vite files.',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-1',
      files: [
        {
          path: 'src/App.tsx',
          content: '<main data-ai-id="home.hero.title">预约你的下一节私教课</main>',
          purpose: 'Generated application UI.'
        },
        {
          path: 'ai-manifest.json',
          content: '{"entries":{"home.hero.title":{"aiId":"home.hero.title","file":"src/App.tsx","component":"GeneratedSection","elementType":"heading","editable":["text"]}}}',
          purpose: 'AI manifest.'
        }
      ],
      manifest: {
        entries: {
          'home.hero.title': {
            aiId: 'home.hero.title',
            file: 'src/App.tsx',
            component: 'GeneratedSection',
            elementType: 'heading',
            editable: ['text']
          }
        }
      }
    });
    const files = await store.listProjectFiles(project.id);
    const appFile = await store.getProjectFile(project.id, 'src/App.tsx');
    const patch = await store.saveProjectFilePatch({
      projectId: project.id,
      source: 'selector_edit',
      summary: 'Updated hero title.',
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-2',
      parentVersionId: saved.projectVersion.id,
      files: [
        {
          path: 'src/App.tsx',
          content: '<main data-ai-id="home.hero.title">升级你的训练计划</main>',
          purpose: 'Selector patch.'
        }
      ]
    });
    const versions = await store.listProjectVersions(project.id);

    expect(selected).toMatchObject({
      id: design?.id,
      selected: true
    });
    expect(saved.projectVersion).toMatchObject({
      projectId: project.id,
      version: 1,
      source: 'initial_generate',
      changedFiles: ['src/App.tsx', 'ai-manifest.json'],
      specVersionId: appSpec.id,
      designProfileId: selected?.id,
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-1'
    });
    expect(patch.projectVersion).toMatchObject({
      projectId: project.id,
      version: 2,
      source: 'selector_edit',
      changedFiles: ['src/App.tsx'],
      workspacePath: '/tmp/atoms-cp-workspaces/project-1/version-2',
      parentVersionId: saved.projectVersion.id
    });
    expect(versions.map((version) => version.id)).toEqual([patch.projectVersion.id, saved.projectVersion.id]);
    expect(files.map((file) => file.path)).toEqual(['ai-manifest.json', 'src/App.tsx']);
    expect(appFile?.content).toContain('data-ai-id="home.hero.title"');
    expect(
      db.queries.find((query) => query.text.includes('insert into project_versions'))?.values[4]
    ).toBe(JSON.stringify(['src/App.tsx', 'ai-manifest.json']));
    expect(db.queries.some((query) => query.text.includes('$3::jsonb'))).toBe(true);
    expect(db.queries.some((query) => query.text.includes('$4::jsonb'))).toBe(true);
  });
});

function createRuntimeFakeDb(): Queryable & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const workspaces: Row[] = [];
  const codexTasks: Row[] = [];
  const buildJobs: Row[] = [];
  const previewSnapshots: Row[] = [];
  const traceEvents: Row[] = [];

  return {
    queries,
    async query<T extends Row = Row>(text: string, values: readonly unknown[] = []) {
      queries.push({ text, values });

      if (text.includes('insert into workspaces')) {
        const [projectId, projectVersionId, path, status] = values;
        const row = {
          id: `workspace-${workspaces.length + 1}`,
          project_id: projectId,
          project_version_id: projectVersionId,
          path,
          status,
          locked_by: null,
          error_summary: null,
          created_at: iso(workspaces.length + 1),
          updated_at: iso(workspaces.length + 1)
        };
        workspaces.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('from workspaces') && text.includes('where project_id = $1')) {
        const [projectId] = values;
        return { rows: workspaces.filter((workspace) => workspace.project_id === projectId) as unknown as T[] };
      }

      if (text.includes('from workspaces') && text.includes('where id = $1')) {
        const [workspaceId] = values;
        return { rows: workspaces.filter((workspace) => workspace.id === workspaceId) as unknown as T[] };
      }

      if (text.includes("set status = 'locked'")) {
        const [workspaceId, lockedBy] = values;
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspace) {
          return { rows: [] };
        }
        workspace.status = 'locked';
        workspace.locked_by = lockedBy;
        workspace.updated_at = iso(20);
        return { rows: [workspace as unknown as T] };
      }

      if (text.includes("set status = 'ready'")) {
        const [workspaceId] = values;
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspace) {
          return { rows: [] };
        }
        workspace.status = 'ready';
        workspace.locked_by = null;
        workspace.updated_at = iso(21);
        return { rows: [workspace as unknown as T] };
      }

      if (text.includes('update workspaces') && text.includes('project_version_id = coalesce')) {
        const [workspaceId, projectVersionId, path, status, lockedBy, errorSummary] = values;
        const workspace = workspaces.find((item) => item.id === workspaceId);
        if (!workspace) {
          return { rows: [] };
        }
        workspace.project_version_id = projectVersionId ?? workspace.project_version_id;
        workspace.path = path ?? workspace.path;
        workspace.status = status ?? workspace.status;
        workspace.locked_by = lockedBy ?? workspace.locked_by;
        workspace.error_summary = errorSummary ?? workspace.error_summary;
        workspace.updated_at = iso(22);
        return { rows: [workspace as unknown as T] };
      }

      if (text.includes('insert into codex_tasks')) {
        const [
          projectId,
          projectVersionId,
          workspaceId,
          taskType,
          objective,
          inputSummary,
          taskSpec,
          allowedPaths,
          forbiddenPaths,
          validationCommands
        ] = values;
        const row = {
          id: `codex-task-${codexTasks.length + 1}`,
          project_id: projectId,
          project_version_id: projectVersionId,
          workspace_id: workspaceId,
          task_type: taskType,
          status: 'queued',
          objective,
          input_summary: inputSummary,
          task_spec: parseJsonValue<Record<string, unknown>>(taskSpec),
          allowed_paths: parseJsonValue<string[]>(allowedPaths),
          forbidden_paths: parseJsonValue<string[]>(forbiddenPaths),
          validation_commands: parseJsonValue<string[]>(validationCommands),
          attempt_count: 0,
          claimed_by: null,
          claimed_at: null,
          result_summary: null,
          error_summary: null,
          finished_at: null,
          created_at: iso(30 + codexTasks.length),
          updated_at: iso(30 + codexTasks.length)
        };
        codexTasks.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('from codex_tasks') && text.includes('where project_id = $1')) {
        const [projectId] = values;
        return { rows: codexTasks.filter((task) => task.project_id === projectId) as unknown as T[] };
      }

      if (text.includes('from codex_tasks') && text.includes('where id = $1')) {
        const [taskId] = values;
        return { rows: codexTasks.filter((task) => task.id === taskId) as unknown as T[] };
      }

      if (text.includes('update codex_tasks') && text.includes("status = 'claimed'")) {
        const [workerId] = values;
        const activeStatuses = new Set(['claimed', 'preparing_workspace', 'codex_running', 'validating', 'running']);
        const requestedTaskId = text.includes('candidate.id = $2') ? values[1] : undefined;
        const task = [...codexTasks].reverse().find((item) => (
          item.status === 'queued' &&
          (!requestedTaskId || item.id === requestedTaskId) &&
          !codexTasks.some((candidate) => (
            candidate.project_id === item.project_id &&
            candidate.id !== item.id &&
            activeStatuses.has(String(candidate.status))
          ))
        ));
        if (!task) {
          return { rows: [] };
        }
        task.status = 'claimed';
        task.claimed_by = workerId;
        task.claimed_at = iso(40);
        task.attempt_count = Number(task.attempt_count ?? 0) + 1;
        task.updated_at = iso(40);
        return { rows: [task as unknown as T] };
      }

      if (text.includes('update codex_tasks') && text.includes('result_summary = coalesce')) {
        const [
          taskId,
          status,
          workspaceId,
          projectVersionId,
          claimedBy,
          taskSpec,
          attemptCount,
          resultSummary,
          errorSummary,
          finishedAt
        ] = values;
        const task = codexTasks.find((item) => item.id === taskId);
        if (!task) {
          return { rows: [] };
        }
        task.status = status ?? task.status;
        task.workspace_id = workspaceId ?? task.workspace_id;
        task.project_version_id = projectVersionId ?? task.project_version_id;
        task.claimed_by = claimedBy ?? task.claimed_by;
        task.task_spec = taskSpec ? parseJsonValue<Record<string, unknown>>(taskSpec) : task.task_spec;
        task.attempt_count = attemptCount ?? task.attempt_count;
        task.result_summary = resultSummary ?? task.result_summary;
        task.error_summary = errorSummary ?? task.error_summary;
        task.finished_at = finishedAt ?? task.finished_at;
        task.updated_at = iso(41);
        return { rows: [task as unknown as T] };
      }

      if (text.includes('from codex_tasks') && text.includes('updated_at < $1')) {
        const [cutoffIso, limit] = values;
        return {
          rows: codexTasks
            .filter((task) => (
              ['claimed', 'preparing_workspace', 'codex_running', 'validating', 'running'].includes(String(task.status)) &&
              String(task.updated_at) < String(cutoffIso)
            ))
            .slice(0, Number(limit)) as unknown as T[]
        };
      }

      if (text.includes('insert into build_jobs')) {
        const [projectId, projectVersionId] = values;
        const row = {
          id: `build-job-${buildJobs.length + 1}`,
          project_id: projectId,
          project_version_id: projectVersionId,
          status: 'queued',
          command: null,
          preview_url: null,
          error_summary: null,
          started_at: null,
          finished_at: null,
          created_at: iso(45 + buildJobs.length)
        };
        buildJobs.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('from build_jobs') && text.includes('where project_id = $1 and id = $2')) {
        const [projectId, buildJobId] = values;
        return { rows: buildJobs.filter((job) => job.project_id === projectId && job.id === buildJobId) as unknown as T[] };
      }

      if (text.includes('update build_jobs') && text.includes('error_summary = coalesce')) {
        const [buildJobId, status, command, previewUrl, errorSummary, startedAt, finishedAt] = values;
        const buildJob = buildJobs.find((job) => job.id === buildJobId);
        if (!buildJob) {
          return { rows: [] };
        }
        buildJob.status = status ?? buildJob.status;
        buildJob.command = command ?? buildJob.command;
        buildJob.preview_url = previewUrl ?? buildJob.preview_url;
        buildJob.error_summary = errorSummary ?? buildJob.error_summary;
        buildJob.started_at = startedAt ?? buildJob.started_at;
        buildJob.finished_at = finishedAt ?? buildJob.finished_at;
        return { rows: [buildJob as unknown as T] };
      }

      if (text.includes('from build_jobs') && text.includes('coalesce(started_at, created_at) < $1')) {
        const [cutoffIso, limit] = values;
        return {
          rows: buildJobs
            .filter((job) => (
              ['queued', 'running'].includes(String(job.status)) &&
              String(job.started_at ?? job.created_at) < String(cutoffIso)
            ))
            .slice(0, Number(limit)) as unknown as T[]
        };
      }

      if (text.includes('insert into preview_snapshots')) {
        const [projectId, projectVersionId, buildJobId, status, path, url, active, errorSummary] = values;
        const row = {
          id: `preview-snapshot-${previewSnapshots.length + 1}`,
          project_id: projectId,
          project_version_id: projectVersionId,
          build_job_id: buildJobId,
          status,
          path,
          url,
          active,
          error_summary: errorSummary,
          created_at: iso(50 + previewSnapshots.length),
          updated_at: iso(50 + previewSnapshots.length)
        };
        previewSnapshots.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('update preview_snapshots set active = false')) {
        const [projectId] = values;
        previewSnapshots
          .filter((snapshot) => snapshot.project_id === projectId)
          .forEach((snapshot) => {
            snapshot.active = false;
            snapshot.updated_at = iso(59);
          });
        return { rows: [] };
      }

      if (text.includes('from preview_snapshots') && text.includes('where project_id = $1')) {
        const [projectId] = values;
        return { rows: previewSnapshots.filter((snapshot) => snapshot.project_id === projectId) as unknown as T[] };
      }

      if (text.includes('from preview_snapshots') && text.includes('where id = $1')) {
        const [snapshotId] = values;
        return { rows: previewSnapshots.filter((snapshot) => snapshot.id === snapshotId) as unknown as T[] };
      }

      if (text.includes('update preview_snapshots') && text.includes('set active = true')) {
        const [snapshotId] = values;
        const snapshot = previewSnapshots.find((item) => item.id === snapshotId);
        if (!snapshot) {
          return { rows: [] };
        }
        snapshot.active = true;
        snapshot.updated_at = iso(60);
        return { rows: [snapshot as unknown as T] };
      }

      if (text.includes('insert into trace_events')) {
        const [projectId, agentRunId, codexTaskId, buildJobId, type, visibility, message, payload] = values;
        const row = {
          id: `trace-event-${traceEvents.length + 1}`,
          project_id: projectId,
          agent_run_id: agentRunId,
          codex_task_id: codexTaskId,
          build_job_id: buildJobId,
          type,
          visibility,
          message,
          payload: parseJsonValue<Record<string, unknown>>(payload),
          created_at: iso(70 + traceEvents.length)
        };
        traceEvents.unshift(row);
        return { rows: [row as unknown as T] };
      }

      if (text.includes('from trace_events') && text.includes('where project_id = $1')) {
        const [projectId] = values;
        return { rows: traceEvents.filter((event) => event.project_id === projectId) as unknown as T[] };
      }

      if (text.includes('from codex_tasks') && text.includes('order by created_at desc')) {
        return { rows: codexTasks as unknown as T[] };
      }

      if (text.includes('from preview_snapshots') && text.includes('order by created_at desc')) {
        return { rows: previewSnapshots as unknown as T[] };
      }

      if (text.includes('from trace_events') && text.includes('order by created_at desc')) {
        return { rows: traceEvents as unknown as T[] };
      }

      return { rows: [] };
    }
  };
}

describe('createPostgresStore runtime artifacts', () => {
  it('creates, lists, updates, and claims runtime artifacts through SQL-backed methods', async () => {
    const db = createRuntimeFakeDb();
    const store = createPostgresStore(db);
    const workspace = await store.createWorkspace({
      projectId: 'project-1',
      path: '/tmp/atoms-cp-workspaces/project-1/main',
      status: 'ready'
    });
    const task = await store.createCodexTask({
      projectId: 'project-1',
      workspaceId: workspace.id,
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured summary',
      allowedPaths: ['src/**'],
      forbiddenPaths: ['.env'],
      validationCommands: ['pnpm build']
    });

    expect(await store.listWorkspaces('project-1')).toHaveLength(1);
    expect((await store.lockWorkspace(workspace.id, 'worker-1'))?.status).toBe('locked');
    expect((await store.unlockWorkspace(workspace.id))?.lockedBy).toBeUndefined();
    expect((await store.updateWorkspace(workspace.id, { status: 'failed', errorSummary: 'disk full' }))?.errorSummary).toBe('disk full');
    expect(await store.listCodexTasks('project-1')).toHaveLength(1);
    expect((await store.claimNextCodexTask('worker-1'))?.id).toBe(task.id);
    expect((await store.updateCodexTask(task.id, { status: 'succeeded', resultSummary: 'done' }))?.status).toBe('succeeded');
    expect(await store.listRecentCodexTasks(5)).toHaveLength(1);
  });

  it('claims a specific queued Codex task through SQL-backed methods', async () => {
    const db = createRuntimeFakeDb();
    const store = createPostgresStore(db);
    const normal = await store.createCodexTask({
      projectId: 'project-normal',
      taskType: 'initial_generate',
      objective: 'Normal user task',
      inputSummary: 'Normal queued work',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const canary = await store.createCodexTask({
      projectId: 'project-canary',
      taskType: 'initial_generate',
      objective: '[real-canary] Staging task',
      inputSummary: '[real-canary] Internal staging canary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    const claimed = await store.claimCodexTask(canary.id, 'real-canary-worker');

    expect(claimed?.id).toBe(canary.id);
    expect((await store.getCodexTask(canary.id))?.status).toBe('claimed');
    expect((await store.getCodexTask(normal.id))?.status).toBe('queued');
  });

  it('claims only queued Codex tasks whose project has no active writer', async () => {
    const db = createRuntimeFakeDb();
    const store = createPostgresStore(db);
    const firstProjectTask = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'initial_generate',
      objective: 'Create first app shell',
      inputSummary: 'First structured summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const blockedProjectTask = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'code_edit',
      objective: 'Edit first app shell',
      inputSummary: 'Second structured summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    const otherProjectTask = await store.createCodexTask({
      projectId: 'project-2',
      taskType: 'initial_generate',
      objective: 'Create second app shell',
      inputSummary: 'Other project summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });

    expect((await store.claimNextCodexTask('worker-1'))?.id).toBe(firstProjectTask.id);
    expect((await store.claimNextCodexTask('worker-2'))?.id).toBe(otherProjectTask.id);

    await store.updateCodexTask(firstProjectTask.id, {
      status: 'succeeded',
      resultSummary: 'Generated first shell'
    });

    expect((await store.claimNextCodexTask('worker-3'))?.id).toBe(blockedProjectTask.id);
    expect(db.queries.some((query) => query.text.includes('not exists') && query.text.includes('active.project_id'))).toBe(true);
  });

  it('lists stale runtime records through SQL cutoff queries', async () => {
    const db = createRuntimeFakeDb();
    const store = createPostgresStore(db);
    const task = await store.createCodexTask({
      projectId: 'project-1',
      taskType: 'initial_generate',
      objective: 'Create app shell',
      inputSummary: 'Structured summary',
      allowedPaths: ['src/**'],
      validationCommands: ['pnpm build']
    });
    await store.claimNextCodexTask('worker-1');
    const buildJob = await store.createBuildJob('project-1', {});
    await store.updateBuildJob(buildJob.id, {
      status: 'running',
      startedAt: iso(40)
    });

    expect(await store.listStaleCodexTasks(iso(45), 10)).toEqual([
      expect.objectContaining({
        id: task.id,
        status: 'claimed'
      })
    ]);
    expect(await store.listStaleBuildJobs(iso(45), 10)).toEqual([
      expect.objectContaining({
        id: buildJob.id,
        status: 'running'
      })
    ]);
    expect(db.queries.some((query) => query.text.includes('from codex_tasks') && query.text.includes('updated_at < $1'))).toBe(true);
    expect(db.queries.some((query) => query.text.includes('from build_jobs') && query.text.includes('coalesce(started_at, created_at) < $1'))).toBe(true);
  });

  it('creates and activates preview snapshots and records trace events', async () => {
    const db = createRuntimeFakeDb();
    const store = createPostgresStore(db);
    const first = await store.createPreviewSnapshot({
      projectId: 'project-1',
      projectVersionId: 'version-1',
      status: 'ready',
      path: '/tmp/atoms-cp-previews/project-1/v1',
      url: 'https://preview.example.test/v1',
      active: true
    });
    const second = await store.createPreviewSnapshot({
      projectId: 'project-1',
      projectVersionId: 'version-2',
      status: 'ready',
      path: '/tmp/atoms-cp-previews/project-1/v2',
      url: 'https://preview.example.test/v2'
    });
    const active = await store.activatePreviewSnapshot(second.id);
    const event = await store.appendTraceEvent({
      projectId: 'project-1',
      type: 'preview_snapshot_created',
      visibility: 'admin',
      message: 'Snapshot created',
      payload: {
        snapshotId: second.id
      }
    });

    expect(first.active).toBe(true);
    expect(active?.active).toBe(true);
    expect(await store.listPreviewSnapshots('project-1')).toHaveLength(2);
    expect(await store.getLatestPreviewSnapshot('project-1')).toBeDefined();
    expect(await store.listTraceEvents('project-1', 5)).toEqual([event]);
    expect(await store.listRecentPreviewSnapshots(5)).toHaveLength(2);
    expect(await store.listRecentTraceEvents(5)).toHaveLength(1);
  });
});
