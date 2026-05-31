#!/usr/bin/env bash
# Deploy the game to the PRODUCTION cluster. Prompts for confirmation.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

warn "You are about to deploy to PRODUCTION."
read -r -p "Type 'production' to continue: " confirm
[ "$confirm" = "production" ] || die "Aborted."

exec "$REPO_ROOT/scripts/_deploy.sh" production
