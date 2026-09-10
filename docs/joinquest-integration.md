# JoinQuest Lobby Integration

How the JoinQuest Lobby platform links to this game, and what each side owns.
**This game stays independent** — Lobby never touches the game's database, and
the game never touches Lobby's.

The integration uses a **generalized seating model** (so it works for 2 players
or many) and the **push provisioning model ("option 2")**, where Lobby
provisions a match server-to-server *before* sending players over. That gives
Lobby a synchronous handshake it can react to — including the game **rejecting a
banned player** so Lobby can re-matchmake.

> **Implementing the Lobby side?** Read
> [`lobby-protocol-handoff.md`](./lobby-protocol-handoff.md) first — it explains
> *why* the contract is shaped this way (push, JWT/JWKS, seat manifest,
> `externalMatchId` routing) and how it scales to larger games and a server fleet.
> This document is the step-by-step reference.

---

## Ownership boundary

| Concern                          | Owned by **Lobby** | Owned by **this Game** |
|----------------------------------|:------------------:|:----------------------:|
| User accounts / auth / sessions  | ✅                 |                        |
| Game catalog + `playUrl`         | ✅                 |                        |
| Matchmaking + roster assignment  | ✅                 |                        |
| JWKS / signing keys              | ✅                 |                        |
| Seat *definitions* (modes/roles) |                    | ✅                     |
| Match rooms / rounds / scores    |                    | ✅                     |
| Banlist / roster acceptance      |                    | ✅                     |
| Game database (Postgres :5433)   |                    | ✅                     |

Key idea: **Lobby decides *who* sits in *which* seat; the game defines *what the
seats are* and whether it will accept the roster.**

---

## The seating model (scales past 2 players)

A match has **seats**. Each seat has a stable `seatKey` (role), an optional
`team`, and may be **reserved for a specific Lobby user**. The same shape covers:

| Game        | Teams              | Seats (`seatKey`)                                   |
|-------------|--------------------|-----------------------------------------------------|
| RPS `duel`  | —                  | `a`, `b`                                             |
| Chess       | —                  | `white`, `black`                                    |
| MOBA `5v5`  | `radiant`, `dire`  | `radiant-top … radiant-support`, `dire-top … …`     |

The game publishes its modes so Lobby knows what to assign:

```
GET /api/v1/game-modes
{ "game": "rock-paper-scissors-lizard-robot", "modes": [
  { "key": "duel", "displayName": "1v1 Duel",
    "minPlayers": 2, "maxPlayers": 2,
    "seats": [ { "key": "a" }, { "key": "b" } ] }
```

- **`lobbyId`** — which Lobby instance provisioned the match (e.g. `https://joinquest.cc` per environment). Required on push.
- **`assignment.seats`** — `seatKey` + `lobbyUserId` only (no `displayName` on the push).
- **`bestOf`** — optional on `assignment`; not in the catalog manifest. If omitted, this game defaults to **5** for both modes.

RPS ships two modes. `duel-helpers` additionally carries a **`preQueue`** block, which
asks Lobby to run a picker before the player queues and to send the result back on
provision as `seats[].options`. The roster it renders comes from

```
GET /api/v1/players/{lobbyUserId}/queue-options?modeKey=duel-helpers
```

which serves the same 21 helpers to every player. A mode with no pre-queue pick
answers that path `200` with `{ "modeKey": "duel", "choices": [] }`, never `404`.
Declaring `preQueue` is itself the capability signal: Lobby sends `options` only for a
mode whose manifest carries it, so the two sides self-synchronise in either deploy
order.

The wire contract itself is JoinQuest platform documentation rather than this game's:
the lobby repo's developer integration guide, **§13 Pre-queue options**, carries the
full shapes and the `400`-not-`403` rule. The golden bodies both repos test against
are executable, so they stay here — [`docs/fixtures/prequeue/`](./fixtures/prequeue/),
whose README points at the rest.

> A chess or MOBA game would publish its own manifest with the same structure — no
> contract change needed.

---

## Ports recap

| Service   | This game               | Lobby                   |
|-----------|-------------------------|-------------------------|
| Frontend  | `http://localhost:5174` | `http://localhost:5173` |
| API       | `http://localhost:3001` | `http://localhost:8080` |
| Postgres  | `localhost:5433`        | `localhost:5432`        |

