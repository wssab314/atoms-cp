import {
  supabaseSchemaSqlResponseSchema,
  type AppSpec,
  type AppSpecDataModelField,
  type SupabaseSchemaSqlResponse
} from '@atoms-cp/shared';

const reservedColumnNames = new Set(['id', 'created_at', 'updated_at']);

export function generateSupabaseSchemaSql(projectId: string, appSpec: AppSpec): SupabaseSchemaSqlResponse {
  if (appSpec.dataModels.length === 0) {
    return supabaseSchemaSqlResponseSchema.parse({
      projectId,
      tables: [],
      sql: [
        '-- No App Spec data models were defined yet.',
        '-- This SQL is not a migration system. Copy it into Supabase SQL editor only after review.',
        '-- Confirm a spec with dataModels before creating Supabase tables.'
      ].join('\n'),
      warnings: [
        'No data models found in the latest App Spec.',
        'This SQL is not a migration system; review before running.'
      ]
    });
  }

  const warnings: string[] = ['This SQL is not a migration system; review before running.'];
  const tables = appSpec.dataModels.map((model) => pluralizeIdentifier(toSnakeIdentifier(model.name)));
  const tableBlocks = appSpec.dataModels.map((model, index) => {
    const tableName = tables[index] ?? pluralizeIdentifier(toSnakeIdentifier(model.name));
    const columns = model.fields
      .map((field) => renderColumn(field, warnings))
      .filter((line): line is string => Boolean(line));

    return [
      `create table if not exists public.${tableName} (`,
      '  id uuid primary key default gen_random_uuid(),',
      ...columns.map((line) => `  ${line},`),
      '  created_at timestamptz not null default now(),',
      '  updated_at timestamptz not null default now()',
      ');',
      '',
      `alter table public.${tableName} enable row level security;`,
      '',
      `-- Review and tighten policies for ${tableName} before production use.`,
      `-- Example read policy: create policy "${tableName}_authenticated_read" on public.${tableName}`,
      '--   for select to authenticated using (true);'
    ].join('\n');
  });

  return supabaseSchemaSqlResponseSchema.parse({
    projectId,
    tables,
    sql: [
      '-- Generated from the confirmed App Spec. Review before running in Supabase SQL editor.',
      '-- This SQL is not a migration system. Copy it into Supabase SQL editor only after review.',
      '-- Row Level Security is enabled, but production policies must be designed explicitly.',
      'create extension if not exists "pgcrypto";',
      '',
      ...tableBlocks
    ].join('\n'),
    warnings
  });
}

function renderColumn(field: AppSpecDataModelField, warnings: string[]): string | undefined {
  const name = toSnakeIdentifier(field.name);

  if (reservedColumnNames.has(name)) {
    return undefined;
  }

  const type = toPostgresType(field, warnings);
  const required = field.required ? ' not null' : '';
  return `${name} ${type}${required}`;
}

function toPostgresType(field: AppSpecDataModelField, warnings: string[]): string {
  switch (field.type) {
    case 'string':
      return 'text';
    case 'number':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'datetime':
      return 'timestamptz';
    case 'enum':
      warnings.push(`Field ${field.name} was mapped from enum to text; add a check constraint if needed.`);
      return 'text';
    case 'relation':
      warnings.push(`Field ${field.name} was mapped from relation to uuid; add a foreign key after reviewing ownership.`);
      return 'uuid';
    default:
      return 'text';
  }
}

function pluralizeIdentifier(identifier: string): string {
  if (identifier.endsWith('s')) {
    return identifier;
  }

  if (identifier.endsWith('y') && !/[aeiou]y$/.test(identifier)) {
    return `${identifier.slice(0, -1)}ies`;
  }

  return `${identifier}s`;
}

function toSnakeIdentifier(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const identifier = normalized || 'item';
  return /^\d/.test(identifier) ? `app_${identifier}` : identifier;
}
