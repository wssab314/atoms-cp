import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';

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

export interface BuildProjectLogLine {
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}

export interface BuildProjectPreviewInput {
  buildJobId: string;
  projectFiles: BuildProjectFile[];
  previewRoot: string;
  workspaceRoot: string;
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
const SENSITIVE_ENV_KEY_PATTERN = /(API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL|DATABASE_URL|REDIS_URL|SUPABASE|DEEPSEEK|GITHUB|VERCEL)/i;

export async function buildProjectPreview(input: BuildProjectPreviewInput): Promise<BuildProjectPreviewResult> {
  const workspace = input.workspaceRoot;
  const previewPath = join(input.previewRoot, input.buildJobId);
  const logs: BuildProjectLogLine[] = [];
  const maxBuildMs = input.maxBuildMs ?? DEFAULT_BUILD_TIMEOUT_MS;
  const maxLogLines = input.maxLogLines ?? DEFAULT_MAX_LOG_LINES;
  const cleanupWorkspace = input.cleanupWorkspace ?? true;

  try {
    await rm(workspace, { recursive: true, force: true });
    await rm(previewPath, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await mkdir(join(workspace, 'dist'), { recursive: true });
    await mkdir(input.previewRoot, { recursive: true });

    for (const file of input.projectFiles) {
      const targetPath = safeJoin(workspace, file.path);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, file.content, 'utf8');
    }

    const runCommand = input.runCommand ?? runPnpmBuild;
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

  if (!targetPath.startsWith(rootPath)) {
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
