#!/usr/bin/env bash
# Build (and optionally push) RPS game Docker images.
#
# Defaults match k8s/base manifests (Docker Hub). Override for GHCR:
#   REGISTRY=ghcr.io IMAGE_OWNER=playhub ./scripts/build-and-push.sh --push
#
#   ./scripts/build-and-push.sh           # build only
#   ./scripts/build-and-push.sh --push    # build + push (requires registry login)

set -euo pipefail

PUSH=false
for arg in "$@"; do
  case "$arg" in
    --push) PUSH=true ;;
    -h|--help)
      echo "Usage: $0 [--push]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REGISTRY="${REGISTRY:-docker.io}"
IMAGE_OWNER="${IMAGE_OWNER:-scruffyprodigy}"
API_IMAGE="${REGISTRY}/${IMAGE_OWNER}/rps-game-api"
CLIENT_IMAGE="${REGISTRY}/${IMAGE_OWNER}/rps-game-client"
TAG="${TAG:-latest}"

command -v docker >/dev/null 2>&1 || { echo "docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running" >&2; exit 1; }

docker_config_json() {
  echo "${DOCKER_CONFIG:-$HOME/.docker}/config.json"
}

ghcr_auth_configured() {
  local config
  config="$(docker_config_json)"
  [ -f "$config" ] || return 1
  grep -q 'ghcr.io' "$config" 2>/dev/null
}

if [ "$PUSH" = true ]; then
  case "$REGISTRY" in
    ghcr.io)
      if ! ghcr_auth_configured; then
        echo "GHCR login not found in $(docker_config_json). Run: docker login ghcr.io" >&2
        exit 1
      fi
      ;;
    docker.io)
      if ! grep -q 'index.docker.io' "$(docker_config_json)" 2>/dev/null; then
        echo "Docker Hub login not found in $(docker_config_json). Run: docker login" >&2
        exit 1
      fi
      ;;
  esac
fi

echo "Building API image..."
docker build -t "${API_IMAGE}:${TAG}" ./api

echo "Building client image..."
docker build -t "${CLIENT_IMAGE}:${TAG}" ./client

if [ "$PUSH" = true ]; then
  echo "Pushing images..."
  docker push "${API_IMAGE}:${TAG}"
  docker push "${CLIENT_IMAGE}:${TAG}"
else
  echo "Built locally. To push: $0 --push"
fi

echo "API:    ${API_IMAGE}:${TAG}"
echo "Client: ${CLIENT_IMAGE}:${TAG}"
