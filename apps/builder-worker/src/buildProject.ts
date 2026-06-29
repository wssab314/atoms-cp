import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

export interface BuildProjectFile {
  path: string;
  content: string;
}

export interface BuildCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface BuildCommandContext {
  cwd: string;
  timeoutMs: number;
}

export type PreviewBuildMode = 'fast' | 'strict';
export type PreviewBuildPlatform = 'web' | 'mini_program';

export interface BuildProjectLogLine {
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}

export interface BuildProjectPreviewInput {
  buildJobId: string;
  projectFiles: BuildProjectFile[];
  previewRoot: string;
  workspaceRoot: string;
  buildMode?: PreviewBuildMode;
  platform?: PreviewBuildPlatform;
  templateRoot?: string;
  runCommand?: (context: BuildCommandContext) => Promise<BuildCommandResult>;
  maxBuildMs?: number;
  maxLogLines?: number;
  secretValues?: string[];
  cleanupWorkspace?: boolean;
}

export interface BuildProjectPreviewResult {
  status: 'success' | 'failed';
  previewPath?: string;
  errorSummary?: string;
  logs: BuildProjectLogLine[];
}

const DEFAULT_BUILD_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_LOG_LINES = 200;
const DEFAULT_PREVIEW_TEMPLATE_ROOT = '/app/packages/generated-app-template';
const DEFAULT_TARO_PREVIEW_TEMPLATE_ROOT = '/app/packages/generated-taro-template';
const SENSITIVE_ENV_KEY_PATTERN = /(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|DATABASE_URL|REDIS_URL|SUPABASE|DEEPSEEK|GITHUB|VERCEL)/i;
const TEMPLATE_CONTROLLED_FILES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts'
]);
const LOCKFILE_NAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock'
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
const TARO_NAMED_IMPORT_PATTERN =
  /import\s+(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s*from\s*["']@tarojs\/taro["']/g;

export const PREVIEW_ALLOWED_IMPORT_PACKAGES = [
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
] as const;

export const TARO_PREVIEW_ALLOWED_IMPORT_PACKAGES = [
  'react',
  'react-dom',
  '@tarojs/taro',
  '@tarojs/components',
  '@tarojs/react'
] as const;

const WEB_PREVIEW_ALLOWED_PACKAGE_SET = new Set<string>([
  ...PREVIEW_ALLOWED_IMPORT_PACKAGES,
  '@vitejs/plugin-react',
  'vite',
  'typescript',
  '@types/react',
  '@types/react-dom'
]);
const TARO_PREVIEW_ALLOWED_PACKAGE_SET = new Set<string>([
  ...TARO_PREVIEW_ALLOWED_IMPORT_PACKAGES,
  '@babel/core',
  '@babel/plugin-transform-typescript',
  '@babel/preset-react',
  '@tarojs/cli',
  '@tarojs/helper',
  '@tarojs/plugin-framework-react',
  '@tarojs/plugin-platform-h5',
  '@tarojs/plugin-platform-weapp',
  '@tarojs/runtime',
  '@tarojs/shared',
  '@tarojs/webpack5-runner',
  'babel-preset-taro',
  '@types/react',
  '@types/react-dom',
  'postcss',
  'typescript',
  'webpack'
]);
const TARO_COMPONENT_EXPORTS = new Set<string>([
  'Ad',
  'AdCustom',
  'Audio',
  'Button',
  'Camera',
  'Canvas',
  'Checkbox',
  'CheckboxGroup',
  'CoverImage',
  'CoverView',
  'CustomWrapper',
  'Editor',
  'Form',
  'FunctionalPageNavigator',
  'Icon',
  'Image',
  'Input',
  'KeyboardAccessory',
  'Label',
  'LivePlayer',
  'LivePusher',
  'Map',
  'MovableArea',
  'MovableView',
  'Navigator',
  'OfficialAccount',
  'OpenData',
  'PageContainer',
  'Picker',
  'PickerView',
  'PickerViewColumn',
  'Progress',
  'Radio',
  'RadioGroup',
  'RichText',
  'RootPortal',
  'ScrollView',
  'Slider',
  'Swiper',
  'SwiperItem',
  'Switch',
  'Text',
  'Textarea',
  'Video',
  'View',
  'WebView'
]);

export async function buildProjectPreview(input: BuildProjectPreviewInput): Promise<BuildProjectPreviewResult> {
  const workspace = input.workspaceRoot;
  const previewPath = join(input.previewRoot, input.buildJobId);
  const logs: BuildProjectLogLine[] = [];
  const maxBuildMs = input.maxBuildMs ?? DEFAULT_BUILD_TIMEOUT_MS;
  const maxLogLines = input.maxLogLines ?? DEFAULT_MAX_LOG_LINES;
  const cleanupWorkspace = input.cleanupWorkspace ?? true;
  const buildMode = input.buildMode ?? 'strict';
  const platform = input.platform ?? 'web';

  try {
    await rm(workspace, { recursive: true, force: true });
    await rm(previewPath, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(workspace, 'dist'), { recursive: true });
    await mkdir(input.previewRoot, { recursive: true });

    if (buildMode === 'fast') {
      await prepareFastPreviewWorkspace({
        workspace,
        platform,
        templateRoot: input.templateRoot ?? defaultTemplateRootForPlatform(platform),
        projectFiles: input.projectFiles
      });
    } else {
      await writeStrictProjectFiles(workspace, input.projectFiles);
    }

    const runCommand = input.runCommand ?? (buildMode === 'fast' ? fastBuildCommandForPlatform(platform) : runPnpmBuild);
    const result = await runCommandWithTimeout(
      runCommand({ cwd: workspace, timeoutMs: maxBuildMs }),
      maxBuildMs
    );
    const commandLogs = toCappedCommandLogs(result, maxLogLines, input.secretValues ?? []);
    logs.push(...commandLogs.logs);

    if (commandLogs.truncated) {
      logs.push({
        stream: 'system',
        line: `Build log truncated after ${maxLogLines} lines.`
      });
    }

    if (result.exitCode !== 0) {
      const errorSummary = maskedErrorSummary(result, input.secretValues ?? []);
      logs.push({
        stream: 'system',
        line: errorSummary
      });
      return {
        status: 'failed',
        errorSummary,
        logs
      };
    }

    await relativizePreviewAssetPaths(join(workspace, 'dist', 'index.html'));
    await cp(join(workspace, 'dist'), previewPath, { recursive: true });
    logs.push({
      stream: 'system',
      line: 'Build completed successfully.'
    });

    return {
      status: 'success',
      previewPath,
      logs
    };
  } catch (error) {
    const errorSummary = maskSensitiveText(error instanceof Error ? error.message : 'Build failed.', input.secretValues ?? []);
    logs.push({
      stream: 'system',
      line: errorSummary
    });
    return {
      status: 'failed',
      errorSummary,
      logs
    };
  } finally {
    if (cleanupWorkspace) {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function writeStrictProjectFiles(workspace: string, projectFiles: BuildProjectFile[]): Promise<void> {
  for (const file of projectFiles) {
    const targetPath = safeJoin(workspace, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, 'utf8');
  }
}

async function prepareFastPreviewWorkspace(input: {
  workspace: string;
  platform: PreviewBuildPlatform;
  templateRoot: string;
  projectFiles: BuildProjectFile[];
}): Promise<void> {
  await copyTemplateDirectory(input.templateRoot, input.workspace);
  await linkTemplateNodeModules(input.templateRoot, input.workspace);

  for (const file of input.projectFiles) {
    const normalizedPath = normalizeProjectPath(file.path);
    assertFastPreviewPathAllowed(normalizedPath, file, input.platform);

    if (TEMPLATE_CONTROLLED_FILES.has(normalizedPath)) {
      continue;
    }

    const targetPath = safeJoin(input.workspace, normalizedPath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, 'utf8');
  }
}

async function copyTemplateDirectory(templateRoot: string, workspace: string, currentRelativePath = ''): Promise<void> {
  const currentSource = join(templateRoot, currentRelativePath);
  const entries = await readdir(currentSource, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = currentRelativePath ? join(currentRelativePath, entry.name) : entry.name;
    const normalizedPath = normalizeProjectPath(relativePath);

    if (isTemplateCopyIgnored(normalizedPath)) {
      continue;
    }

    const sourcePath = join(templateRoot, relativePath);
    const targetPath = join(workspace, relativePath);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyTemplateDirectory(templateRoot, workspace, relativePath);
      continue;
    }

    if (entry.isFile()) {
      await mkdir(dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath);
    }
  }
}

function isTemplateCopyIgnored(relativePath: string): boolean {
  return (
    relativePath === 'node_modules' ||
    relativePath.startsWith(`node_modules/`) ||
    relativePath === 'dist' ||
    relativePath.startsWith('dist/') ||
    relativePath === '.git' ||
    relativePath.startsWith('.git/') ||
    relativePath === '.vite-cache' ||
    relativePath.startsWith('.vite-cache/')
  );
}

async function linkTemplateNodeModules(templateRoot: string, workspace: string): Promise<void> {
  const candidates = [
    process.env.TARO_PREVIEW_TEMPLATE_NODE_MODULES,
    process.env.PREVIEW_TEMPLATE_NODE_MODULES,
    join(templateRoot, 'node_modules'),
    '/app/node_modules'
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    try {
      const stats = await lstat(candidate);
      if (!stats.isDirectory() && !stats.isSymbolicLink()) {
        continue;
      }

      await symlink(candidate, join(workspace, 'node_modules'), 'dir');
      return;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Fast preview dependencies are not installed in the platform template.');
}

function assertFastPreviewPathAllowed(
  normalizedPath: string,
  file: BuildProjectFile,
  platform: PreviewBuildPlatform
): void {
  const firstSegment = normalizedPath.split('/')[0];
  if (
    normalizedPath.startsWith('.env') ||
    normalizedPath.startsWith('.git/') ||
    normalizedPath === '.git' ||
    normalizedPath.startsWith('node_modules/') ||
    normalizedPath === 'node_modules' ||
    normalizedPath.startsWith('dist/') ||
    normalizedPath === 'dist' ||
    LOCKFILE_NAMES.has(normalizedPath)
  ) {
    throw new Error(`Fast preview rejected unsupported generated path: ${normalizedPath}`);
  }

  if (firstSegment === 'src' && isSourceFile(normalizedPath)) {
    assertAllowedImports(file.content, normalizedPath, platform);
  }

  if (normalizedPath === 'package.json') {
    assertPackageManifestUsesAllowedDependencies(file.content, platform);
  }
}

function isSourceFile(normalizedPath: string): boolean {
  const extension = normalizedPath.slice(normalizedPath.lastIndexOf('.'));
  return SOURCE_EXTENSIONS.has(extension);
}

function assertAllowedImports(source: string, filePath: string, platform: PreviewBuildPlatform): void {
  const unsupportedPackages = new Set<string>();
  const allowedPackages = allowedPackageSetForPlatform(platform);
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) {
      continue;
    }

    const packageName = packageNameFromSpecifier(specifier);
    if (!allowedPackages.has(packageName)) {
      unsupportedPackages.add(packageName);
    }
  }

  if (unsupportedPackages.size > 0) {
    throw new Error(
      `Fast preview rejected unsupported imports in ${filePath}: ${Array.from(unsupportedPackages).sort().join(', ')}`
    );
  }

  if (platform === 'mini_program') {
    assertTaroComponentsUseComponentsPackage(source, filePath);
  }
}

function assertTaroComponentsUseComponentsPackage(source: string, filePath: string): void {
  const componentImports = new Set<string>();

  for (const match of source.matchAll(TARO_NAMED_IMPORT_PATTERN)) {
    const namedImports = match[1] ?? '';
    for (const rawSpecifier of namedImports.split(',')) {
      const importedName = rawSpecifier.trim().split(/\s+as\s+/i)[0]?.trim();

      if (importedName && TARO_COMPONENT_EXPORTS.has(importedName)) {
        componentImports.add(importedName);
      }
    }
  }

  if (componentImports.size > 0) {
    throw new Error(
      `Fast preview rejected Taro component imports from @tarojs/taro in ${filePath}: ${Array.from(componentImports).sort().join(', ')}. Import UI components from @tarojs/components.`
    );
  }
}

function assertPackageManifestUsesAllowedDependencies(content: string, platform: PreviewBuildPlatform): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Fast preview rejected invalid package manifest.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Fast preview rejected invalid package manifest.');
  }

  const manifest = parsed as {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
  };
  const dependencyNames = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {})
  ];
  const allowedPackages = allowedPackageSetForPlatform(platform);
  const unsupported = dependencyNames.filter((dependency) => !allowedPackages.has(dependency));

  if (unsupported.length > 0) {
    throw new Error(`Fast preview rejected unsupported dependency changes: ${unsupported.sort().join(', ')}`);
  }
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }

  return specifier.split('/')[0] ?? specifier;
}

