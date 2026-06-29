import {
  supabaseConnectionTestResultSchema,
  type SupabaseConfigRecord,
  type SupabaseConnectionTestResult
} from '@atoms-cp/shared';

const defaultTimeoutMs = 5000;

interface TestSupabaseConnectionOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export async function testSupabaseConnection(
  projectId: string,
  config: SupabaseConfigRecord | undefined,
  options: TestSupabaseConnectionOptions = {}
): Promise<SupabaseConnectionTestResult> {
  const now = options.now ?? (() => new Date());

  if (!config?.supabaseUrl || !config.anonKey) {
    return supabaseConnectionTestResultSchema.parse({
      projectId,
      status: 'blocked',
      detail: 'Supabase URL and anon key are required before testing.',
      checkedAt: now().toISOString()
    });
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (!fetchImpl) {
    return supabaseConnectionTestResultSchema.parse({
      projectId,
      status: 'failed',
      detail: 'Runtime fetch is not available for Supabase connection testing.',
      checkedAt: now().toISOString()
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? defaultTimeoutMs);

  try {
    const response = await fetchImpl(toSupabaseRestUrl(config.supabaseUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`
      },
      signal: controller.signal
    });

    if (response.ok) {
      return supabaseConnectionTestResultSchema.parse({
        projectId,
        status: 'passed',
        detail: 'Supabase REST endpoint accepted the anon key.',
        httpStatus: response.status,
        checkedAt: now().toISOString()
      });
    }

    return supabaseConnectionTestResultSchema.parse({
      projectId,
      status: 'failed',
      detail: `Supabase REST endpoint returned HTTP ${response.status}.`,
      httpStatus: response.status,
      checkedAt: now().toISOString()
    });
  } catch (error) {
    return supabaseConnectionTestResultSchema.parse({
      projectId,
      status: 'failed',
      detail: error instanceof DOMException && error.name === 'AbortError'
        ? 'Supabase REST endpoint test timed out.'
        : 'Supabase REST endpoint request failed.',
      checkedAt: now().toISOString()
    });
  } finally {
    clearTimeout(timeout);
  }
}

function toSupabaseRestUrl(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  url.pathname = '/rest/v1/';
  url.search = '';
  url.hash = '';
  return url.toString();
}
