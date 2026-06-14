# Game-specific GKE defaults — sourced by scripts/_deploy.sh.
# Override via environment when deploying to non-production targets.
GAME_ID="${GAME_ID:-rock-paper-scissors-lizard-robot}"
DEFAULT_IMAGE_TAG="${DEFAULT_IMAGE_TAG:-rpsls}"
API_IMAGE_NAME="${API_IMAGE_NAME:-rps-game-api}"
CLIENT_IMAGE_NAME="${CLIENT_IMAGE_NAME:-rps-game-client}"
DEFAULT_NAMESPACE="${DEFAULT_NAMESPACE:-rpsls-duel}"
PRODUCTION_PUBLIC_HOST="${PRODUCTION_PUBLIC_HOST:-rpsls-duel.win}"
