import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aiManifestSchema, type ManifestEditableField } from '@atoms-cp/shared';

const supportedEditableFields = new Set<ManifestEditableField>(['text', 'className', 'styleTokens', 'props']);
const textLikeEditableFields = new Set(['content', 'copy', 'item', 'items', 'label', 'labels', 'title', 'value']);
const classLikeEditableFields = new Set(['class', 'classes', 'classname']);
const styleLikeEditableFields = new Set(['style', 'styles', 'styletokens', 'theme', 'tokens']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEditableField(value: unknown): ManifestEditableField | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  if (supportedEditableFields.has(normalized as ManifestEditableField)) {
    return normalized as ManifestEditableField;
  }

  const key = normalized.replace(/[\s_-]+/g, '').toLowerCase();

  if (textLikeEditableFields.has(key)) {
    return 'text';
  }

  if (classLikeEditableFields.has(key)) {
    return 'className';
  }

  if (styleLikeEditableFields.has(key)) {
    return 'styleTokens';
  }

  return 'text';
}

function normalizeEditableFields(value: unknown): ManifestEditableField[] {
  const fields = Array.isArray(value) ? value : [];
  const normalized = fields
    .map((field) => normalizeEditableField(field))
    .filter((field): field is ManifestEditableField => Boolean(field));
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : ['text'];
}

export async function normalizeAndValidateAiManifest(input: {
  workspacePath: string;
  errorMessage: string;
}): Promise<void> {
  try {
    const manifestPath = join(input.workspacePath, 'ai-manifest.json');
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown;

    if (!isRecord(parsed) || !isRecord(parsed.entries)) {
      throw new Error('Invalid manifest shape.');
    }

    const entries = Object.fromEntries(Object.entries(parsed.entries).map(([aiId, entry]) => {
      if (!isRecord(entry)) {
        return [aiId, entry];
      }

      return [
        aiId,
        {
          ...entry,
          editable: normalizeEditableFields(entry.editable)
        }
      ];
    }));
    const manifest = aiManifestSchema.parse({
      ...parsed,
      entries
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch {
    throw new Error(input.errorMessage);
  }
}