function allowedPackageSetForPlatform(platform: PreviewBuildPlatform): Set<string> {
  return platform === 'mini_program' ? TARO_PREVIEW_ALLOWED_PACKAGE_SET : WEB_PREVIEW_ALLOWED_PACKAGE_SET;
}

function defaultTemplateRootForPlatform(platform: PreviewBuildPlatform): string {
  if (platform === 'mini_program') {
    return process.env.TARO_PREVIEW_TEMPLATE_ROOT ?? DEFAULT_TARO_PREVIEW_TEMPLATE_ROOT;
  }

  return process.env.PREVIEW_TEMPLATE_ROOT ?? DEFAULT_PREVIEW_TEMPLATE_ROOT;
}

function fastBuildCommandForPlatform(platform: PreviewBuildPlatform): (context: BuildCommandContext) => Promise<BuildCommandResult> {
  return platform === 'mini_program' ? runFastTaroPreviewBuild : runFastPreviewBuild;
}

function normalizeProjectPath(relativePath: string): string {
  return normalize(relativePath.replace(/\\/g, '/')).split(sep).join('/');
}

async function relativizePreviewAssetPaths(indexHtmlPath: string): Promise<void> {
  try {
    const html = await readFile(indexHtmlPath, 'utf8');
    const rewritten = html
      .replaceAll('src="/assets/', 'src="./assets/')
      .replaceAll("src='/assets/", "src='./assets/")
      .replaceAll('href="/assets/', 'href="./assets/')
      .replaceAll("href='/assets/", "href='./assets/")
      .replaceAll('url(/assets/', 'url(./assets/');

    if (rewritten !== html) {
      await writeFile(indexHtmlPath, rewritten, 'utf8');
    }
  } catch {
    // Missing index.html is handled by the preview route/build validation path.
  }
}

