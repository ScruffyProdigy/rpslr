#!/usr/bin/env bash
# Run all tests (api + client) from the repo root using subshells so the
# caller's working directory is never left changed. Mirrors Lobby's test.sh.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

failed=0

log "Running API tests..."
if (cd "$REPO_ROOT/api" && npm test); then
  ok "API tests passed"
else
  err "API tests failed"
  failed=1
fi

echo
log "Running client tests..."
if (cd "$REPO_ROOT/client" && npm test); then
  ok "Client tests passed"
else
  err "Client tests failed"
  failed=1
fi

echo
if [ "$failed" -eq 0 ]; then
  ok "All tests passed."
else
  die "Some tests failed."
fi
