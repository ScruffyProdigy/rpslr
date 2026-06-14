#!/usr/bin/env bash
# Shared helpers for the game scripts: colored output, port checks, env loading.
# Source this from other scripts:  source "$(dirname "$0")/lib.sh"

set -euo pipefail

# ---- Colors (disabled when not a TTY) ---------------------------------------
if [ -t 1 ]; then
  C_RESET="\033[0m"; C_RED="\033[0;31m"; C_GREEN="\033[0;32m"
  C_YELLOW="\033[0;33m"; C_BLUE="\033[0;34m"; C_CYAN="\033[0;36m"; C_BOLD="\033[1m"
else
  C_RESET=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""; C_BOLD=""
fi

log()   { printf "${C_CYAN}▶${C_RESET} %s\n" "$*" >&2; }
info()  { printf "${C_BLUE}ℹ${C_RESET} %s\n" "$*" >&2; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$*" >&2; }
warn()  { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$*" >&2; }
err()   { printf "${C_RED}✗ %s${C_RESET}\n" "$*" >&2; }
die()   { err "$*"; exit 1; }

# Repo root = parent of the scripts directory.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ---- Load .env (if present) into the environment ----------------------------
load_env() {
  if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a
  else
    warn ".env not found — using defaults from .env.example values"
  fi
  # Defaults (kept in sync with .env.example)
  : "${API_PORT:=3001}"
  : "${POSTGRES_PORT:=5433}"
  : "${POSTGRES_USER:=rps}"
  : "${POSTGRES_PASSWORD:=rps_dev_password}"
  : "${POSTGRES_DB:=rps_game}"
  : "${DATABASE_URL:=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}}"
  export API_PORT POSTGRES_PORT POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DATABASE_URL
}

# ---- Fail fast if a port is already in use ----------------------------------
require_free_port() {
  local port="$1" label="$2"
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    err "Port ${port} (${label}) is already in use."
    err "Lobby uses 5173/8080/5432 — this game uses 5174/${API_PORT}/${POSTGRES_PORT}."
    err "Stop whatever is on :${port}, or change it in .env (e.g. POSTGRES_PORT), then retry."
    exit 1
  fi
}

# ---- docker compose wrapper (supports v1 and v2) ----------------------------
dc() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    die "docker compose not found. Install Docker Desktop or the compose plugin."
  fi
}

# Resolve a mutable tag to an immutable registry digest so GKE cannot reuse a
# cached layer from an earlier push (same tag, different content).
# Set PIN_IMAGE_DIGEST=false to skip (not recommended in production).
resolve_image_digest() {
  local ref=$1
  if [ "${PIN_IMAGE_DIGEST:-true}" != "true" ]; then
    echo "$ref"
    return
  fi
  if [[ "$ref" == *@sha256:* ]]; then
    echo "$ref"
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker not available — cannot pin digest for $ref"
    echo "$ref"
    return
  fi
  if ! docker image inspect "$ref" >/dev/null 2>&1; then
    log "Pulling $ref to resolve digest..."
    docker pull "$ref" >/dev/null
  fi
  local digest pinned
  digest=$(docker image inspect "$ref" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')
  if [ -z "$digest" ]; then
    warn "Pulling $ref (no local digest yet)..."
    docker pull "$ref" >/dev/null || true
    digest=$(docker image inspect "$ref" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')
  fi
  if [ -n "$digest" ]; then
    pinned="${ref%%@*}@${digest}"
    info "Pinned ${ref} → ${pinned}"
    echo "$pinned"
  else
    warn "Could not resolve digest for $ref — deployment may use a stale cached tag"
    echo "$ref"
  fi
}

pin_deployment_images() {
  local ns=$1 api_ref=$2 client_ref=$3
  log "Setting deployment images (digest-pinned when available)..."
  kubectl -n "$ns" set image deployment/rps-game-api api="$api_ref" migrate="$api_ref"
  kubectl -n "$ns" set image deployment/rps-game-client client="$client_ref"
}

# Refuse mutable :latest — both demo games historically shared registry repos.
assert_safe_image_tag() {
  local tag=$1
  if [ -z "$tag" ]; then
    die "IMAGE_TAG is empty — set an explicit per-game tag (see scripts/game-k8s.defaults.sh)."
  fi
  if [ "$tag" = "latest" ] && [ "${ALLOW_LATEST_TAG:-false}" != "true" ]; then
    die "IMAGE_TAG=:latest is forbidden (cross-game deploy risk). Use DEFAULT_IMAGE_TAG from game-k8s.defaults.sh or set ALLOW_LATEST_TAG=true to override."
  fi
}

game_status_json_field() {
  local json=$1 field=$2
  if command -v python3 >/dev/null 2>&1; then
    GAME_STATUS_JSON="$json" GAME_STATUS_FIELD="$field" python3 - <<'PY'
import json, os
data = json.loads(os.environ["GAME_STATUS_JSON"])
print(data[os.environ["GAME_STATUS_FIELD"]])
PY
    return
  fi
  echo "$json" | sed -n "s/.*\"${field}\":\"\\([^\"]*\\)\".*/\\1/p" | head -1
}

# After rollout, confirm the running API identifies as the expected game.
verify_deployed_game_identity() {
  local ns=$1 expected_game=$2 public_host=${3:-}
  local json actual=""

  if [ -n "$public_host" ] && command -v curl >/dev/null 2>&1; then
    json=$(curl -sfS "https://${public_host}/api/v1/status" 2>/dev/null || true)
    if [ -n "$json" ]; then
      actual=$(game_status_json_field "$json" game)
    fi
  fi

  if [ -z "$actual" ]; then
    json=$(kubectl exec -n "$ns" deploy/rps-game-api -- wget -qO- http://localhost:3001/api/v1/status 2>/dev/null || true)
    if [ -n "$json" ]; then
      actual=$(game_status_json_field "$json" game)
    fi
  fi

  if [ -z "$actual" ]; then
    die "Could not read /api/v1/status for namespace ${ns} (host=${public_host:-in-cluster})."
  fi
  if [ "$actual" != "$expected_game" ]; then
    die "Wrong game running in ${ns}: status.game=${actual}, expected ${expected_game}. Check IMAGE_TAG and registry repo."
  fi
  ok "Verified ${ns} serves game=${actual}${public_host:+ at https://${public_host}}"
}
