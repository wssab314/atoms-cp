import {
  type AiManifest,
  type AppSpec,
  type AppSpecAction,
  type AppSpecPage,
  type AppSpecSection,
  type CodegenOutput,
  type DesignProfile,
  type GeneratedFile
} from '@atoms-cp/shared';

export interface GenerateReactViteInput {
  appSpec: AppSpec;
  designProfile: DesignProfile;
  projectName: string;
  supabaseConfig?: {
    supabaseUrl: string;
    anonKey: string;
  };
}

const safeStaticPaths = new Set(['package.json', 'pnpm-workspace.yaml', 'index.html', 'tsconfig.json', 'vite.config.ts', 'ai-manifest.json']);

export function createDefaultDesignProfiles(appSpec: AppSpec): DesignProfile[] {
  const primary = appSpec.styleIntent.primaryColor ?? '#1e6f62';
  const scale = appSpec.styleIntent.layoutDensity;
  const profiles: DesignProfile[] = [
    {
      id: 'quiet-personal',
      name: 'Quiet Personal',
      description: `A calm personal presence for ${appSpec.appName}.`,
      bestFor: 'Personal websites, portfolios, resumes, and independent creator profiles.',
      designTokens: {
        colors: {
          background: '#f8f8f6',
          foreground: '#171a1f',
          primary,
          secondary: '#eef3ff',
          muted: '#667085',
          border: '#e7e8ec',
          accent: '#315cf6'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale
        },
        radius: 'lg',
        shadow: 'subtle',
        density: 'balanced'
      },
      layoutGuidelines: ['Lead with identity, role, and a concise proof point.', 'Keep sections editorial, scannable, and easy to personalize.'],
      componentGuidelines: ['Use project cards and timeline rows for personal evidence.', 'Keep contact actions clear without turning the page into a form-heavy app.'],
      previewDescription: 'A quiet personal website pattern with a strong first impression and portfolio-ready sections.'
    },
    {
      id: 'studio-minimal',
      name: 'Studio Minimal',
      description: `A quiet service-product layout for ${appSpec.appName}.`,
      bestFor: 'Service booking, expert profiles, and trust-led conversion flows.',
      designTokens: {
        colors: {
          background: '#f7f8f6',
          foreground: '#18201f',
          primary,
          secondary: '#dfe8e4',
          muted: '#65716e',
          border: '#dce4e0',
          accent: '#b96f4a'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale
        },
        radius: 'md',
        shadow: 'subtle',
        density: 'balanced'
      },
      layoutGuidelines: ['Lead with the result and one clear primary action.', 'Keep page sections spacious and easy to scan.'],
      componentGuidelines: ['Use restrained cards for repeated items.', 'Use status chips only for real state.'],
      previewDescription: 'A restrained service landing experience with clear conversion flow.'
    },
    {
      id: 'product-launch',
      name: 'Product Launch',
      description: `A focused product launch surface for ${appSpec.appName}.`,
      bestFor: 'Product websites, SaaS waitlists, launch pages, and event sign-up flows.',
      designTokens: {
        colors: {
          background: '#f8f8f6',
          foreground: '#161a22',
          primary: '#315cf6',
          secondary: '#eef3ff',
          muted: '#667085',
          border: '#e7e8ec',
          accent: '#20b26b'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale: 'comfortable'
        },
        radius: 'lg',
        shadow: 'subtle',
        density: 'balanced'
      },
      layoutGuidelines: ['Make the offer and activation path visible in the first viewport.', 'Use short proof sections before asking for conversion.'],
      componentGuidelines: ['Use feature cards, comparison rows, and short setup checklists.', 'Keep primary actions singular and repeated only at natural decision points.'],
      previewDescription: 'A result-first launch page for presenting a product and converting interest.'
    },
    {
      id: 'operator-dashboard',
      name: 'Operator Dashboard',
      description: `A dense operational view for managing ${appSpec.appName}.`,
      bestFor: 'Admin workflows, data-heavy dashboards, and repeated operational tasks.',
      designTokens: {
        colors: {
          background: '#f6f7f8',
          foreground: '#171b1d',
          primary: '#2f5f9f',
          secondary: '#e6ebf2',
          muted: '#68717a',
          border: '#d8dee6',
          accent: '#6c8a3f'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale: 'compact'
        },
        radius: 'sm',
        shadow: 'none',
        density: 'compact'
      },
      layoutGuidelines: ['Prioritize tables, filters, and compact summary panels.', 'Keep controls close to the data they affect.'],
      componentGuidelines: ['Use quiet borders over decorative shadows.', 'Prefer explicit labels for operational state.'],
      previewDescription: 'A focused management console for operational users.'
    },
    {
      id: 'content-hub',
      name: 'Content Hub',
      description: `A structured reading and resource hub for ${appSpec.appName}.`,
      bestFor: 'Blogs, knowledge bases, resource centers, publication pages, and learning hubs.',
      designTokens: {
        colors: {
          background: '#faf9f6',
          foreground: '#1d1c19',
          primary: '#4f46e5',
          secondary: '#eeecff',
          muted: '#6f6a63',
          border: '#e7e1d8',
          accent: '#c26a2e'
        },
        typography: {
          headingFont: 'Inter',
          bodyFont: 'Inter',
          scale: 'spacious'
        },
        radius: 'md',
        shadow: 'subtle',
        density: 'airy'
      },
      layoutGuidelines: ['Give readers strong hierarchy, categories, and a clear next article/resource path.', 'Use generous line length and calm metadata treatment.'],
      componentGuidelines: ['Use article cards, category tabs, and resource lists.', 'Keep subscription/contact modules secondary to the reading experience.'],
      previewDescription: 'A calm content system for publishing, browsing, and organizing resources.'
    }
  ];

  return profiles
    .map((profile, index) => ({
      profile,
      index,
      score: designProfileMatchScore(profile.id, appSpec)
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map((item) => item.profile);
}

function designProfileMatchScore(profileId: string, appSpec: AppSpec): number {
  const text = [
    appSpec.appName,
    appSpec.appGoal,
    appSpec.targetUser,
    ...appSpec.pages.flatMap((page) => [
      page.name,
      page.purpose,
      ...page.sections.flatMap((section) => [section.title, section.content]),
      ...page.actions.map((action) => action.label)
    ]),
    ...appSpec.dataModels.map((model) => model.name),
    ...appSpec.acceptanceCriteria
  ].join(' ').toLowerCase();
  const keywordMap: Record<string, string[]> = {
    'quiet-personal': ['个人', '作品', 'portfolio', '简历', '履历', '主页', '博客', '创作者'],
    'studio-minimal': ['预约', '服务', '咨询', '工作室', '专家', '教练', '课程'],
    'product-launch': ['产品', 'saas', '官网', '发布', '报名', '活动', 'waitlist'],
    'operator-dashboard': ['管理', '看板', 'dashboard', '数据', '后台', '运营', '记录'],
    'content-hub': ['博客', '文章', '知识', '资源', '内容', '文档', '学习']
  };

  return (keywordMap[profileId] ?? []).reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}

export function generateReactViteProject(input: GenerateReactViteInput): CodegenOutput {
  const manifest = buildManifest(input.appSpec);
  const hasSupabase = Boolean(input.supabaseConfig);
  const files: GeneratedFile[] = [
    {
      path: 'package.json',
      content: renderPackageJson(input.projectName, {
        includeSupabase: hasSupabase
      }),
      purpose: 'Package manifest for the generated React/Vite app.'
    },
    {
      path: 'pnpm-workspace.yaml',
      content: renderPnpmWorkspace(),
      purpose: 'pnpm build-script allowlist for isolated worker installs.'
    },
    {
      path: 'index.html',
      content: renderIndexHtml(input.appSpec.appName),
      purpose: 'Vite HTML entrypoint.'
    },
    {
      path: 'tsconfig.json',
      content: renderTsConfig(),
      purpose: 'TypeScript configuration for React/Vite build.'
    },
    {
      path: 'vite.config.ts',
      content: renderViteConfig(),
      purpose: 'Vite build configuration.'
    },
    {
      path: 'src/main.tsx',
      content: renderMainTsx(),
      purpose: 'React application mount.'
    },
    ...(
      hasSupabase
        ? [
            {
              path: 'src/vite-env.d.ts',
              content: renderViteEnv(),
              purpose: 'Vite client environment typing for public Supabase variables.'
            },
            {
              path: 'src/lib/supabase.ts',
              content: renderSupabaseClient(),
              purpose: 'Browser Supabase client configured only from public Vite environment variables.'
            }
          ]
        : []
    ),
    {
      path: 'src/preview-inspector.ts',
      content: renderPreviewInspector(),
      purpose: 'Preview inspector runtime for selector patch workflows.'
    },
    {
      path: 'src/App.tsx',
      content: renderAppTsx(input.appSpec, input.designProfile),
      purpose: 'Generated application UI from the confirmed AppSpec.'
    },
    {
      path: 'src/styles.css',
      content: renderStyles(input.designProfile),
      purpose: 'Design-token-driven stylesheet for the generated app.'
    },
    {
      path: 'ai-manifest.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      purpose: 'Editable element manifest used by selector patch workflows.'
    }
  ];

  files.forEach((file) => assertAllowedGeneratedPath(file.path));

  return {
    summary: `Generated ${files.length} React/Vite files for ${input.appSpec.appName}.`,
    files,
    manifest,
    installCommand: 'pnpm install',
    buildCommand: 'pnpm build',
    warnings: [
      ...(input.appSpec.integrations.length > 0 ? ['Integrations are represented as UI placeholders in M3.'] : []),
      ...(hasSupabase ? ['Supabase service role keys are never generated into frontend files. Configure Vite public env at deploy time.'] : [])
    ]
  };
}

export function createEmptyGeneratedProject(): CodegenOutput {
  return {
    files: [
      {
        path: 'ai-manifest.json',
        content: '{"entries":{}}\n',
        purpose: 'Empty AI manifest placeholder.'
      }
    ],
    manifest: {
      entries: {}
    },
    summary: 'Code generation scaffold is ready.',
    installCommand: 'pnpm install',
    buildCommand: 'pnpm build',
    warnings: []
  };
}

function buildManifest(appSpec: AppSpec): AiManifest {
  const entries: AiManifest['entries'] = {};

  appSpec.pages.forEach((page) => {
    page.sections.forEach((section) => {
      const sectionId = aiId(page.id, section.id);
      entries[sectionId] = {
        aiId: sectionId,
        file: 'src/App.tsx',
        component: 'GeneratedSection',
        elementType: 'section',
        editable: ['className', 'styleTokens']
      };
      entries[aiId(page.id, section.id, 'title')] = {
        aiId: aiId(page.id, section.id, 'title'),
        file: 'src/App.tsx',
        component: 'GeneratedSection',
        elementType: 'heading',
        editable: ['text', 'className', 'styleTokens']
      };
      entries[aiId(page.id, section.id, 'content')] = {
        aiId: aiId(page.id, section.id, 'content'),
        file: 'src/App.tsx',
        component: 'GeneratedSection',
        elementType: 'text',
        editable: ['text', 'className', 'styleTokens']
      };
    });

    page.actions.forEach((action) => {
      const actionId = aiId(page.id, 'actions', action.id);
      entries[actionId] = {
        aiId: actionId,
        file: 'src/App.tsx',
        component: 'GeneratedAction',
        elementType: 'button',
        editable: ['text', 'className', 'styleTokens', 'props']
      };
    });
  });

  return { entries };
}

function renderPackageJson(projectName: string, options: { includeSupabase?: boolean } = {}): string {
  return `${JSON.stringify({
    scripts: {
      dev: 'vite',
      build: 'tsc -b && vite build',
      preview: 'vite preview'
    },
    dependencies: {
      '@vitejs/plugin-react': '^4.6.0',
      ...(options.includeSupabase ? { '@supabase/supabase-js': '^2.50.0' } : {}),
      typescript: '^5.7.2',
      vite: '^5.4.21',
      react: '^19.1.1',
      'react-dom': '^19.1.1'
    },
    devDependencies: {
      '@types/react': '^19.0.2',
      '@types/react-dom': '^19.0.2'
    },
    private: true,
    name: toPackageName(projectName),
    version: '0.0.0',
    type: 'module',
    packageManager: 'pnpm@11.7.0'
  }, null, 2)}\n`;
}

function renderPnpmWorkspace(): string {
  return `allowBuilds:
  esbuild: true
`;
}

function renderViteEnv(): string {
  return `/// <reference types="vite/client" />
`;
}

function renderSupabaseClient(): string {
  return `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnvReady = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = supabaseEnvReady
  ? createClient(supabaseUrl, supabaseAnonKey)
  : undefined;
`;
}

function renderIndexHtml(appName: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(appName)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function renderTsConfig(): string {
  return `${JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx'
    },
    include: ['src'],
    references: []
  }, null, 2)}\n`;
}

function renderViteConfig(): string {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()]
});
`;
}

function renderMainTsx(): string {
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './preview-inspector';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function renderPreviewInspector(): string {
  return `type InspectorCommand =
  | { type: 'INSPECTOR_ENABLE' }
  | { type: 'INSPECTOR_DISABLE' }
  | { type: 'INSPECTOR_HIGHLIGHT'; aiId: string };

type PreviewElementMessage = {
  type: 'atoms-cp:preview-element-selected' | 'atoms-cp:preview-element-hovered';
  event: 'INSPECTOR_SELECT' | 'INSPECTOR_HOVER';
  aiId: string;
  text?: string;
  className?: string;
  tagName: string;
};

let inspectorEnabled = new URL(window.location.href).searchParams.get('inspector') === '1';
let highlightedElement: HTMLElement | null = null;

function isInspectorEnabled(): boolean {
  return inspectorEnabled;
}

function closestEditableElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>('[data-ai-id]') : null;
}

function readableElementText(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return undefined;
  }

  const text = element.textContent?.trim();
  return text ? text.slice(0, 500) : undefined;
}