export async function runPnpmBuild(context: BuildCommandContext): Promise<BuildCommandResult> {
  return await runShellCommand(
    'sh',
    ['-lc', 'corepack enable && pnpm install --frozen-lockfile=false && pnpm build'],
    context.cwd,
    context.timeoutMs
  );
}

export async function runFastPreviewBuild(context: BuildCommandContext): Promise<BuildCommandResult> {
  return await runShellCommand(
    'sh',
    ['-lc', 'VITE_CACHE_DIR="$PWD/.vite-cache" ./node_modules/.bin/vite build --mode preview --minify=false --sourcemap=false'],
    context.cwd,
    context.timeoutMs
  );
}

export async function runFastTaroPreviewBuild(context: BuildCommandContext): Promise<BuildCommandResult> {
  return await runShellCommand(
    'sh',
    ['-lc', 'TARO_ENV=h5 NODE_ENV=production ./node_modules/.bin/taro build --type h5'],
    context.cwd,
    context.timeoutMs
  );
}

async function runShellCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<BuildCommandResult> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      env: buildProcessEnv(process.env)
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: BuildCommandResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolvePromise(result);
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        exitCode: 124,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Build timed out after ${timeoutMs}ms.`,
        timedOut: true
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${error.message}`
      });
    });
    child.on('close', (code) => {
      finish({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export function buildProcessEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || SENSITIVE_ENV_KEY_PATTERN.test(key)) {
      continue;
    }

    env[key] = value;
  }

  env.CI = 'true';
  return env;
}

async function runCommandWithTimeout(
  commandPromise: Promise<BuildCommandResult>,
  timeoutMs: number
): Promise<BuildCommandResult> {
  let timeout: NodeJS.Timeout | undefined;
  const safeCommandPromise = commandPromise.catch((error: unknown) => ({
    exitCode: 1,
    stdout: '',
    stderr: error instanceof Error ? error.message : 'Build command failed.'
  }));
  const timeoutPromise = new Promise<BuildCommandResult>((resolvePromise) => {
    timeout = setTimeout(() => {
      resolvePromise({
        exitCode: 124,
        stdout: '',
        stderr: `Build timed out after ${timeoutMs}ms.`,
        timedOut: true
      });
    }, timeoutMs);
  });

  const result = await Promise.race([safeCommandPromise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
  }

  return result;
}

function safeJoin(root: string, relativePath: string): string {
  const normalized = normalize(relativePath);

  if (normalized.startsWith('..') || normalized.includes('/../') || normalized.includes('\\..\\') || normalized.startsWith('/')) {
    throw new Error(`Unsafe project file path: ${relativePath}`);
  }

  const targetPath = resolve(root, normalized);
  const rootPath = resolve(root);
  const rootRelativePath = relative(rootPath, targetPath);

  if (rootRelativePath.startsWith('..') || rootRelativePath.startsWith('/') || rootRelativePath.startsWith('\\')) {
    throw new Error(`Unsafe project file path: ${relativePath}`);
  }

  return targetPath;
}

function toLogLines(stream: 'stdout' | 'stderr', text: string): BuildProjectLogLine[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => ({
      stream,
      line
    }));
}

function toCappedCommandLogs(
  result: BuildCommandResult,
  maxLogLines: number,
  secretValues: string[]
): { logs: BuildProjectLogLine[]; truncated: boolean } {
  const logs = [
    ...toLogLines('stdout', maskSensitiveText(result.stdout, secretValues)),
    ...toLogLines('stderr', maskSensitiveText(result.stderr, secretValues))
  ];

  return {
    logs: logs.slice(0, maxLogLines),
    truncated: logs.length > maxLogLines
  };
}

function maskedErrorSummary(result: BuildCommandResult, secretValues: string[]): string {
  if (result.timedOut) {
    return `Build timed out after ${result.stderr.match(/after (\d+ms)/)?.[1] ?? 'the configured timeout'}.`;
  }

  return maskSensitiveText(
    result.stderr.trim().split('\n').find(Boolean) ?? `Build exited with code ${result.exitCode}`,
    secretValues
  );
}

function maskSensitiveText(text: string, extraSecretValues: string[]): string {
  const secrets = [
    ...Object.entries(process.env)
      .filter(([key, value]) => value && value.length >= 4 && SENSITIVE_ENV_KEY_PATTERN.test(key))
      .map(([, value]) => value as string),
    ...extraSecretValues
  ]
    .filter((value) => value.length >= 4)
    .sort((a, b) => b.length - a.length);

  let masked = text;
  for (const secret of secrets) {
    masked = masked.split(secret).join('[REDACTED]');
  }

  return masked.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}
