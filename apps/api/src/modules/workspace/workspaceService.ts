import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import type { AiManifest, CodexTaskSpec, GeneratedFile } from '@atoms-cp/shared';

export interface WorkspaceFile extends GeneratedFile {
  contentHash: string;
}

export interface WorkspacePathValidation {
  allowed: boolean;
  reason?: string;
}

const ignoredWorkspaceNames = new Set(['node_modules', 'dist', '.git']);
const alwaysDeniedNames = new Set(['.env']);

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function toPosixPath(value: string): string {
  return value.split(sep).join('/');
}

function normalizeRelativePath(value: string): string | undefined {
  if (!value || value.includes('\0') || isAbsolute(value)) {
    return undefined;
  }

  const normalized = posix.normalize(value.replace(/\\/g, '/'));

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  return normalized;
}

function matchesPattern(filePath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/');

  if (normalizedPattern.startsWith('/')) {
    return false;
  }

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }

  if (normalizedPattern.endsWith('*')) {
    return filePath.startsWith(normalizedPattern.slice(0, -1));
  }

  return filePath === normalizedPattern;
}

function isAlwaysDeniedPath(filePath: string): boolean {
  const parts = filePath.split('/');
  return parts.some((part) => ignoredWorkspaceNames.has(part) || alwaysDeniedNames.has(part) || part.startsWith('.env.'));
}

function isAllowedByTaskSpec(filePath: string, taskSpec: CodexTaskSpec): boolean {
  return taskSpec.allowedPaths.some((pattern) => matchesPattern(filePath, pattern));
}

export function validateWorkspaceRelativePath(value: string, taskSpec: CodexTaskSpec): WorkspacePathValidation {
  const filePath = normalizeRelativePath(value);

  if (!filePath) {
    return {
      allowed: false,
      reason: 'Path must be a safe relative workspace path.'
    };
  }

  if (isAlwaysDeniedPath(filePath)) {
    return {
      allowed: false,
      reason: 'Path is denied by the workspace safety policy.'
    };
  }

  if (taskSpec.forbiddenPaths.some((pattern) => matchesPattern(filePath, pattern))) {
    return {
      allowed: false,
      reason: 'Path is forbidden by the CodexTask policy.'
    };
  }

  if (filePath === 'package.json') {
    return taskSpec.dependencyPolicy === 'allow_package_json_with_review'
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'package.json changes require dependency review.'
        };
  }

  if (!isAllowedByTaskSpec(filePath, taskSpec)) {
    return {
      allowed: false,
      reason: 'Path is outside allowed CodexTask paths.'
    };
  }

  return { allowed: true };
}

function manifestForTaskSpec(taskSpec: CodexTaskSpec): AiManifest {
  const entries: AiManifest['entries'] = {};

  for (const page of taskSpec.appSpec.pages) {
    for (const section of page.sections) {
      const aiId = `${page.id}.${section.id}.title`;
      entries[aiId] = {
        aiId,
        file: taskSpec.platform === 'mini_program' ? 'src/pages/index/index.tsx' : 'src/App.tsx',
        component: taskSpec.platform === 'mini_program' ? 'Index' : 'GeneratedApp',
        elementType: 'heading',
        editable: ['text'],
        requirementId: `${page.id}:${section.id}`
      };
    }
  }

  return {
    entries
  };
}

function createAppTsx(taskSpec: CodexTaskSpec): string {
  const appName = taskSpec.appSpec.appName;
  const appGoal = taskSpec.appSpec.appGoal;
  const targetUser = taskSpec.appSpec.targetUser;
  const designName = taskSpec.designProfile.name;
  const pages = taskSpec.appSpec.pages.map((page) => ({
    id: page.id,
    name: page.name,
    route: page.route,
    purpose: page.purpose,
    sections: page.sections.map((section) => ({
      id: section.id,
      aiId: `${page.id}.${section.id}.title`,
      kind: section.kind,
      title: section.title,
      content: section.content
    }))
  }));
  const acceptanceCriteria = taskSpec.appSpec.acceptanceCriteria;

  return `import './styles/tokens.css';

const appName = ${JSON.stringify(appName)};
const appGoal = ${JSON.stringify(appGoal)};
const targetUser = ${JSON.stringify(targetUser)};
const designName = ${JSON.stringify(designName)};
const pages = ${JSON.stringify(pages, null, 2)} as const;
const acceptanceCriteria = ${JSON.stringify(acceptanceCriteria, null, 2)} as const;

export function App() {
  const primaryPage = pages[0];

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">{designName}</p>
        <h1 data-ai-id="home.hero.title">{appName}</h1>
        <p className="lede">{appGoal}</p>
        <div className="hero-actions" aria-label="Application actions">
          <button type="button">继续修改</button>
          <button type="button" className="secondary">预览快照</button>
        </div>
      </section>

      <section className="content-grid" aria-label="Generated application">
        <article className="card">
          <p className="eyebrow">目标用户</p>
          <h2>{primaryPage?.name ?? '应用首页'}</h2>
          <p>{primaryPage?.purpose ?? targetUser}</p>
        </article>

        {pages.flatMap((page) =>
          page.sections.map((section) => (
            <article className="card" key={section.aiId}>
              <p className="eyebrow">{section.kind}</p>
              <h2 data-ai-id={section.aiId}>{section.title}</h2>
              <p>{section.content}</p>
            </article>
          ))
        )}

        <article className="card">
          <p className="eyebrow">验收重点</p>
          <ul>
            {acceptanceCriteria.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}

export default App;
`;
}

