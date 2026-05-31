#!/bin/sh
# Writes /usr/share/nginx/html/env.js from container environment variables.
# nginx:alpine runs every executable in /docker-entrypoint.d/ before starting.
# This mirrors the Lobby frontend's runtime-config injection pattern.
set -eu

ENV_JS_PATH="/usr/share/nginx/html/env.js"

cat > "$ENV_JS_PATH" <<EOF
window.env = {
  GAME_APP_ENV: "${GAME_APP_ENV:-production}",
  GAME_API_BASE_URL: "${GAME_API_BASE_URL:-http://localhost:3001}",
  GAME_WS_BASE_URL: "${GAME_WS_BASE_URL:-}"
};
EOF

echo "[entrypoint] wrote runtime env to $ENV_JS_PATH:"
cat "$ENV_JS_PATH"
