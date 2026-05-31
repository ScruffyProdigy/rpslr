#!/usr/bin/env bash
# Start the full local dev stack: game postgres + migrate + API (:3001) + Vite (:5174).
# Mirrors Lobby's dev.sh: traps SIGINT to clean up children, prints URLs.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

CHILD_PIDS=()

cleanup() {
  echo
  log "Shutting down dev stack..."
  for pid in "${CHILD_PIDS[@]:-}"; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  ok "Stopped API + client. (Postgres left running — './scripts/db.sh down' to stop it.)"
  exit 0
}
trap cleanup INT TERM

# 1. Pre-flight port checks (clear error if Lobby or stale procs hold them).
require_free_port "$API_PORT" "game API"
require_free_port "5174" "game frontend"

# 2. Postgres + migrations.
"$REPO_ROOT/scripts/db.sh" up
"$REPO_ROOT/scripts/db.sh" migrate

# 3. API (background).
log "Starting API on :${API_PORT}..."
(cd "$REPO_ROOT/api" && npm run dev) &
CHILD_PIDS+=($!)

# 4. Client (background).
log "Starting client (Vite) on :5174..."
(cd "$REPO_ROOT/client" && npm run dev) &
CHILD_PIDS+=($!)

sleep 2
echo
ok "Dev stack is up:"
printf "   ${C_BOLD}Game UI${C_RESET}     %s\n" "http://localhost:5174"
printf "   ${C_BOLD}Game API${C_RESET}    %s\n" "http://localhost:${API_PORT}  (try /healthz, /api/v1/status)"
printf "   ${C_BOLD}Postgres${C_RESET}    %s\n" "localhost:${POSTGRES_PORT} (db=${POSTGRES_DB})"
printf "   ${C_BOLD}Lobby${C_RESET}       %s\n" "http://localhost:5173  (separate repo)"
echo
info "Press Ctrl+C to stop the API and client."

# Keep the script alive while children run.
wait