function createTokensCss(taskSpec: CodexTaskSpec): string {
  const { colors, typography, radius, shadow, density } = taskSpec.designProfile.designTokens;
  const radiusPx = {
    none: '0px',
    sm: '6px',
    md: '10px',
    lg: '16px',
    xl: '20px'
  }[radius];
  const shadowValue = {
    none: 'none',
    subtle: '0 12px 32px rgba(23, 26, 31, 0.08)',
    medium: '0 20px 44px rgba(23, 26, 31, 0.14)'
  }[shadow];
  const gap = {
    compact: '12px',
    balanced: '18px',
    airy: '24px'
  }[density];

  return `:root {
  color: ${colors.foreground};
  background: ${colors.background};
  font-family: ${typography.bodyFont}, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --background: ${colors.background};
  --foreground: ${colors.foreground};
  --primary: ${colors.primary};
  --secondary: ${colors.secondary};
  --muted: ${colors.muted};
  --border: ${colors.border};
  --accent: ${colors.accent};
  --radius: ${radiusPx};
  --shadow: ${shadowValue};
  --gap: ${gap};
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: var(--background);
}

button {
  border: 0;
  border-radius: 999px;
  background: var(--primary);
  color: white;
  font: inherit;
  font-weight: 700;
  padding: 10px 16px;
}

button.secondary {
  background: var(--secondary);
  color: var(--primary);
}

.app-shell {
  width: min(1120px, calc(100vw - 40px));
  margin: 0 auto;
  padding: 48px 0;
}

.hero-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--background) 86%, white);
  box-shadow: var(--shadow);
  padding: 32px;
}

.hero-panel h1 {
  margin: 8px 0 12px;
  font-family: ${typography.headingFont}, Inter, system-ui, sans-serif;
  font-size: clamp(32px, 5vw, 56px);
  line-height: 1;
}

.lede {
  max-width: 680px;
  color: var(--muted);
  font-size: 18px;
  line-height: 1.7;
}

.hero-actions,
.content-grid {
  display: flex;
  gap: var(--gap);
  flex-wrap: wrap;
}

.content-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 20px;
}

.card {
  min-height: 180px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: white;
  box-shadow: var(--shadow);
  padding: 22px;
}

.card h2 {
  margin: 6px 0 10px;
  font-size: 22px;
}

.card p,
.card li {
  color: var(--muted);
  line-height: 1.65;
}

.eyebrow {
  margin: 0;
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}
`;
}