**Production (GKE):** single origin `https://rpsls-duel.win` — UI at `/`, API at
`/api` (see `k8s/env/production.yaml`). Lobby catalog `playUrl` =
`https://rpsls-duel.win` for both `playUrl` and `apiBaseUrl` (API origin; JWT `aud` matches).
Seat JWT `aud` must be `https://rpsls-duel.win` (not `.../api` — routes live under `/api/v1/...` on that host).

---

## Step 1 — Register the game in Lobby

Seed a catalog row in the **Lobby** database (a Lobby feature; the game pushes
nothing to Lobby):

```sql
INSERT INTO games (slug, name, description, play_url, status)
VALUES (
  'rock-paper-scissors-lizard-robot',
  'Rock Paper Scissors Lizard Robot',
  'A best-3-of-5 RPSLR match with a move-cooldown twist. Demo third-party game.',
  'http://localhost:5174',          -- production: https://rpsls-duel.win
  'active'
);
```

Production catalog row (same slug):

```sql
-- play_url = player browser; api_base_url = server-to-server push + JWT aud
UPDATE games SET play_url = 'https://rpsls-duel.win', api_base_url = 'https://rpsls-duel.win'
WHERE slug = 'rock-paper-scissors-lizard-robot';
```

If your Lobby schema uses separate columns, set:

| Field | Production value |
|-------|------------------|
| `playUrl` | `https://rpsls-duel.win` |
| `apiBaseUrl` | `https://rpsls-duel.win` |

---

## Step 2 — Provision the match (server-to-server push) — option 2

When Lobby's matchmaker forms a match, it **pushes the roster to the game first**:

```
POST http://localhost:3001/api/v1/matches
Content-Type: application/json
Authorization: Bearer <lobby.serviceToken>     # required when lobby.serviceToken is present

{
  "lobbyId": "https://joinquest.cc",
  "lobby": {
    "returnUrl": "https://joinquest.cc",
    "graphqlUrl": "https://joinquest.cc/graphql",
    "serviceToken": "v1.<game-uuid>.<hmac-hex>"
  },
  "assignment": {
    "externalMatchId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "gameMode": "duel",
    "seats": [
      { "seatKey": "a", "lobbyUserId": "11111111-1111-4111-8111-111111111111" },
      { "seatKey": "b", "lobbyUserId": "22222222-2222-4222-8222-222222222222" }
    ]
  }
}
```

Omit `lobby.serviceToken` when Lobby has no `LOBBY_GAME_TOKEN_PEPPER` (typical local dev); player names then come from seat JWT `name` or the claim body.

- **`lobbyId`** — Lobby issuer; must match seat JWT `iss`.
- **`lobby.returnUrl`** — player-facing Lobby URL (game client "Back to Lobby").
- **`lobby.graphqlUrl`** — where the game POSTs `player(id)` at claim time.
- **`lobby.serviceToken`** — Optional. Per-game Bearer (`v1.{gameId}.{sig}` from Lobby’s `LOBBY_GAME_TOKEN_PEPPER`); stored on the match for GraphQL `player` lookup. Omit in dev when Lobby has no pepper configured.

- **Idempotent** on `externalMatchId` (safe to retry).
- The game reserves each seat for the assigned `lobbyUserId`.
- **Response includes `launchUrls`** — map of `lobbyUserId` → browser URL base (no JWT). Lobby attaches the seat token. Example:

```json
{
  "match": { "externalMatchId": "f47ac10b-…", "…": "…" },
  "seats": [ "…" ],
  "launchUrls": {
    "11111111-1111-4111-8111-111111111111": "https://rpsls-duel.win/?match=f47ac10b-…&seat=1",
    "22222222-2222-4222-8222-222222222222": "https://rpsls-duel.win/?match=f47ac10b-…&seat=2"
  }
}
```

Set **`GAME_PLAY_URL`** on the game API to the same origin as catalog `playUrl` (`http://localhost:5174` locally, `https://rpsls-duel.win` in production). When omitted, defaults to `GAME_API_AUDIENCE` / first token audience.

- **Why push?** It is Lobby's chance to learn the game won't host this roster.

### The rejection handshake (why option 2)

If the roster includes a player the game has banned, the push fails and Lobby
can correct (re-matchmake, drop the player, notify them):

```
HTTP 403
{ "error": "roster contains banned player(s): u_bob",
  "bannedLobbyUserIds": ["u_bob"] }
```

The banlist is the game's own (configured via `BANNED_LOBBY_USERS`, or a future
table). Lobby owns matchmaking; the game owns *acceptance*.

---

