#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';

const progressMessages = {
  readTask: '正在读取任务说明。',
  analyzeApp: '正在分析当前应用结构。',
  editApp: '正在修改页面内容。',
  updateManifest: '正在更新可编辑元素标记。',
  checkResult: '正在检查生成结果。',
  collectOutput: '正在收集修改结果。'
};

const ignoredParts = new Set(['node_modules', 'dist', '.git']);
const deniedExactPaths = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts'
]);
const taroComponentImports = new Set([
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

function emitProgress(stepKey, message, stage = 'coding_app') {
  console.log(`ATOMS_PROGRESS ${JSON.stringify({
    stage,
    stepKey,
    status: 'progress',
    message
  })}`);
}

function fail(message, cause) {
  const suffix = cause instanceof Error && cause.message ? ` ${cause.message}` : '';
  console.error(`${message}${suffix}`);
  process.exit(1);
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    fail(`${name} is required.`);
  }

  return value;
}

function toPosixPath(value) {
  return value.split(sep).join('/');
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\0') || isAbsolute(value)) {
    return undefined;
  }

  const normalized = posix.normalize(value.replace(/\\/g, '/'));

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return undefined;
  }

  return normalized;
}

function matchesPattern(filePath, pattern) {
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

function isDeniedPath(filePath, instruction) {
  const parts = filePath.split('/');

  if (parts.some((part) => ignoredParts.has(part) || part.startsWith('.env'))) {
    return true;
  }

  if (deniedExactPaths.has(filePath)) {
    return true;
  }

  return (instruction.forbiddenPaths ?? []).some((pattern) => matchesPattern(filePath, pattern));
}

function assertAllowedOutputPath(filePath, instruction) {
  const normalized = normalizeRelativePath(filePath);

  if (!normalized) {
    throw new Error('Model returned an unsafe file path.');
  }

  if (instruction.taskSpec?.platform === 'mini_program' && normalized === 'src/App.tsx') {
    throw new Error('Taro mini program output must not create src/App.tsx.');
  }

  if (isDeniedPath(normalized, instruction)) {
    throw new Error(`Model returned a denied file path: ${normalized}`);
  }

  const allowed = (instruction.allowedPaths ?? instruction.taskSpec?.allowedPaths ?? [])
    .some((pattern) => matchesPattern(normalized, pattern));

  if (!allowed) {
    throw new Error(`Model returned a file outside allowed paths: ${normalized}`);
  }

  return normalized;
}

async function collectWorkspaceContext(root, instruction) {
  const files = [];

  async function walk(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredParts.has(entry.name)) {
        continue;
      }

      const absolutePath = join(currentPath, entry.name);
      const relativePath = toPosixPath(relative(root, absolutePath));

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const normalized = normalizeRelativePath(relativePath);

      if (!normalized || isDeniedPath(normalized, instruction)) {
        continue;
      }

      const allowed = (instruction.allowedPaths ?? instruction.taskSpec?.allowedPaths ?? [])
        .some((pattern) => matchesPattern(normalized, pattern));

      if (!allowed) {
        continue;
      }

      if (!/\.(tsx?|jsx?|css|json|html)$/.test(normalized)) {
        continue;
      }

      files.push({
        path: normalized,
        content: await readFile(absolutePath, 'utf8')
      });
    }
  }

  await walk(root);

  const preferred = instruction.taskSpec?.platform === 'mini_program'
    ? [
        'src/pages/index/index.tsx',
        'src/pages/index/index.css',
        'src/pages/index/index.config.ts',
        'src/app.config.ts',
        'ai-manifest.json'
      ]
    : [
        'src/App.tsx',
        'src/styles/tokens.css',
        'src/main.tsx',
        'index.html',
        'ai-manifest.json'
      ];
  const preferredSet = new Set(preferred);
  const sorted = files.sort((a, b) => {
    const aScore = preferredSet.has(a.path) ? 0 : 1;
    const bScore = preferredSet.has(b.path) ? 0 : 1;
    return aScore - bScore || a.path.localeCompare(b.path);
  });
  let budget = 70_000;
  const selected = [];

  for (const file of sorted) {
    const cost = file.path.length + file.content.length;

    if (selected.length > 0 && cost > budget) {
      continue;
    }

    selected.push(file);
    budget -= cost;

    if (budget <= 0) {
      break;
    }
  }

  return selected;
}

function parseJsonObject(text) {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const direct = tryParseJson(withoutFence);

  if (direct) {
    return direct;
  }

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start >= 0 && end > start) {
    const sliced = withoutFence.slice(start, end + 1)
      .replace(/,\s*([}\]])/g, '$1');
    const parsed = tryParseJson(sliced);

    if (parsed) {
      return parsed;
    }
  }

  throw new Error('Model did not return valid JSON.');
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function normalizeEditable(value) {
  const aliases = new Map([
    ['text', 'text'],
    ['copy', 'text'],
    ['content', 'text'],
    ['title', 'text'],
    ['label', 'text'],
    ['class', 'className'],
    ['classname', 'className'],
    ['classes', 'className'],
    ['style', 'styleTokens'],
    ['styles', 'styleTokens'],
    ['styletokens', 'styleTokens'],
    ['props', 'props'],
    ['property', 'props']
  ]);
  const values = Array.isArray(value) ? value : ['text'];
  const normalized = values
    .map((item) => aliases.get(String(item).replace(/[\s_-]+/g, '').toLowerCase()) ?? 'text');

  return Array.from(new Set(normalized)).filter((item) =>
    ['text', 'className', 'styleTokens', 'props'].includes(item)
  );
}

