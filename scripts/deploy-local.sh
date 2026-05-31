#!/usr/bin/env bash
# Deploy the game to a LOCAL cluster (kind/minikube/docker-desktop).
# Applies: namespace -> base -> secrets -> env overlay -> wait for pods.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
exec "$REPO_ROOT/scripts/_deploy.sh" local
