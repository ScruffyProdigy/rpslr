#!/usr/bin/env bash
# Non-interactive GKE deploy for production (namespace rps-game, https://rpsls-duel.win).
set -euo pipefail
exec "$(dirname "${BASH_SOURCE[0]}")/_deploy.sh" production
