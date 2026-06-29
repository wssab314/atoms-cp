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
        file: 'src/App.tsx',
        component: 'GeneratedApp',
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

function templateFiles(taskSpec: CodexTaskSpec): GeneratedFile[] {
  const manifest = manifestForTaskSpec(taskSpec);

  return [
    {
      path: 'package.json',
      content: `${JSON.stringify({
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
          typecheck: 'tsc --noEmit'
        },
        dependencies: {
          '@vitejs/plugin-react': 'latest',
          vite: 'latest',
          typescript: 'latest',
          react: 'latest',
          'react-dom': 'latest'
        },
        devDependencies: {}
      }, null, 2)}\n`,
      purpose: 'Controlled React/Vite package manifest.'
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
          jsx: 'react-jsx'
        },
        include: ['src'],
        references: []
      }, null, 2)}\n`,
      purpose: 'TypeScript project configuration.'
    },
    {
      path: 'vite.config.ts',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
- Do not write secrets, .env files, build output, node_modules, or git metadata.
- Keep user-facing copy product-focused and avoid implementation jargon.
`,
      purpose: 'Workspace guardrails for future Codex worker adapters.'
    }
  ];
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