function normalizeManifestContent(content, instruction) {
  const parsed = parseJsonObject(content);
  const rawEntries = Array.isArray(parsed.entries)
    ? Object.fromEntries(parsed.entries.map((entry) => [entry.aiId, entry]))
    : parsed.entries;

  if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
    throw new Error('Manifest entries must be an object keyed by aiId.');
  }

  const entries = {};

  for (const [key, rawEntry] of Object.entries(rawEntries)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error('Manifest entry must be an object.');
    }

    const aiId = String(rawEntry.aiId ?? key).trim();
    const rawFile = String(rawEntry.file ?? '');
    const manifestFile = instruction.taskSpec?.platform === 'mini_program' && ['src/App.tsx', 'src/app.tsx'].includes(rawFile)
      ? 'src/pages/index/index.tsx'
      : rawFile;
    const file = assertAllowedOutputPath(manifestFile, instruction);

    entries[aiId] = {
      aiId,
      file,
      component: instruction.taskSpec?.platform === 'mini_program' && ['src/App.tsx', 'src/app.tsx'].includes(rawFile)
        ? 'Index'
        : String(rawEntry.component ?? (instruction.taskSpec?.platform === 'mini_program' ? 'Index' : 'App')),
      elementType: String(rawEntry.elementType ?? 'section'),
      editable: normalizeEditable(rawEntry.editable),
      ...(rawEntry.requirementId ? { requirementId: String(rawEntry.requirementId) } : {})
    };
  }

  return `${JSON.stringify({ entries }, null, 2)}\n`;
}

function buildSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'files'],
    properties: {
      summary: {
        type: 'string'
      },
      files: {
        type: 'array',
        minItems: 2,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['path', 'content'],
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          }
        }
      }
    }
  };
}

function importExportedName(specifier) {
  return specifier.trim().split(/\s+as\s+/i)[0]?.trim() ?? '';
}

function splitTaroNamedImports(namedImports) {
  const componentImports = [];
  const taroImports = [];

  for (const rawImport of namedImports.split(',')) {
    const specifier = rawImport.trim();

    if (!specifier) {
      continue;
    }

    if (taroComponentImports.has(importExportedName(specifier))) {
      componentImports.push(specifier);
    } else {
      taroImports.push(specifier);
    }
  }

  return { componentImports, taroImports };
}

function renderTaroImportFix(defaultImport, namedImports) {
  const { componentImports, taroImports } = splitTaroNamedImports(namedImports);
  const lines = [];

  if (defaultImport || taroImports.length > 0) {
    const defaultPart = defaultImport ? defaultImport.trim() : '';
    const namedPart = taroImports.length > 0 ? `{ ${taroImports.join(', ')} }` : '';
    const separator = defaultPart && namedPart ? ', ' : '';
    lines.push(`import ${defaultPart}${separator}${namedPart} from '@tarojs/taro';`);
  }

  if (componentImports.length > 0) {
    lines.push(`import { ${componentImports.join(', ')} } from '@tarojs/components';`);
  }

  return lines.join('\n');
}

function normalizeTaroSourceContent(content) {
  return content
    .replace(
      /import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s*from\s*['"]@tarojs\/taro['"];?/g,
      (_match, defaultImport, namedImports) => renderTaroImportFix(defaultImport, namedImports)
    )
    .replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]@tarojs\/taro['"];?/g,
      (_match, namedImports) => renderTaroImportFix('', namedImports)
    );
}

function normalizeGeneratedSourceContent(filePath, content, instruction) {
  if (instruction.taskSpec?.platform === 'mini_program' && /\.(tsx?|jsx?)$/.test(filePath)) {
    return normalizeTaroSourceContent(content);
  }

  return content;
}