function messageForElement(element: HTMLElement, event: PreviewElementMessage['event']): PreviewElementMessage {
  return {
    type: event === 'INSPECTOR_SELECT' ? 'atoms-cp:preview-element-selected' : 'atoms-cp:preview-element-hovered',
    event,
    aiId: element.dataset.aiId ?? '',
    text: readableElementText(element),
    className: typeof element.className === 'string' ? element.className.slice(0, 500) : undefined,
    tagName: element.tagName
  };
}

function setHighlight(element: HTMLElement | null): void {
  if (highlightedElement) {
    highlightedElement.style.outline = '';
    highlightedElement.style.outlineOffset = '';
  }

  highlightedElement = element;

  if (highlightedElement) {
    highlightedElement.style.outline = '2px solid #315CF6';
    highlightedElement.style.outlineOffset = '3px';
  }
}

window.addEventListener('message', (event) => {
  const command = event.data as Partial<InspectorCommand>;

  if (command?.type === 'INSPECTOR_ENABLE') {
    inspectorEnabled = true;
    return;
  }

  if (command?.type === 'INSPECTOR_DISABLE') {
    inspectorEnabled = false;
    setHighlight(null);
    return;
  }

  if (command?.type === 'INSPECTOR_HIGHLIGHT') {
    setHighlight(document.querySelector<HTMLElement>(\`[data-ai-id="\${CSS.escape(command.aiId ?? '')}"]\`));
  }
});

document.addEventListener(
  'pointerover',
  (event) => {
    if (!isInspectorEnabled()) {
      return;
    }

    const element = closestEditableElement(event.target);

    if (!element) {
      return;
    }

    setHighlight(element);
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_HOVER'), '*');
  },
  true
);

document.addEventListener(
  'click',
  (event) => {
    if (!isInspectorEnabled()) {
      return;
    }

    const element = closestEditableElement(event.target);

    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_SELECT'), '*');
  },
  true
);
`;
}

function renderAppTsx(appSpec: AppSpec, designProfile: DesignProfile): string {
  const pageBlocks = appSpec.pages.map(renderPage).join('\n\n');
  const models = appSpec.dataModels.map((model) => `${model.name}: ${model.fields.map((field) => field.name).join(', ')}`).join(' | ');
  const acceptance = appSpec.acceptanceCriteria.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n              ');

  return `export function App() {
  return (
    <main className="app-shell" data-ai-id="app.root">
      <header className="topbar">
        <span className="brand-pill">${escapeHtml(designProfile.name)}</span>
        <strong>${jsxString(appSpec.appName)}</strong>
      </header>
      <section className="hero" data-ai-id="app.hero">
        <div>
          <p className="eyebrow">${jsxString(appSpec.targetUser)}</p>
          <h1 data-ai-id="app.hero.title">${jsxString(appSpec.appGoal)}</h1>
        </div>
        <p data-ai-id="app.hero.summary">${jsxString(designProfile.previewDescription)}</p>
      </section>
${pageBlocks}
      <section className="section section-content" data-ai-id="app.acceptance">
        <h2 data-ai-id="app.acceptance.title">验收标准</h2>
        <ul>
          ${acceptance}
        </ul>
        <p className="meta-line">${jsxString(models || 'No data models defined yet')}</p>
      </section>
    </main>
  );
}
`;
}

function renderPage(page: AppSpecPage): string {
  const sections = page.sections.map((section) => renderSection(page, section)).join('\n');
  const actions = page.actions.map((action) => renderAction(page, action)).join('\n');

  return `      <section className="page-band" data-ai-id="${aiId(page.id, 'page')}">
        <div className="page-heading">
          <span>${jsxString(page.name)}</span>
          <p>${jsxString(page.purpose)}</p>
        </div>
${sections}
${actions ? `        <div className="action-row">\n${actions}\n        </div>` : ''}
      </section>`;
}

function renderSection(page: AppSpecPage, section: AppSpecSection): string {
  return `        <article className="section section-${sanitizeSegment(section.kind)}" data-ai-id="${aiId(page.id, section.id)}">
          <h2 data-ai-id="${aiId(page.id, section.id, 'title')}">${jsxString(section.title)}</h2>
          <p data-ai-id="${aiId(page.id, section.id, 'content')}">${jsxString(section.content)}</p>
        </article>`;
}

function renderAction(page: AppSpecPage, action: AppSpecAction): string {
  return `          <button className="primary-action" type="button" data-ai-id="${aiId(page.id, 'actions', action.id)}">${jsxString(action.label)}</button>`;
}

function renderStyles(designProfile: DesignProfile): string {
  const { colors, typography, radius, shadow, density } = designProfile.designTokens;
  const maxWidth = density === 'compact' ? '960px' : density === 'airy' ? '1180px' : '1080px';
  const cardPadding = density === 'compact' ? '16px' : density === 'airy' ? '28px' : '22px';
  const radiusValue = radius === 'none' ? '0' : radius === 'sm' ? '4px' : radius === 'md' ? '8px' : radius === 'lg' ? '12px' : '18px';
  const shadowValue = shadow === 'none' ? 'none' : shadow === 'subtle' ? '0 10px 30px rgba(20, 32, 29, 0.08)' : '0 18px 45px rgba(20, 32, 29, 0.14)';

  return `:root {
  color: ${colors.foreground};
  background: ${colors.background};
  font-family: ${typography.bodyFont}, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
}

button {
  font: inherit;
}

.app-shell {
  width: min(${maxWidth}, calc(100vw - 32px));
  margin: 0 auto;
  padding: 24px 0 48px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}

.brand-pill {
  border: 1px solid ${colors.border};
  border-radius: ${radiusValue};
  background: ${colors.secondary};
  color: ${colors.foreground};
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 760;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(240px, 0.7fr);
  gap: 28px;
  align-items: end;
  border-bottom: 1px solid ${colors.border};
  padding: 56px 0 34px;
}

.eyebrow,
.meta-line,
.page-heading p,
.section p {
  color: ${colors.muted};
}

h1,
h2,
p {
  margin: 0;
}

h1,
h2 {
  font-family: ${typography.headingFont}, ui-sans-serif, system-ui, sans-serif;
}

h1 {
  max-width: 760px;
  margin-top: 10px;
  font-size: ${typography.scale === 'compact' ? '42px' : typography.scale === 'spacious' ? '58px' : '50px'};
  line-height: 1.04;
}

.page-band {
  display: grid;
  gap: 14px;
  margin-top: 22px;
}

.page-heading,
.section {
  border: 1px solid ${colors.border};
  border-radius: ${radiusValue};
  background: #ffffff;
  box-shadow: ${shadowValue};
  padding: ${cardPadding};
}

.page-heading span,
.section h2 {
  color: ${colors.foreground};
  font-weight: 800;
}

.section p {
  margin-top: 8px;
  line-height: 1.7;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.primary-action {
  min-height: 42px;
  border: 0;
  border-radius: ${radiusValue};
  background: ${colors.primary};
  color: #ffffff;
  padding: 0 16px;
  font-weight: 760;
}

ul {
  margin: 12px 0 0;
  padding-left: 20px;
  color: ${colors.muted};
  line-height: 1.7;
}

@media (max-width: 760px) {
  .hero {
    grid-template-columns: 1fr;
  }

  h1 {
    font-size: 36px;
  }
}
`;
}

function assertAllowedGeneratedPath(path: string): void {
  if (safeStaticPaths.has(path) || path.startsWith('src/')) {
    return;
  }

  throw new Error(`Unsafe generated path: ${path}`);
}

function aiId(...segments: string[]): string {
  return segments.map(sanitizeSegment).join('.');
}

function sanitizeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'item';
}

function toPackageName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'generated-app';
}

function jsxString(value: string): string {
  return `{${JSON.stringify(value)}}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
