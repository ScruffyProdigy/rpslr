#!/usr/bin/env bash
# One-time setup: copy .env, install api + client dependencies.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

log "Setting up the Rock Paper Scissors demo game..."

if [ ! -f "$REPO_ROOT/.env" ]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  ok "Created .env from .env.example"
else
  info ".env already exists — leaving it untouched"
fi

# Node version check (advisory).
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 20 ]; then
  warn "Node ${node_major} detected. This project targets Node 20 LTS."
fi

log "Installing API dependencies..."
(cd "$REPO_ROOT/api" && npm install)
ok "API deps installed"

log "Installing client dependencies..."
(cd "$REPO_ROOT/client" && npm install)
ok "Client deps installed"

ok "Setup complete. Next: ${C_BOLD}./scripts/dev.sh${C_RESET}"
