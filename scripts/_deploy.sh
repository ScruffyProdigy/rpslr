#!/usr/bin/env bash
# Shared deploy logic for all environments. Not called directly — use
# deploy-{local,staging,production}.sh. Applies, in order:
#   namespace -> base manifests -> secrets -> env overlay -> wait for rollout.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_NAME="${1:?usage: _deploy.sh <local|staging|production>}"
NS="${GAME_NAMESPACE:-rpsls-duel}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
K8S="$REPO_ROOT/k8s"
ENV_FILE="$K8S/env/${ENV_NAME}.yaml"
SECRETS_FILE="$K8S/secrets/pg-dsn.yaml"

command -v kubectl >/dev/null 2>&1 || die "kubectl not found."
[ -f "$ENV_FILE" ] || die "Missing env overlay: $ENV_FILE"

log "Deploying game to '${ENV_NAME}' (namespace ${NS})..."

# 1. Namespace
log "Applying namespace..."
kubectl apply -f "$K8S/base/namespace.yaml"

# 2. Secrets (real secrets are gitignored; expects pg-dsn.yaml to exist locally)
if [ -f "$SECRETS_FILE" ]; then
  log "Applying secrets..."
  sed -e 's/namespace: rps-game/namespace: '"$NS"'/g' \
      -e 's/namespace: rpsls-duel/namespace: '"$NS"'/g' \
      "$SECRETS_FILE" | kubectl apply -n "$NS" -f -
else
  warn "No $SECRETS_FILE found. Copy k8s/secrets/pg-dsn.example.yaml -> pg-dsn.yaml and fill it in."
  warn "Continuing — deployment will fail to start until the secret exists."
fi

# 3. Env overlay (ConfigMaps)
log "Applying ${ENV_NAME} ConfigMap overlay..."
kubectl apply -n "$NS" -f "$ENV_FILE"

if [ "$ENV_NAME" = "production" ] && [ -f "$K8S/env/production-certificate.yaml" ]; then
  log "Applying production TLS certificate..."
  kubectl apply -f "$K8S/env/production-certificate.yaml"
fi

# 4. Base workloads (deployments, services, ingress, optional postgres)
log "Applying base manifests..."
kubectl apply -n "$NS" -f "$K8S/base/postgres.yaml"
kubectl apply -n "$NS" -f "$K8S/base/api.yaml"
kubectl apply -n "$NS" -f "$K8S/base/client.yaml"
kubectl apply -n "$NS" -f "$K8S/base/ingress.yaml"
INGRESS_OVERLAY="$K8S/env/${ENV_NAME}-ingress.yaml"
if [ -f "$INGRESS_OVERLAY" ]; then
  log "Applying ${ENV_NAME} ingress overlay..."
  kubectl apply -n "$NS" -f "$INGRESS_OVERLAY"
fi

# 5. Pin images by digest (mutable :rpsls tag alone is not enough on GKE).
API_TAG="${REGISTRY:-docker.io}/${IMAGE_OWNER:-scruffyprodigy}/rps-game-api:${IMAGE_TAG}"
CLIENT_TAG="${REGISTRY:-docker.io}/${IMAGE_OWNER:-scruffyprodigy}/rps-game-client:${IMAGE_TAG}"
API_IMAGE="$(resolve_image_digest "$API_TAG")"
CLIENT_IMAGE="$(resolve_image_digest "$CLIENT_TAG")"
pin_deployment_images "$NS" "$API_IMAGE" "$CLIENT_IMAGE"

# 6. Wait for rollout
log "Waiting for deployments to become available..."
kubectl -n "$NS" rollout status deployment/rps-game-api --timeout=120s
kubectl -n "$NS" rollout status deployment/rps-game-client --timeout=120s

ok "Deploy to '${ENV_NAME}' complete."
kubectl -n "$NS" get pods