## Step 3 — Send each player over with a signed seat token

After a successful push, the game returns **`launchUrls`** (URL bases without JWT). Lobby signs a seat JWT for each player and opens:

```
https://rpsls-duel.win/?match=<externalMatchId>&seat=<seatKey>&token=<jwt>
```

Locally:

```
http://localhost:5174/?match=lobby-uuid-123&seat=1&token=<jwt>
```

Session cookies do not cross the `5173 → 5174` origin, so identity travels in the JWT query param.

The game client loads `lobby.returnUrl` from the provisioned match (`GET /api/v1/matches/:match`)
for "Back to Lobby" — no extra query param on the launch URL.

The JWT is verified using JWKS at `{iss}/.well-known/jwks.json` where `iss` equals
provision `lobbyId`. The game checks `aud` against its API origin (`GAME_API_BASE_URL`
or `GAME_API_AUDIENCE` — `http://localhost:3001` locally,
`https://rpsls-duel.win` on GKE). The game does **not** hardcode
Lobby hosts in env.

Example seat JWT payload:

```json
{
  "iss": "https://joinquest.cc",
  "aud": "http://localhost:3001",
  "sub": "<user-uuid>",
  "jti": "<unique-uuid>",
  "matchId": "<session-uuid>",
  "seatKey": "a",
  "name": "Alice",
  "nbf": 1710000000,
  "iat": 1710000000,
  "exp": 1710007200
}
```

| Claim     | Meaning                                  |
|-----------|------------------------------------------|
| `iss`     | Lobby issuer (same as provision `lobbyId`) |
| `aud`     | this game's API base URL                   |
| `sub`     | Lobby user id                            |
| `matchId` | `externalMatchId` of the pushed match    |
| `seatKey` | the seat reserved for this user          |
| `name`    | display name (optional)                  |
| `jti`, `nbf`, `iat`, `exp` | standard JWT claims           |

In production, Lobby must set `aud` to `https://rpsls-duel.win` (API origin,
same value as `GAME_API_AUDIENCE` on the API pod and catalog `api_base_url`).

The game rejects tokens whose `iss` does not match the `lobbyId` stored at provision time.

At claim time the game resolves the player's display name:

1. `name` claim in the JWT (if present)
2. Lobby GraphQL `player(id: $lobbyUserId) { displayName }` with the match’s provisioned `lobby.serviceToken`
3. Fallback `Player`

```graphql
query Player($id: ID!) {
  player(id: $id) {
    id
    displayName
  }
}
```

POST the query to `lobby.graphqlUrl` with `Authorization: Bearer <lobby.serviceToken>` from the same provision body.

The game client auto-claims on load:

```
POST /api/v1/matches/lobby-uuid-123/claim
Authorization: Bearer <jwt>
```

The game verifies the token against JWKS at `{iss}/.well-known/jwks.json`, confirms the seat is reserved
for `sub`, and seats the player. This is what stops anyone from grabbing
`white`, or stealing a MOBA team slot — the token, not the URL, is authoritative.

After claiming, the client opens a **WebSocket** (`/api/v1/ws`) for live
gameplay (subscribe + moves). This is internal to the game's client↔server
transport and does not change the Lobby contract — Lobby's responsibilities stay
REST (push provisioning + the signed link-out).

> The match **must already be provisioned** (Step 2). A token claim against an
> unprovisioned match returns `404` — the game never creates matches from a
> token, which is what keeps Lobby in control of provisioning.

Lobby connectivity is **per match**, not per deployment:

| Source | Used for |
|--------|----------|
| Provision `lobbyId` | Stored on match; JWT `iss` must match; JWKS at `{lobbyId}/.well-known/jwks.json` |
| Provision `lobby.returnUrl` | Client "Back to Lobby" |
| Provision `lobby.graphqlUrl` | `player(id)` lookup at claim |
| JWT `aud` | Must match game API origin (`GAME_API_BASE_URL` / `GAME_API_AUDIENCE`) |
| Provision `lobby.serviceToken` | Bearer for GraphQL `player(id)` (per game + Lobby instance; format `v1.{gameId}.{sig}`) |

---

## Step 4 — Getting a player back in (JQ-258)

A player who closes the tab, drops their connection, or takes a phone call
mid-match is **still seated**. There are two independent ways back, and they are
independent on purpose — each one works when the other has failed.

### The re-claim rule

A claim on a seat that already has someone in it is not automatically a
conflict. Compare the token's `sub` against the player already in the seat:

