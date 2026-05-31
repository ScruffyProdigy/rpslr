#!/usr/bin/env bash
# Manage the game's own Postgres (port 5433). Subcommands mirror Lobby's db.sh.
#   ./scripts/db.sh up       start postgres (docker compose)
#   ./scripts/db.sh down      stop postgres
#   ./scripts/db.sh migrate   run SQL migrations
#   ./scripts/db.sh reset     drop volume + recreate + migrate
#   ./scripts/db.sh url        print the DATABASE_URL
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_env

wait_for_pg() {
  log "Waiting for Postgres on :${POSTGRES_PORT}..."
  for _ in $(seq 1 30); do
    if dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      ok "Postgres is ready."
      return 0
    fi
    sleep 1
  done
  die "Postgres did not become ready in time."
}

cmd="${1:-}"
case "$cmd" in
  up)
    # Idempotent: if the game's own Postgres container is already up and healthy,
    # don't trip the port-in-use check on ourselves — just reuse it.
    if [ -n "$(cd "$REPO_ROOT" && dc ps -q postgres 2>/dev/null)" ] \
      && dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      ok "Game Postgres already running (host port ${POSTGRES_PORT})."
    else
      require_free_port "$POSTGRES_PORT" "game postgres"
      log "Starting game Postgres (host port ${POSTGRES_PORT})..."
      (cd "$REPO_ROOT" && dc up -d postgres)
      wait_for_pg
    fi
    ;;
  down)
    log "Stopping game Postgres..."
    (cd "$REPO_ROOT" && dc down)
    ok "Stopped."
    ;;
  migrate)
    log "Running migrations against ${DATABASE_URL}..."
    (cd "$REPO_ROOT/api" && npm run migrate)
    ok "Migrations complete."
    ;;
  reset)
    warn "Destroying game database volume and recreating..."
    (cd "$REPO_ROOT" && dc down -v)
    (cd "$REPO_ROOT" && dc up -d postgres)
    wait_for_pg
    (cd "$REPO_ROOT/api" && npm run migrate)
    ok "Database reset and migrated."
    ;;
  url)
    echo "$DATABASE_URL"
    ;;
  *)
    err "Unknown command: '${cmd}'"
    echo "Usage: $0 {up|down|migrate|reset|url}"
    exit 1
    ;;
esac
