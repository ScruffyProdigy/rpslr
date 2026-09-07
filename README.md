# Rock Paper Scissors Lizard Robot — JoinQuest Demo Game

A minimal but production-shaped **third-party game** for the [JoinQuest Lobby](#) platform.
It is a multi-round **Rock Paper Scissors Lizard Robot** match (with a "delay mark"
cooldown twist) you can play standalone today, and that the Lobby will later link
to via a `playUrl`.

> This repo is **fully independent** from Lobby. It does **not** share Lobby's
> database, ports, or GraphQL schema. It runs on its own ports (5174 / 3001 / 5433).

---

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────────────────┐
│      JoinQuest Lobby        │         │        RPS Demo Game (this repo)       │
│      (separate repo)      │         │                                        │
│                           │         │   ┌────────────┐     ┌─────────────┐  │
│  React UI    :5173        │  link   │   │  Client     │ →  │  Game API    │  │
│  Go GraphQL  :8080  ──────┼─playUrl─┼─▶ │  Vite/nginx │HTTP│  Express/TS  │  │
│  Postgres    :5432        │  (+JWT  │   │  :5174      │     │  :3001       │  │
│  JWKS /.well-known/...    │  later) │   └────────────┘     └──────┬───────┘  │
│                           │         │                             │          │
└──────────────────────────┘         │                      ┌──────▼───────┐  │
                                      │                      │ Game Postgres │  │
        future: JWT verify  ◀─────────┼──────────────────────│  :5433        │  │
        via Lobby JWKS               │                       └──────────────┘  │
                                      └────────────────────────────────────────┘
```

The game owns its client, API, and database. Lobby owns auth, the game catalog,
and (later) matchmaking. See [`docs/joinquest-integration.md`](docs/joinquest-integration.md).

---

## Port plan (avoids Lobby collisions)

| Service        | This game | Lobby (other repo) | Notes                        |
|----------------|-----------|--------------------|------------------------------|
| Frontend       | **5174**  | 5173               | Vite dev / nginx in prod     |
| API            | **3001**  | 8080               | Express + TypeScript         |
| Postgres       | **5433**  | 5432               | game's own DB (docker)       |

All ports are documented in [`.env.example`](.env.example).

---

## Quick start

Requires **Node 20 LTS**, **npm**, and **Docker** (for Postgres).

```bash
./scripts/setup.sh     # copy .env, install api + client deps
./scripts/dev.sh       # postgres + migrate + API :3001 + Vite :5174
```

Then open **http://localhost:5174**, create a match, copy the room code, open a
second tab/incognito window, join with the code, and play. The match runs
**best 3 of 5** rounds; the first player to win 3 rounds takes the match.

### Game rules

Standard Rock Paper Scissors Lizard Robot, with a **delay mark** (cooldown) twist:

- **Win graph:** Rock crushes Scissors & Lizard · Paper covers Rock & disproves Robot ·
  Scissors cuts Paper & decapitates Lizard · Lizard eats Paper & poisons Robot ·
  Robot smashes Scissors & vaporizes Rock.
- **Delay marks:** the match opens with **Lizard at 1 mark** and **Robot at 2 marks**
  (Rock/Paper/Scissors at 0). You may **only choose a move with 0 marks**, so the first
  round is Rock/Paper/Scissors only.
- **After each of your choices** (win, lose, or draw): every move loses one mark
  (floored at 0), then the move you just chose gains **2 marks**. This forces variety —
  you can't spam the same move, and Lizard/Robot cycle in and out of play.
- Marks are tracked **per player** and enforced server-side; the UI greys out and
  badges any move that's on cooldown.

Stop with `Ctrl+C` (Postgres keeps running — stop it with `./scripts/db.sh down`).

### Run the tests

```bash
./scripts/test.sh      # runs api + client tests from the repo root
```

---

## Repo layout

```
.
├── README.md
├── .env.example              # all ports + config documented here
├── docker-compose.yml        # game Postgres only (port 5433)
├── scripts/                  # setup / dev / test / db / deploy-* (colored output)
├── api/                      # Node + TypeScript game server (Express)
│   ├── src/                  # config, game logic, service, repositories, routes
│   └── migrations/           # plain SQL, applied by a tiny forward-only runner
├── client/                   # Vite + React game UI
│   ├── Dockerfile            # multi-stage → nginx + runtime env.js injection
│   ├── nginx.conf
│   └── src/
├── k8s/
│   ├── base/                 # namespace, postgres, api, client, ingress
│   ├── env/                  # local / staging / production ConfigMap overlays
│   └── secrets/              # *.example.yaml committed; real *.yaml gitignored
├── docs/
│   ├── joinquest-integration.md      # step-by-step Lobby integration
│   ├── lobby-protocol-handoff.md   # contract + rationale + scaling (read first)
│   └── development.md
└── .github/workflows/        # api-tests, client-tests, environment-config-test
```

---

## Game API

| Method | Path                           | Description                                                |
|--------|--------------------------------|-----------------------------------------------------------|
| GET    | `/healthz`                     | returns `ok`                                              |
| GET    | `/api/v1/status`               | `{ game, version, appEnv, standalone }`                   |
| GET    | `/api/v1/game-modes`           | seat/team/role manifest Lobby reads before assigning      |
| POST   | `/api/v1/matches`              | create a match — standalone self-serve, or a Lobby push   |
| GET    | `/api/v1/matches/:ref`         | full match state (`ref` = room code or external match id) |
| POST   | `/api/v1/matches/:ref/claim`   | claim a seat (signed token, or standalone seat pick)      |
| POST   | `/api/v1/matches/:ref/move`    | submit a move, resolves the round                         |
| WS     | `/api/v1/ws`                   | live gameplay — subscribe to state, submit moves          |

State (matches, **seats**, players, moves, round results) lives in the game's own
Postgres. Pure game logic is unit-tested in `api/src/game.ts`; the seat/match
lifecycle in `api/src/service.ts`.

### Real-time over WebSocket (no polling)

Live updates use a **WebSocket** at `/api/v1/ws` — the sensible default for a
game platform, so this template ships a bidirectional channel even though RPS
only strictly needs server→client pushes. Protocol (JSON):

```
client → server:  { "type": "subscribe", "ref": "RPS-XXXX" }
client → server:  { "type": "move", "playerId": "...", "move": "rock" }
server → client:  { "type": "state", "state": { ...MatchState } }   // on subscribe + every change
```

The service publishes to an in-process `MatchHub` after **every** mutation, so a
move sent over REST still updates WS subscribers and vice versa. (Multi-replica
fan-out via Redis/NATS/Postgres LISTEN-NOTIFY is documented as future work.)

### Generalized seating (scales past 2 players)

A match is a set of **seats** (`seatKey`, optional `team`/`role`), each
optionally **reserved for a Lobby user**. RPS ships the 2-seat `duel` mode, but
the same model describes chess (`white`/`black`) or a MOBA (two teams of five) —
see `GET /api/v1/game-modes` and [`docs/joinquest-integration.md`](docs/joinquest-integration.md).

---

## Lobby integration (summary)

Uses the **push model**: Lobby provisions a match server-to-server
(`POST /api/v1/matches` with a roster assignment) *before* sending players, then
links each user with a **signed JWT** that proves their reserved seat
(`?match=<id>&token=<jwt>`). The push is a handshake the game can **reject** —
e.g. a banned player returns `403 { bannedLobbyUserIds }` so Lobby can correct.

For v1, `REQUIRE_LOBBY_AUTH=false` keeps the game fully playable **standalone**
(self-serve room codes, "standalone mode" banner). Full contract, seat token
claims, and the exact Lobby steps are in
[`docs/joinquest-integration.md`](docs/joinquest-integration.md). For the **why**
behind each contract decision (and how it scales to larger games / a server
fleet), see [`docs/lobby-protocol-handoff.md`](docs/lobby-protocol-handoff.md).

---

## Scripts

| Script                       | What it does                                              |
|------------------------------|-----------------------------------------------------------|
| `scripts/setup.sh`           | copy `.env`, install api + client deps                    |
| `scripts/dev.sh`             | postgres + migrate + API + Vite, traps Ctrl+C             |
| `scripts/test.sh`            | run api + client tests (subshells, cwd-safe)              |
| `scripts/db.sh`              | `up` / `down` / `migrate` / `reset` / `url`               |
| `scripts/deploy-local.sh`    | apply namespace → base → secrets → local overlay          |
| `scripts/deploy-staging.sh`  | same, staging overlay                                     |
| `scripts/deploy-production.sh` | same, production overlay (with confirmation)            |

**Production URL:** `https://rpsls-duel.win` (GKE). The ingress serves the React
client at `/` and the API at `/api`. See `k8s/env/production.yaml` and
[`docs/joinquest-integration.md`](docs/joinquest-integration.md) for Lobby catalog
values (`playUrl`, `apiBaseUrl`, JWT `aud`).

---

## Out of scope for v1

- Sharing Lobby's Postgres or GraphQL schema
- Matchmaking / `joinGame` (Lobby PR 2)
- Goods, inventory, payments
- Production-grade JWT key rotation (documented as future)