function createPreviewInspectorTs(): string {
  return `type InspectorCommand =
  | { type: 'INSPECTOR_ENABLE' }
  | { type: 'INSPECTOR_DISABLE' }
  | { type: 'INSPECTOR_HIGHLIGHT'; aiId: string };

type InspectorElementMessage = {
  type: 'atoms-cp:preview-element-selected' | 'atoms-cp:preview-element-hovered';
  event: 'INSPECTOR_SELECT' | 'INSPECTOR_HOVER';
  aiId: string;
  text?: string;
  className?: string;
  tagName: string;
};

let inspectorEnabled = new URL(window.location.href).searchParams.get('inspector') === '1';
let highlightedElement: HTMLElement | null = null;

function parentTargetOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*';
  } catch {
    return '*';
  }
}

function findByAiId(aiId: string): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-ai-id]'))
    .find((element) => element.dataset.aiId === aiId) ?? null;
}

function closestInspectableElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest<HTMLElement>('[data-ai-id]') : null;
}

function readableElementText(element: HTMLElement): string | undefined {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return undefined;
  }

  const text = element.textContent?.trim();
  return text ? text.slice(0, 500) : undefined;
}

function messageForElement(element: HTMLElement, event: InspectorElementMessage['event']): InspectorElementMessage {
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

function handleInspectorCommand(command: InspectorCommand): void {
  if (command.type === 'INSPECTOR_ENABLE') {
    inspectorEnabled = true;
    return;
  }

  if (command.type === 'INSPECTOR_DISABLE') {
    inspectorEnabled = false;
    setHighlight(null);
    return;
  }

  if (command.type === 'INSPECTOR_HIGHLIGHT') {
    setHighlight(findByAiId(command.aiId));
  }
}

window.addEventListener('message', (event) => {
  const allowedOrigin = parentTargetOrigin();

  if (event.source !== window.parent) {
    return;
  }

  if (allowedOrigin !== '*' && event.origin && event.origin !== allowedOrigin) {
    return;
  }

  const command = event.data as Partial<InspectorCommand>;

  if (command?.type === 'INSPECTOR_ENABLE' || command?.type === 'INSPECTOR_DISABLE' || command?.type === 'INSPECTOR_HIGHLIGHT') {
    handleInspectorCommand(command as InspectorCommand);
  }
});

document.addEventListener(
  'pointerover',
  (event) => {
    if (!inspectorEnabled) {
      return;
    }

    const element = closestInspectableElement(event.target);

    if (!element) {
      return;
    }

    setHighlight(element);
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_HOVER'), parentTargetOrigin());
  },
  true
);

document.addEventListener(
  'click',
  (event) => {
    if (!inspectorEnabled) {
      return;
    }

    const element = closestInspectableElement(event.target);

    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage(messageForElement(element, 'INSPECTOR_SELECT'), parentTargetOrigin());
  },
  true
);
`;
}

function reactViteTemplateFiles(taskSpec: CodexTaskSpec): GeneratedFile[] {
  const manifest = manifestForTaskSpec(taskSpec);
  const allowedLibraries = [
    'react',
    'react-dom',
    'react-router-dom',
    'lucide-react',
    'recharts',
    '@tanstack/react-table',
    'react-hook-form',
    'zod',
    'clsx',
    'date-fns',
    'framer-motion'
  ];

  return [
    {
      path: 'package.json',
      content: `${JSON.stringify({
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          'build:preview': 'vite build --mode preview --minify=false --sourcemap=false',
          'build:strict': 'tsc --noEmit && vite build',
          preview: 'vite preview --host 0.0.0.0',
          typecheck: 'tsc --noEmit'
        },
        dependencies: {
          '@tanstack/react-table': '^8.20.6',
          clsx: '^2.1.1',
          'date-fns': '^4.1.0',
          'framer-motion': '^12.0.0',
          'lucide-react': '^0.468.0',
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'react-hook-form': '^7.54.2',
          'react-router-dom': '^7.1.1',
          recharts: '^2.15.0',
          zod: '^3.24.1'
        },
        devDependencies: {
          '@types/react': '^19.0.0',
          '@types/react-dom': '^19.0.0',
          '@vitejs/plugin-react': '^4.3.4',
          typescript: '^5.7.2',
          vite: '^5.4.21'
        }
      }, null, 2)}\n`,
      purpose: 'Platform dependency manifest. Preview builds use the preinstalled template dependencies.'
    },
    {
      path: 'index.html',
      content: `<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n`,
      purpose: 'Vite HTML entry.'
    },
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['DOM', 'DOM.Iterable', 'ES2020'],
          allowJs: false,
          skipLibCheck: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strict: true,
          forceConsistentCasingInFileNames: true,
          module: 'ESNext',
          moduleResolution: 'Node',
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          types: ['vite/client', 'node']
        },
        include: ['src', 'vite.config.ts'],
        references: []
      }, null, 2)}\n`,
      purpose: 'TypeScript project configuration.'
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [react()]
});
`,
      purpose: 'Vite build configuration.'
    },
    {
      path: 'src/main.tsx',
      content: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './preview-inspector';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
      purpose: 'React app entry.'
    },
    {
      path: 'src/preview-inspector.ts',
      content: createPreviewInspectorTs(),
      purpose: 'Preview inspector runtime.'
    },
    {
      path: 'src/App.tsx',
      content: createAppTsx(taskSpec),
      purpose: 'Generated application shell.'
    },
    {
      path: 'src/styles/tokens.css',
      content: createTokensCss(taskSpec),
      purpose: 'Design token stylesheet.'
    },
    {
      path: 'src/lib/supabase.ts',
      content: `export const supabaseConnection = {
  enabled: false,
  reason: 'Connect Supabase from the builder resources panel before enabling runtime data.'
} as const;
`,
      purpose: 'Supabase integration placeholder.'
    },
    {
      path: 'ai-manifest.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      purpose: 'AI editable element manifest.'
    },
    {
      path: 'codex-rules.md',
      content: `# Codex Workspace Rules

- Work only inside allowed paths from the CodexTask.
- Do not edit package.json, lockfiles, tsconfig.json, vite.config.ts, build output, node_modules, or git metadata.
- Do not install dependencies. The platform already provides these allowed libraries: ${allowedLibraries.join(', ')}.
- Only import the allowed libraries above, plus relative files you create under src/.
- Keep user-facing copy product-focused and avoid implementation jargon.
`,
      purpose: 'Workspace guardrails for future Codex worker adapters.'
    }
  ];
}

