#!/usr/bin/env sh
set -eu

secret_file="${CODEX_SECRET_FILE:-/run/secrets/codex_api_key}"
codex_home="${CODEX_HOME:-/tmp/atoms-cp-codex-home}"
profile_name="${CODEX_PROFILE_NAME:-doubao21}"
provider_name="volcengine_doubao21"
model="${CODEX_DOUBAO_MODEL:-doubao-seed-2-1-turbo-260628}"
base_url="${CODEX_DOUBAO_BASE_URL:-https://ark.cn-beijing.volces.com/api/v3}"
project_dir="${CODEX_PROJECT_DIR:-/workspace/project}"

case "$secret_file" in
  /*) ;;
  *)
    echo "CODEX_SECRET_FILE must be an absolute mounted secret path." >&2
    exit 64
    ;;
esac

if [ ! -r "$secret_file" ]; then
  echo "Codex provider secret file is not readable." >&2
  exit 66
fi

case "$project_dir" in
  /*) ;;
  *)
    echo "CODEX_PROJECT_DIR must be an absolute workspace path." >&2
    exit 64
    ;;
esac

if [ ! -d "$project_dir" ]; then
  echo "Codex project directory is not available." >&2
  exit 66
fi

mkdir -p "$codex_home"
umask 077
config_file="$codex_home/${profile_name}.config.toml"

cat > "$config_file" <<EOF
model = "$model"
model_provider = "$provider_name"

[model_providers.$provider_name]
name = "Volcengine Ark Doubao 2.1"
base_url = "$base_url"
env_key = "VOLCENGINE_API_KEY"
wire_api = "responses"
EOF

provider_token="$(tr -d '\r\n' < "$secret_file")"

if [ -z "$provider_token" ]; then
  echo "Codex provider secret file is empty." >&2
  exit 66
fi

export CODEX_HOME="$codex_home"
export VOLCENGINE_API_KEY="$provider_token"
unset provider_token
unset CODEX_SECRET_FILE

if [ -n "${CODEX_TASK_INSTRUCTION_FILE:-}" ]; then
  if [ ! -r "$CODEX_TASK_INSTRUCTION_FILE" ]; then
    echo "Codex task instruction file is not readable." >&2
    exit 66
  fi
  instruction_path="$CODEX_TASK_INSTRUCTION_FILE"
  echo 'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"read_task","status":"progress","message":"正在读取任务说明。"}'
  prompt="${CODEX_REAL_PROMPT:-You are the atoms-cp implementation agent. Read the structured task instruction file at $instruction_path before editing. Implement the requested app inside $project_dir only. The workspace starts from a controlled scaffold, so you must make concrete product-specific edits to at least one allowed file, preferably src/App.tsx, src/styles/tokens.css, and ai-manifest.json. Do not run package installation, dependency installation, build, typecheck, test, dev server, or preview commands. Do not create node_modules, dist, lockfiles, caches, or hidden configuration files. The platform validates and builds after you exit. Preserve data-ai-id attributes, keep ai-manifest.json valid, edit only allowed source/public/root app files, and avoid implementation jargon in user-facing copy. Finish as soon as source edits are complete; do not wait for local validation. Do not finish with no file changes.}"
else
  prompt="${CODEX_REAL_PROMPT:-You are running the atoms-cp real canary. Make one small, safe improvement inside $project_dir. Only edit allowed source files, preserve data-ai-id attributes, keep ai-manifest.json valid, and avoid implementation jargon in user-facing copy. Do not run package installation, build, typecheck, test, dev server, or preview commands. Do not create node_modules, dist, lockfiles, caches, or hidden configuration files. Finish as soon as source edits are complete. Do not finish with no file changes.}"
fi

if [ "${CODEX_CONTAINER_EXECUTION:-}" = "1" ]; then
  sandbox_args="--dangerously-bypass-approvals-and-sandbox"
else
  sandbox_args="--sandbox workspace-write"
fi

echo 'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"analyze_app","status":"progress","message":"正在分析当前应用结构。"}'
echo 'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"edit_app","status":"progress","message":"正在修改页面内容。"}'
echo 'ATOMS_PROGRESS {"stage":"coding_app","stepKey":"update_manifest","status":"progress","message":"正在更新可编辑元素标记。"}'
echo 'ATOMS_PROGRESS {"stage":"validating","stepKey":"check_result","status":"progress","message":"正在检查生成结果。"}'

exec codex exec \
  --profile "$profile_name" \
  --cd "$project_dir" \
  --skip-git-repo-check \
  -c shell_environment_policy.inherit=none \
  -c approval_policy=\"never\" \
  $sandbox_args \
  --ephemeral \
  "$prompt"
