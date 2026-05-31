#!/usr/bin/env bash
# Deploy the game to the STAGING cluster.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
exec "$REPO_ROOT/scripts/_deploy.sh" staging