function createTaroPageTsx(taskSpec: CodexTaskSpec): string {
  const appName = taskSpec.appSpec.appName;
  const appGoal = taskSpec.appSpec.appGoal;
  const targetUser = taskSpec.appSpec.targetUser;
  const primaryPage = taskSpec.appSpec.pages[0];
  const sections = taskSpec.appSpec.pages.flatMap((page) =>
    page.sections.map((section) => ({
      aiId: `${page.id}.${section.id}.title`,
      kind: section.kind,
      title: section.title,
      content: section.content
    }))
  );

  return `import { View, Text, Button, ScrollView } from '@tarojs/components';
import './index.css';

const appName = ${JSON.stringify(appName)};
const appGoal = ${JSON.stringify(appGoal)};
const targetUser = ${JSON.stringify(targetUser)};
const primaryPageName = ${JSON.stringify(primaryPage?.name ?? '首页')};
const sections = ${JSON.stringify(sections, null, 2)} as const;

export default function Index() {
  return (
    <ScrollView className="page" scrollY>
      <View className="hero" data-ai-id="home.hero">
        <Text className="eyebrow">微信小程序</Text>
        <Text className="title" data-ai-id="home.hero.title">{appName}</Text>
        <Text className="lede">{appGoal}</Text>
        <View className="actions">
          <Button className="primary-action">继续修改</Button>
          <Button className="secondary-action">{primaryPageName}</Button>
        </View>
      </View>

      <View className="card">
        <Text className="card-label">目标用户</Text>
        <Text className="card-title">{targetUser}</Text>
      </View>

      {sections.map((section) => (
        <View className="card" key={section.aiId}>
          <Text className="card-label">{section.kind}</Text>
          <Text className="card-title" data-ai-id={section.aiId}>{section.title}</Text>
          <Text className="card-copy">{section.content}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
`;
}

function createTaroPageCss(taskSpec: CodexTaskSpec): string {
  const { colors, radius, shadow, density } = taskSpec.designProfile.designTokens;
  const radiusPx = {
    none: '0px',
    sm: '12px',
    md: '20px',
    lg: '28px',
    xl: '36px'
  }[radius];
  const gap = {
    compact: '20px',
    balanced: '28px',
    airy: '36px'
  }[density];
  const shadowValue = shadow === 'none' ? 'none' : '0 20px 60px rgba(23, 26, 31, 0.10)';

  return `page {
  min-height: 100%;
  background: ${colors.background};
  color: ${colors.foreground};
}

.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 40px 28px 64px;
}

.hero,
.card {
  box-sizing: border-box;
  border: 1px solid ${colors.border};
  border-radius: ${radiusPx};
  background: #ffffff;
  box-shadow: ${shadowValue};
}

.hero {
  padding: 40px 32px;
  margin-bottom: ${gap};
}

.eyebrow,
.card-label {
  display: block;
  color: ${colors.primary};
  font-size: 24px;
  font-weight: 700;
}

.title {
  display: block;
  margin-top: 18px;
  color: ${colors.foreground};
  font-size: 52px;
  font-weight: 800;
  line-height: 1.12;
}

.lede,
.card-copy {
  display: block;
  margin-top: 18px;
  color: ${colors.muted};
  font-size: 28px;
  line-height: 1.7;
}

.actions {
  display: flex;
  gap: 18px;
  margin-top: 28px;
}

.primary-action,
.secondary-action {
  margin: 0;
  border-radius: 999px;
  font-size: 26px;
  font-weight: 700;
}

.primary-action {
  color: #ffffff;
  background: ${colors.primary};
}

.secondary-action {
  color: ${colors.primary};
  background: ${colors.secondary};
}

.card {
  padding: 28px;
  margin-top: ${gap};
}

.card-title {
  display: block;
  margin-top: 12px;
  color: ${colors.foreground};
  font-size: 34px;
  font-weight: 800;
  line-height: 1.25;
}
`;
}