function buildSystemPrompt(platform) {
  const platformRules = platform === 'mini_program'
    ? [
        'You are editing a Taro React WeChat Mini Program.',
        'Use only @tarojs/components, @tarojs/taro, @tarojs/react, react, and react-dom imports.',
        'Import JSX components such as View, Text, Image, Button, ScrollView, Input, Textarea, and Picker only from @tarojs/components.',
        'Import Taro APIs such as navigateTo, showToast, makePhoneCall, and hooks only from @tarojs/taro.',
        'Primary page edits should be in src/pages/index/index.tsx and src/pages/index/index.css.',
        'Do not create src/App.tsx. Taro uses src/app.tsx and page files.',
        'Every ai-manifest.json entry file must point to a real edited Taro source file, usually src/pages/index/index.tsx.'
      ]
    : [
        'You are editing a React/Vite web app.',
        'Use only react, react-dom, react-router-dom, lucide-react, recharts, @tanstack/react-table, react-hook-form, zod, clsx, date-fns, and framer-motion imports.',
        'Primary app edits should be in src/App.tsx and src/styles/tokens.css.'
      ];

  return [
    'You are an implementation agent for atoms-cp.',
    'Return one JSON object only. No markdown. No explanations outside JSON.',
    ...platformRules,
    'Write complete file contents, not patches.',
    'Keep user-facing text specific to the requested app; avoid generic placeholder copy.',
    'Preserve or add data-ai-id attributes for editable elements.',
    'ai-manifest.json must have shape {"entries":{"ai-id":{"aiId":"ai-id","file":"src/...","component":"...","elementType":"...","editable":["text"]}}}.',
    'Do not edit dependency files, lockfiles, config files, build output, hidden files, or package manifests.',
    'Do not include secrets, internal paths, command output, or implementation jargon in user-facing copy.'
  ].join('\n');
}

function buildUserPrompt(instruction, contextFiles) {
  const taskSpec = instruction.taskSpec ?? {};
  const context = contextFiles.map((file) => [
    `--- ${file.path}`,
    file.content
  ].join('\n')).join('\n\n');

  return JSON.stringify({
    task: {
      taskType: instruction.taskType,
      objective: instruction.objective,
      inputSummary: instruction.inputSummary,
      goal: taskSpec.goal,
      appSpec: taskSpec.appSpec,
      designProfile: taskSpec.designProfile,
      targetChange: taskSpec.targetChange,
      platform: taskSpec.platform,
      allowedPaths: instruction.allowedPaths ?? taskSpec.allowedPaths,
      forbiddenPaths: instruction.forbiddenPaths ?? taskSpec.forbiddenPaths,
      dependencyPolicy: instruction.dependencyPolicy
    },
    currentFiles: context
  });
}

async function callModel(input) {
  const response = await fetch(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      max_tokens: Number.parseInt(process.env.CODEX_CHAT_CODEGEN_MAX_TOKENS ?? '12000', 10),
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'atoms_cp_generated_files',
          strict: true,
          schema: buildSchema()
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Model request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Model returned an empty response.');
  }

  return parseJsonObject(content);
}

async function main() {
  const projectDir = requiredEnv('CODEX_PROJECT_DIR');
  const secretFile = requiredEnv('CODEX_SECRET_FILE');
  const taskInstructionFile = requiredEnv('CODEX_TASK_INSTRUCTION_FILE');
  const model = process.env.CODEX_DOUBAO_MODEL?.trim() || 'doubao-seed-2-1-turbo-260628';
  const baseUrl = process.env.CODEX_DOUBAO_BASE_URL?.trim() || 'https://ark.cn-beijing.volces.com/api/v3';

  if (!isAbsolute(projectDir) || !isAbsolute(secretFile) || !isAbsolute(taskInstructionFile)) {
    fail('Project, secret, and task instruction paths must be absolute.');
  }

  emitProgress('read_task', progressMessages.readTask);
  const [secret, instruction] = await Promise.all([
    readFile(secretFile, 'utf8'),
    readFile(taskInstructionFile, 'utf8').then((value) => JSON.parse(value))
  ]);
  const apiKey = secret.replace(/\r?\n/g, '').trim();

  if (!apiKey) {
    fail('Provider secret file is empty.');
  }

  emitProgress('analyze_app', progressMessages.analyzeApp);
  const contextFiles = await collectWorkspaceContext(projectDir, instruction);
  const platform = instruction.taskSpec?.platform ?? 'web';

  emitProgress('edit_app', progressMessages.editApp);
  const generated = await callModel({
    apiKey,
    model,
    baseUrl,
    system: buildSystemPrompt(platform),
    user: buildUserPrompt(instruction, contextFiles)
  });

  if (!Array.isArray(generated.files) || generated.files.length === 0) {
    throw new Error('Model returned no files to write.');
  }

  emitProgress('update_manifest', progressMessages.updateManifest);
  const normalizedFiles = generated.files.map((file) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error('Generated file entry must be an object.');
    }

    const filePath = assertAllowedOutputPath(file.path, instruction);
    const content = String(file.content ?? '');

    if (!content.trim()) {
      throw new Error(`Generated file is empty: ${filePath}`);
    }

    return {
      path: filePath,
      content: filePath === 'ai-manifest.json'
        ? normalizeManifestContent(content, instruction)
        : normalizeGeneratedSourceContent(filePath, content, instruction)
    };
  });

  if (!normalizedFiles.some((file) => file.path === 'ai-manifest.json')) {
    throw new Error('Model must update ai-manifest.json.');
  }

  emitProgress('check_result', progressMessages.checkResult, 'validating');

  for (const file of normalizedFiles) {
    const absolutePath = join(projectDir, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.content, 'utf8');
  }

  emitProgress('collect_output', progressMessages.collectOutput);
}

main().catch((error) => {
  fail('Doubao code generation failed.', error);
});
