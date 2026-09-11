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

Four client suites are ledgers rather than ordinary tests: they read
`styles.css` and the shipped components off disk, because jsdom has no cascade
and cannot see a media query, a composite or a container query at all. They are
also where the reasoning behind each decision is written down, so read the one
that covers what you are about to change:

| Suite | Holds |
| --- | --- |
| `boardFit.test.ts` | The board's height and width budget, and the ledger of which board states are not carried by colour alone |
| `contrast.test.ts` | Measured contrast ratios — composited, not read off the tokens |
| `designSystem.test.ts` | Every colour is a named token; every glyph is drawn |
| `liveRegions.test.ts` | Every live region in the client, and why each one is the shape it is |
| `motionSafety.test.ts` | `prefers-reduced-motion` may remove motion, never meaning |

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

### Replay link previews

In production the ingress routes `/replay/*` to the API, which serves the
`og:`/`twitter:` meta tags and the SPA in one response — a crawler runs no
JavaScript, so the tags have to be in the HTML it is handed.

Local dev has no ingress: vite serves `/replay/:id` to your browser as it always
has, and the card is checked against the API directly.

```bash
curl -s localhost:3001/replay/RPS-ABCD | grep og:
open http://localhost:3001/api/v1/replay/RPS-ABCD/card.png
```

`npm run card:preview -- /tmp/card.png` in `api/` renders a card with no match at
all, which is the quickest way to look at a design change. Pass `generic` as a
second argument for the fallback card.

The card's fonts live in `api/assets/fonts` as TTF: resvg cannot read the
`.woff2` files the client ships, and it ignores font options it does not
recognise rather than complaining, so a card set in the wrong face is a silent
failure. `cardImage.test.ts` renders two families and fails if they come out
identical.

### Story cards and the short link

Instagram Stories, Snapchat and TikTok render no link preview at all, so the
card above never appears on any of them. What works there is handing over the
image itself: `navigator.share({ files })` drops a PNG into the share sheet, and
the person lands in the Stories composer with the card already placed.

```bash
open http://localhost:3001/replay/RPS-ABCD/story.png     # 1080×1920
curl -s localhost:3001/r/RPS-ABCD | grep og:url          # the short route
```

`npm run story:preview -- /tmp/story.png` in `api/` renders one with no match
behind it. Pass `nowin` or `generic` as a second argument for the drawn-match
and fallback layouts.

Two rules the tests keep, both of which have already been broken once:

- **Instagram's chrome covers the top and bottom 250px.** `storyLayout.test.ts`
  checks the declared boxes, but a box only says where we *meant* to draw —
  `storySvg.test.ts` rasterises the card and looks for ink outside the safe
  area, which is what caught the short URL running past the gutter.
- **The QR has to actually scan.** `qrSvg.test.ts` renders it and reads it back
  with a decoder rather than asserting the shape of the path.

`/r/:code` takes the match's own `RPS-XXXX` join code — `getMatch` has always
resolved it — and serves the replay page rather than redirecting, so the short
URL previews as itself. It needs an ingress rule in **both**
`k8s/base/ingress.yaml` and `k8s/env/production-ingress.yaml`: the production
overlay replaces the base rules wholesale.
