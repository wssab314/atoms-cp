import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('production deployment config', () => {
  it('keeps database and Redis outside the app stack and runs one app image as multiple services', async () => {
    const compose = await readFile(join(repoRoot, 'docker-compose.prod.yml'), 'utf8');

    expect(compose.match(/image: \$\{ATOMS_APP_IMAGE/g)).toHaveLength(4);
    expect(compose).not.toContain('ATOMS_WEB_IMAGE');
    expect(compose).not.toContain('ATOMS_API_IMAGE');
    expect(compose).not.toContain('ATOMS_BUILDER_WORKER_IMAGE');
    expect(compose).not.toContain('ATOMS_CODEX_WORKER_IMAGE');
    expect(compose).toContain('command: ["node", "scripts/serve-web-static.mjs"]');
    expect(compose).toContain('command: ["pnpm", "--filter", "@atoms-cp/api", "start"]');
    expect(compose).toContain('command: ["pnpm", "--filter", "@atoms-cp/builder-worker", "start"]');
    expect(compose).toContain('command: ["pnpm", "--filter", "@atoms-cp/api", "start:codex-worker"]');
    expect(compose).not.toContain('dockerfile:');
    expect(compose).not.toMatch(/^\s+postgres:\s*$/m);
    expect(compose).not.toMatch(/^\s+redis:\s*$/m);
    expect(compose).not.toContain('5432:5432');
    expect(compose).not.toContain('6379:6379');
    expect(compose).toContain('external: true');
    expect(compose).toContain('mem_limit:');
    expect(compose).toContain('max-size');
  });

  it('documents Caddy subdomain routing without owning 80/443 inside the app stack', async () => {
    const caddy = await readFile(join(repoRoot, 'infra/caddy/Caddyfile.atoms-cp.example'), 'utf8');

    expect(caddy).toContain('atoms.example.com');
    expect(caddy).toContain('atoms-api.example.com');
    expect(caddy).toContain('reverse_proxy atoms-cp-web:8080');
    expect(caddy).toContain('reverse_proxy atoms-cp-api:4000');
  });

  it('defines the atslab takeover stack as same-origin, closed-registration beta deployment', async () => {
    const compose = await readFile(join(repoRoot, 'docker-compose.atslab.yml'), 'utf8');
    const caddy = await readFile(join(repoRoot, 'infra/caddy/Caddyfile.atslab'), 'utf8');

    expect(compose.match(/image: \$\{ATOMS_APP_IMAGE/g)).toHaveLength(4);
    expect(compose).toContain('image: caddy:2.8-alpine');
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain('WEB_API_PROXY_ORIGIN: http://api:4000');
    expect(compose).toContain('LOCAL_AUTH_REGISTRATION_ENABLED: ${LOCAL_AUTH_REGISTRATION_ENABLED:-false}');
    expect(compose).toContain('CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST: ${CODEX_REAL_USER_TASK_EMAIL_ALLOWLIST:-test@atslab.top}');
    expect(compose).toContain('./secrets:/run/atoms-cp-secrets:ro');
    expect(compose).not.toContain('5432:5432');
    expect(compose).not.toContain('6379:6379');
    expect(caddy).toContain('atslab.top');
    expect(caddy).toContain('reverse_proxy web:8080');
  });

  it('keeps real Codex execution in an explicit staging canary override', async () => {
    const staging = await readFile(join(repoRoot, 'docker-compose.staging-canary.yml'), 'utf8');

    expect(staging).toContain('CODEX_REAL_CANARY_ENABLED: "true"');
    expect(staging).toContain('CODEX_REAL_PREFLIGHT_ONLY: "false"');
    expect(staging).toContain('CODEX_DOCKER_NETWORK_MODE: bridge');
    expect(staging).toContain('CODEX_SECRET_MOUNT_PATH: /run/secrets/codex_api_key');
    expect(staging).toContain('CODEX_REAL_COMMAND: ${CODEX_REAL_COMMAND:-/app/scripts/codex-doubao21-exec.sh}');
    expect(staging).toContain('CODEX_DOCKER_IMAGE: ${ATOMS_APP_IMAGE:');
    expect(staging).toContain('CODEX_EXECUTION_ENV_ALLOWLIST: CODEX_DOUBAO_MODEL,CODEX_DOUBAO_BASE_URL');
    expect(staging).not.toContain('VOLCENGINE_API_KEY');
    expect(staging).toContain('codex_api_key:');
    expect(staging).not.toContain('/var/run/docker.sock');
  });

  it('ships a Doubao 2.1 Codex profile wrapper without embedding provider secrets', async () => {
    const dockerfile = await readFile(join(repoRoot, 'apps/api/Dockerfile'), 'utf8');
    const wrapper = await readFile(join(repoRoot, 'scripts/codex-doubao21-exec.sh'), 'utf8');
    const workflow = await readFile(join(repoRoot, '.github/workflows/publish-images.yml'), 'utf8');

    expect(dockerfile).toContain('npm install -g @openai/codex@0.138.0');
    expect(dockerfile).toContain('pnpm --filter @atoms-cp/web build');
    expect(dockerfile).toContain('pnpm --filter @atoms-cp/builder-worker build');
    expect(workflow).toContain('atoms-cp-app');
    expect(wrapper).toContain('doubao-seed-2-1-turbo-260628');
    expect(wrapper).toContain('CODEX_TASK_INSTRUCTION_FILE');
    expect(wrapper).toContain('https://ark.cn-beijing.volces.com/api/v3');
    expect(wrapper).toContain('CODEX_DOUBAO_EXECUTOR:-chat_codegen');
    expect(wrapper).toContain('exec node /app/scripts/doubao-chat-codegen.mjs');
    expect(wrapper).toContain('env_key = "VOLCENGINE_API_KEY"');
    expect(wrapper).toContain('wire_api = "responses"');
    expect(wrapper).toContain('--profile "$profile_name"');
    expect(wrapper).toContain('-c shell_environment_policy.inherit=none');
    expect(wrapper).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(wrapper).not.toMatch(/VOLCENGINE_API_KEY=["'][^$]/);
    expect(wrapper).toContain('export VOLCENGINE_API_KEY="$provider_token"');
  });
});
