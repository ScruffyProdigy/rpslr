# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Install only production deps.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Built JS + SQL migrations (migrate runs against compiled dist at runtime).
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Card fonts — resvg loads these at startup; without them /replay has no type.
COPY assets ./assets

# Run as the built-in non-root "node" user.
USER node

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