function taroTemplateFiles(taskSpec: CodexTaskSpec): GeneratedFile[] {
  const manifest = manifestForTaskSpec(taskSpec);

  return [
    {
      path: 'package.json',
      content: `${JSON.stringify({
        scripts: {
          dev: 'taro build --type h5 --watch',
          'build:h5': 'taro build --type h5',
          'build:weapp': 'taro build --type weapp',
          typecheck: 'tsc --noEmit'
        },
        dependencies: {
          '@tarojs/components': '4.2.0',
          '@tarojs/helper': '4.2.0',
          '@tarojs/plugin-framework-react': '4.2.0',
          '@tarojs/plugin-platform-h5': '4.2.0',
          '@tarojs/plugin-platform-weapp': '4.2.0',
          '@tarojs/react': '4.2.0',
          '@tarojs/runtime': '4.2.0',
          '@tarojs/shared': '4.2.0',
          '@tarojs/taro': '4.2.0',
          '@tarojs/webpack5-runner': '4.2.0',
          'babel-preset-taro': '4.2.0',
          react: '^18.2.0',
          'react-dom': '^18.2.0'
        },
        devDependencies: {
          '@babel/core': '^7.28.0',
          '@babel/plugin-transform-typescript': '^7.29.7',
          '@babel/preset-react': '^7.29.7',
          '@tarojs/cli': '4.2.0',
          '@types/react': '^18.2.0',
          '@types/react-dom': '^18.2.0',
          postcss: '^8.4.49',
          typescript: '^5.7.2',
          webpack: '5.91.0'
        },
        private: true,
        name: 'atoms-mini-program',
        version: '0.0.0'
      }, null, 2)}\n`,
      purpose: 'Platform dependency manifest for a Taro mini program.'
    },
    {
      path: 'config/index.ts',
      content: `import { defineConfig } from '@tarojs/cli';

export default defineConfig({
  projectName: 'atoms-mini-program',
  date: '2026-06-29',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  plugins: ['@tarojs/plugin-platform-weapp', '@tarojs/plugin-platform-h5'],
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      }
    }
  },
  h5: {
    publicPath: './',
    staticDirectory: 'static',
    router: {
      mode: 'hash'
    }
  }
});
`,
      purpose: 'Taro build configuration.'
    },
    {
      path: 'config/dev.ts',
      content: `export default {};\n`,
      purpose: 'Taro development build overrides.'
    },
    {
      path: 'config/prod.ts',
      content: `export default {};\n`,
      purpose: 'Taro production build overrides.'
    },
    {
      path: 'project.config.json',
      content: `${JSON.stringify({
        miniprogramRoot: 'dist/weapp/',
        projectname: 'atoms-mini-program',
        description: 'Generated by Atoms CP',
        appid: 'touristappid',
        setting: {
          urlCheck: true,
          es6: true,
          postcss: true,
          minified: true
        },
        compileType: 'miniprogram'
      }, null, 2)}\n`,
      purpose: 'WeChat Developer Tools project configuration.'
    },
    {
      path: 'babel.config.js',
      content: `module.exports = {
  presets: [
    ['taro', {
      framework: 'react',
      ts: true
    }]
  ]
};
`,
      purpose: 'Taro Babel configuration.'
    },
    {
      path: 'tsconfig.json',
      content: `${JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'Node',
          jsx: 'react-jsx',
          strict: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          noEmit: true,
          types: ['node']
        },
        include: ['src', 'config']
      }, null, 2)}\n`,
      purpose: 'TypeScript configuration for the Taro app.'
    },
    {
      path: 'src/index.html',
      content: `<div id="app"></div>\n`,
      purpose: 'Taro H5 HTML entry.'
    },
    {
      path: 'src/app.config.ts',
      content: `export default {
  pages: ['pages/index/index'],
  window: {
    navigationBarTitleText: ${JSON.stringify(taskSpec.appSpec.appName)},
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
    backgroundColor: ${JSON.stringify(taskSpec.designProfile.designTokens.colors.background)}
  }
};
`,
      purpose: 'Taro global mini program configuration.'
    },
    {
      path: 'src/app.tsx',
      content: `import type { PropsWithChildren } from 'react';
import './app.css';

export default function App({ children }: PropsWithChildren) {
  return children;
}
`,
      purpose: 'Taro React app entry.'
    },
    {
      path: 'src/app.css',
      content: `page {
  min-height: 100%;
}
`,
      purpose: 'Taro global stylesheet.'
    },
    {
      path: 'src/pages/index/index.config.ts',
      content: `export default {
  navigationBarTitleText: ${JSON.stringify(taskSpec.appSpec.appName)}
};
`,
      purpose: 'Taro index page configuration.'
    },
    {
      path: 'src/pages/index/index.tsx',
      content: createTaroPageTsx(taskSpec),
      purpose: 'Generated Taro mini program page.'
    },
    {
      path: 'src/pages/index/index.css',
      content: createTaroPageCss(taskSpec),
      purpose: 'Generated Taro mini program page styles.'
    },
    {
      path: 'ai-manifest.json',
      content: `${JSON.stringify(manifest, null, 2)}\n`,
      purpose: 'AI editable element manifest.'
    },
    {
      path: 'codex-rules.md',
      content: `# Taro Workspace Rules

- This is a Taro React WeChat Mini Program project.
- Edit only allowed source files and ai-manifest.json.
- Use Taro components from @tarojs/components and APIs from @tarojs/taro.
- Do not use browser-only DOM APIs, package installation, lockfiles, dist, node_modules, or hidden config files.
- The platform builds an H5 preview and packages mini program source for download.
`,
      purpose: 'Workspace guardrails for Taro generation.'
    }
  ];
}