| Who is claiming | Answer |
|---|---|
| The same `sub` already in the seat | **`200`** + a full snapshot — this is a reconnect |
| Anyone else | **`409`** `seat already taken` |

`201` stays the answer for a first claim, so the two are told apart on the wire.
A re-claim moves nothing: no reset, no second player row, no re-deal, no round
restarted, no committed throw cleared. It answers with **complete authoritative
state**, not the deltas the player missed — they should never have to guess.

A flat `409` on any second claim passes the seat-theft half of this and fails the
return half, which is exactly the shape of the bug: it looks correct until a real
player closes their tab. JoinQuest's `jwt.reclaim_same_player` and
`jwt.reclaim_seat_theft` checks are the two halves.

### Path 1 — the game's own origin (primary, no Lobby round trip)

On a successful token claim the API sets a binding cookie on **its own origin**
naming the seat this browser took:

```
Set-Cookie: rpslr_seat=<base64url>; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200
```

It records `externalMatchId`, `seatKey`, the verified `sub`, and the game's own
`playerId`. On a later load with no `?token=`, the client asks for it back:

```
GET /api/v1/resume        (credentials: include, no Authorization header)
→ 200 { state, you: { playerId, seatKey, name }, reclaimed: true }
→ 404 { error }           nothing to resume — the ordinary first-visit answer
```

This is the path that covers a refresh, the back button and a tab crash. No
Lobby request is involved, so it keeps working when Lobby is slow, unreachable,
or the player's Lobby session is gone.

The binding is **checked against the match, never trusted on its own**: it names
a seat, and the match stays the source of truth for whether that seat is live. A
binding naming a finished match, a seat someone else now holds, or a `sub` that
does not match the seated player resumes nothing, and the cookie is cleared so a
dead binding stops being presented.

It needs no signature because it carries `playerId`, which is already this game's
gameplay credential — every `/move` and `/fire` names it and nothing else. A
forged binding would need a `playerId` its forger could only have by already
being able to play that seat.

### Path 2 — Lobby's Rejoin button (fallback)

A player who comes back through JoinQuest instead gets a fresh seat token for
the seat they already hold, and lands on the re-claim rule above. This is the
path for a player whose game-origin binding is gone: a different browser
profile, cleared site data, or a new device.

### While they are away

- **The seat is held.** A dropped socket forfeits nobody and fills nothing.
- **The other player is told.** The published state carries `seat.player.connected`,
  and the board says "Waiting for *name* to reconnect…". Only an explicit
  `false` means away — absent has to read as present, or a REST-only player gets
  drawn as gone on no evidence.
- **The grace period has an end.** 45 seconds without a socket forfeits the
  match (`endReason: "forfeit-disconnect"`), because an indefinite wait is worse
  for the person still there than a decided outcome.
- **`reportPlayerFinished` is called at *that* moment**, with
  `reason: DISCONNECT` — never on the dropped socket itself. Reporting a player
  finished releases their queue row and closes their way back in, so it must
  mean they have genuinely left. A run of ignored deadlines reports `FORFEIT`
  instead: that player was present and not playing.

Filling the empty seat with a bot or a replacement player is deliberately **not**
part of this.

---

## v1 standalone mode (no Lobby running)

With `REQUIRE_LOBBY_AUTH=false` (default), the game is fully playable on its own:
one player creates a match (gets a `RPS-XXXX` code), the other joins by code and
is auto-seated in the open seat. The UI shows a "standalone mode" banner. This is
the same seat model — just with unreserved seats and no token required.

---

## What the Lobby maintainer must add to complete the demo loop

1. **Seed a catalog row** for `rock-paper-scissors-lizard-robot` with `playUrl` =
   `https://rpsls-duel.win` for both `playUrl` and `apiBaseUrl` (Step 1).
2. **At match start, push the roster** to `POST /api/v1/matches` and handle a
   `403` (banned player) by correcting the match (Step 2).
3. **Link each user** using game-minted `launchUrls` + Lobby-attached seat JWT (Step 3).
4. **Render a Play button** that performs steps 2–3.

With those, a Lobby user clicks **Play** and lands in their assigned seat against
the right opponent(s).

> **Future work:** production-grade JWKS key-rotation/cache tuning is out of
> scope for v1 (`jose`'s `createRemoteJWKSet` already caches keys). A persistent
> banlist table (vs the `BANNED_LOBBY_USERS` env list) is also future work.
