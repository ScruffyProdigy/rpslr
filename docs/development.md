# Development

Running the RPS demo game, and running it side-by-side with the JoinQuest Lobby.

## Prerequisites

- **Node 20 LTS** + npm
- **Docker** (for the game's Postgres on port 5433)

## First-time setup

```bash
./scripts/setup.sh
```

This copies `.env.example → .env` and installs dependencies for both `api/` and
`client/`. Review `.env` and adjust if any port is taken.

## Day-to-day

```bash
./scripts/dev.sh
```

Brings up, in order:

1. Game Postgres via docker compose (host port **5433**)
2. SQL migrations (`api/migrations/*.sql`)
3. API on **:3001** (`tsx watch`)
4. Vite dev server on **:5174**

URLs are printed at the end. `Ctrl+C` stops the API and client; Postgres keeps
running so restarts are fast. Stop it explicitly with `./scripts/db.sh down`.

### Database helpers

```bash
./scripts/db.sh up        # start postgres
./scripts/db.sh migrate   # apply migrations
./scripts/db.sh reset     # wipe volume, recreate, migrate
./scripts/db.sh url       # print DATABASE_URL
./scripts/db.sh down      # stop postgres
```

### Tests

```bash
./scripts/test.sh         # api + client
# or individually:
(cd api && npm test)
(cd client && npm test)
```

There are unit tests for the pure game logic, the full game-loop service (via an
in-memory repository), the HTTP routes (via supertest), the **WebSocket
transport** (a real server with two clients verifying a move broadcasts to
subscribers), and the client (env/ws-URL config, move helpers, a component render).

## Real-time transport

Live gameplay uses a WebSocket at `<API>/api/v1/ws` (the client derives the URL
from `GAME_API_BASE_URL`: `http→ws`, `https→wss`; override with
`GAME_WS_BASE_URL`). The server broadcasts fresh state after every mutation via
an in-process `MatchHub`, so REST and WS stay consistent. The browser shows a
`● live` / `○ connecting` indicator and reconnects with backoff.

## Running alongside Lobby

The two repos are designed to coexist with **zero port conflicts**:

| Process            | Lobby (other repo)   | This game           |
|--------------------|----------------------|---------------------|
| Frontend           | `:5173`              | `:5174`             |
| Backend / API      | `:8080`              | `:3001`             |
| Postgres           | `:5432`              | `:5433`             |

Typical local flow:

```bash
# Terminal A — in the Lobby repo
./scripts/dev.sh          # Lobby: postgres 5432 + Go API 8080 + React 5173

# Terminal B — in this repo
./scripts/dev.sh          # Game: postgres 5433 + API 3001 + Vite 5174
```

Open the Lobby at `http://localhost:5173`. Once the Lobby maintainer adds the
catalog row + Play button (see `joinquest-integration.md`), clicking **Play**
pushes the match to the game and opens
`http://localhost:5174/?match=<id>&seat=<seat>&token=<jwt>` (game-minted base + Lobby JWT), seating you in your assigned
slot. You can also open the game directly and play standalone with room codes.

If a script reports a port is in use, it prints a clear error and exits — stop
the conflicting process or change the port in `.env`.

## Building production images

```bash
docker build -t rps-game-api ./api
docker build -t rps-game-client ./client

# verify client runtime env injection:
docker run --rm -p 8088:80 \
  -e GAME_APP_ENV=local \
  -e GAME_API_BASE_URL=http://localhost:3001 \
  rps-game-client
# then: curl http://localhost:8088/env.js
```

## Deploying

```bash
cp k8s/secrets/pg-dsn.example.yaml k8s/secrets/pg-dsn.yaml   # fill in real values (gitignored)
./scripts/deploy-local.sh        # or deploy-staging.sh / deploy-production.sh
```

Each deploy applies: namespace → secrets → env ConfigMap overlay → base
workloads → optional env ingress overlay → waits for rollout.

**Production (GKE):** `https://rpsls-duel.win` — ConfigMaps in
`k8s/env/production.yaml`, ingress host/TLS in `k8s/env/production-ingress.yaml`.
Point DNS at the cluster ingress, then `./scripts/deploy-production.sh`. Lobby
catalog: `playUrl` = `https://rpsls-duel.win`, `apiBaseUrl` =
`https://rpsls-duel.win`.