function templateFiles(taskSpec: CodexTaskSpec): GeneratedFile[] {
  return taskSpec.platform === 'mini_program'
    ? taroTemplateFiles(taskSpec)
    : reactViteTemplateFiles(taskSpec);
}

export async function createWorkspaceFromTemplate(input: {
  workspacePath: string;
  taskSpec: CodexTaskSpec;
}): Promise<WorkspaceFile[]> {
  if (!isAbsolute(input.workspacePath)) {
    throw new Error('Workspace path must be absolute.');
  }

  await mkdir(input.workspacePath, { recursive: true });

  for (const file of templateFiles(input.taskSpec)) {
    const filePath = join(input.workspacePath, file.path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, file.content, 'utf8');
  }

  return collectWorkspaceFiles(input.workspacePath);
}

export async function collectWorkspaceFiles(workspacePath: string): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredWorkspaceNames.has(entry.name)) {
        continue;
      }

      const absolutePath = join(currentPath, entry.name);
      const relativePath = toPosixPath(relative(workspacePath, absolutePath));

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || isAlwaysDeniedPath(relativePath)) {
        continue;
      }

      const content = await readFile(absolutePath, 'utf8');
      files.push({
        path: relativePath,
        content,
        contentHash: hashContent(content),
        purpose: `Workspace file: ${relativePath}`
      });
    }
  }

  await walk(workspacePath);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function copyWorkspaceVersion(input: {
  sourcePath: string;
  targetPath: string;
}): Promise<void> {
  if (!isAbsolute(input.sourcePath) || !isAbsolute(input.targetPath)) {
    throw new Error('Workspace paths must be absolute.');
  }

  await rm(input.targetPath, { recursive: true, force: true });
  await mkdir(input.targetPath, { recursive: true });

  async function copyDirectory(source: string, target: string): Promise<void> {
    const sourceStat = await stat(source);

    if (!sourceStat.isDirectory()) {
      return;
    }

    const entries = await readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredWorkspaceNames.has(entry.name)) {
        continue;
      }

      const from = join(source, entry.name);
      const to = join(target, entry.name);

      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await copyDirectory(from, to);
        continue;
      }

      const relativePath = toPosixPath(relative(input.sourcePath, from));

      if (!entry.isFile() || isAlwaysDeniedPath(relativePath)) {
        continue;
      }

      const content = await readFile(from);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, content);
    }
  }

  await copyDirectory(input.sourcePath, input.targetPath);
}

export function workspaceVersionPath(input: {
  workspaceRoot: string;
  projectId: string;
  taskId: string;
}): string {
  return join(input.workspaceRoot, input.projectId, basename(input.taskId));
}
