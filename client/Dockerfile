# ---- Build stage ----
# The build context is the REPO ROOT, not client/. The client's tsconfig maps
# `@game/*` onto `../api/src/*` (JQ-207 gave the replay one reconstruction
# shared with the server), and a fixture test reads docs/fixtures/replay/, so
# both live outside client/ and a client-only context cannot see them. Paths
# below therefore mirror the repo layout, and `..` from /app resolves the same
# way it does in a checkout.
FROM node:20-alpine AS build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
COPY api/src/ ../api/src/
COPY api/tsconfig.json ../api/
COPY docs/fixtures/replay/ ../docs/fixtures/replay/
RUN npm run build

# ---- Runtime stage (nginx + runtime env.js injection, like Lobby frontend) ----
FROM nginx:alpine AS runtime

COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Entrypoint script writes /env.js from container env vars at startup, so the
# same image works in local/staging/production without rebuilding.
COPY client/docker-entrypoint.d/40-env-js.sh /docker-entrypoint.d/40-env-js.sh
RUN chmod +x /docker-entrypoint.d/40-env-js.sh

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
