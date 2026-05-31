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

log()   { printf "${C_CYAN}▶${C_RESET} %s\n" "$*"; }
info()  { printf "${C_BLUE}ℹ${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}⚠${C_RESET} %s\n" "$*"; }
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
