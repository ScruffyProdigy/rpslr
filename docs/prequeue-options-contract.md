# Pre-Queue Options — Lobby ↔ Game Contract

**Contract version:** 1
**Status:** Proposed — sent to the JQ-163 session 2026-09-08, not yet agreed
**Game side:** [JQ-146 epic](https://linear.app/joinquest/issue/JQ-146), primarily
[JQ-148](https://linear.app/joinquest/issue/JQ-148)
**Lobby side:** [JQ-163](https://linear.app/joinquest/issue/JQ-163)

How a game declares that a mode has a pre-queue pick, how the lobby fetches the
roster of choices, and how a player's selection reaches the game.

RPSLR's `duel-helpers` is the **first real consumer** of this. Ryan has confirmed
the contract is not frozen — where the prototype's shape does not survive contact
with a real game, the change is made here rather than worked around. Five such
changes are marked **[CHANGE]** and are the open items in the negotiation.

This is the reference companion to [`lobby-protocol-handoff.md`](./lobby-protocol-handoff.md),
which covers discovery, provisioning, link-out and claim. Read that first; this
document only adds the options layer.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 1 | 2026-09-08 | First draft, from the JQ-146 epic plan. Proposed, not agreed. |

---

## 1. Mode manifest — `GET /api/v1/game-modes`

A mode that has a pre-queue pick declares it:

```json
{
  "key": "duel-helpers",
  "displayName": "Helpers",
  "minPlayers": 2,
  "maxPlayers": 2,
  "seatTemplate": { "count": 2 },
  "preQueue": {
    "kind": "Loadout",
    "label": "Choose your two helpers",
    "select": { "min": 2, "max": 2, "distinct": true },
    "groupOrder": ["Major", "Minor", "Trinket"],
    "locking": "none",
    "rosterPath": "/api/v1/players/{lobbyUserId}/queue-options?modeKey=duel-helpers"
  }
}
```

`kind` and `label` are the prototype's. `locking` is `none` or `some`.

**[CHANGE 1] `select` replaces the prototype's `options` string.** The prototype
carries `options: "22 helpers"`, which is display copy. The lobby cannot derive how
many a player must pick from it, and `label` is a prompt, not a rule. Without
`select` there is no lobby-side arity validation and every game hardcodes its own.
It is generic: a champion picker is `{ "min": 1, "max": 1, "distinct": true }`.

**[CHANGE 2] `rosterPath` — the roster is fetched live, at a path the game
declares.** This resolves JQ-163's open question (static in the manifest vs live
from the game). Declaring the path means the lobby learns where to look without
hardcoding a game-specific URL, and a game that prefers static can inline `choices`
here instead. **Exactly one of `rosterPath` or `choices` is present.**

**[CHANGE 5] `groupOrder` — section order is data, not convention.** See §2.

A mode without a pre-queue pick omits `preQueue` entirely, or sends `null`.

---

## 2. Roster — `GET /api/v1/players/{lobbyUserId}/queue-options?modeKey=…`

```json
{
  "modeKey": "duel-helpers",
  "select": { "min": 2, "max": 2, "distinct": true },
  "choices": [
    {
      "id": "ferrus",
      "label": "Ferrus",
      "group": "Major",
      "badge": "2 marks",
      "blurb": "Your Robot takes 1 mark instead of 2.",
      "locked": false
    }
  ]
}
```

- `select` is repeated here so the endpoint is self-describing when read alone.
- A mode with no pre-queue pick returns `{ "modeKey": "duel", "choices": [] }` with
  **200**, not `404`.
- `locked` follows the mode-eligibility vocabulary already shipped by JQ-11/12/13 —
  a locked choice carries a requirement (`label`, `current`, `target`, `all`/`any`)
  rather than vanishing. RPSLR sends `locked: false` for every choice; `locking` is
  `none` and there is no progression in the mode.

**[CHANGE 3] `group`, `badge` and `blurb`.** JQ-148 requires each choice to carry
its tier and mark cost, and Ryan has confirmed the picker must **separate the Major,
Minor and Trinket sections**. Modelling tier and cost as first-class fields would
teach the lobby what a "mark" is. Instead:

- `group` — a section-header key. The lobby groups by it and renders it verbatim.
- `badge` — a short string rendered verbatim beside the label.
- `blurb` — one sentence of player-facing description.

None of the three needs the lobby to understand the game. A champion picker uses
`group: "Assassin"`, `badge: "Free"`.

**[CHANGE 5] `groupOrder` on the `preQueue` block** gives section order, because it
is meaningful — RPSLR's reads as a price ladder, most expensive first — and neither
alphabetical nor roster order produces it.

**Open with the lobby:** whether the picker can render `group` as real sections or
only a flat list with a tag. If flat-only, the fallback is folding the tier into
`label` ("Ferrus · Major"), which is worse but survivable. The game needs to know
before it freezes the fixture.

---

## 3. Queue join

The selection travels on `joinQueue` alongside `queuePath`:

```json
{
  "preQueueSelection": {
    "modeKey": "duel-helpers",
    "choiceIds": ["ferrus", "chimera"]
  }
}
```

The lobby validates arity (`select.min`/`max`), distinctness, membership of the
roster it fetched, and `locked`. Rejection is server-side, not merely a disabled
control.

**[CHANGE 4 — open] Parameterised choices.** RPSLR has one helper, Blind Spot,
whose effect is *"name one of your moves; its cooldown is hidden all match"*. With
the pick happening pre-queue there is no in-game moment to name it, and
`choiceIds: string[]` cannot carry the parameter. Three options, unresolved:

- **(a)** Widen to `choices: [{ id, param? }]`, with the roster declaring a
  per-choice param spec. Keeps the card as designed and would also serve a
  character picker with a skin or colour sub-choice.
- **(b)** Explode into one roster entry per parameter (`blind-spot:rock`, …). No
  contract change; the roster grows from 22 to 26 and the picker gets noisier.
- **(c)** Cut the card.

Ryan decides; the JQ-163 side's view on whether (a) is generically useful is what
the decision needs.

---

## 4. Provision — `POST /api/v1/matches`

`assignment.seats[]` gains an optional `options`:

```json
{
  "lobbyId": "https://lobby.example",
  "lobby": { "returnUrl": "…", "graphqlUrl": "…" },
  "assignment": {
    "externalMatchId": "m_123",
    "gameMode": "duel-helpers",
    "bestOf": 5,
    "seats": [
      { "seatKey": "1", "lobbyUserId": "u_1",
        "options": { "kind": "Loadout", "choiceIds": ["ferrus", "chimera"] } },
      { "seatKey": "2", "lobbyUserId": "u_2",
        "options": { "kind": "Loadout", "choiceIds": ["oracle", "copycat"] } }
    ]
  }
}
```

**The game re-validates every selection** — arity, distinctness, membership. Not
distrust of the lobby: a lobby that could report helper state could report a win,
exactly as a client could. The lobby's validation is the good UX; the game's is the
authority.

### Rejections are `400`, never `403`

```json
{ "error": "invalid pre-queue selection", "seatKey": "1",
  "reason": "a loadout needs two different helpers" }
```

`403` is reserved by [`lobby-protocol-handoff.md`](./lobby-protocol-handoff.md) for
the banlist handshake and seat-reservation violations, and the lobby is told to
treat `403` as "re-matchmake, don't surface it". A malformed selection returning
`403` would make the lobby loop forever on a request that will never succeed.

---

## 5. Capability advertisement — `GET /api/v1/status`

**[CHANGE 4]** The status body gains `capabilities`:

```json
{ "game": "rock-paper-scissors-lizard-robot", "version": "…", "appEnv": "…",
  "standalone": false, "capabilities": ["preQueueOptions"] }
```

The lobby needs to know whether a given game *deployment* understands `options`
before it sends them. `version` cannot express that without the lobby maintaining a
per-game version table, which is exactly the coupling the manifest design exists to
avoid. A game that omits `capabilities` is read as supporting nothing new.

---

## 6. Deploying the two sides — default, then tighten

Neither repo should have to deploy in the same minute as the other.

1. **Game ships first.** A `duel-helpers` provision with no `options` on a seat gets
   a **default loadout**: Ferrus + Featherweight, which places 2 marks on Robot and
   1 on Lizard — exactly RPSLR's existing `lizard: 1, robot: 2` opening. The mode is
   therefore correct and playable the moment the game ships, before the lobby knows
   it exists. Every defaulted seat logs a warning.
2. **Lobby ships second**, reads `capabilities`, sends real `options`.
3. **Then tighten.** `REQUIRE_PREQUEUE_OPTIONS=true` on the game turns a missing
   selection into a `400`. Rolling back is one environment variable, not a deploy.

A silent fallback is normally a bad idea. It is acceptable here only because the
fallback is a known-good, already-shipped position rather than an invented one, and
because the env var makes the window closeable and the warning makes it visible.

---

## 7. Fixtures

`docs/fixtures/prequeue/` holds golden request and response bodies. **They are the
specification**; both repos test against them, and code is checked against the
fixture rather than the reverse.

| File | Covers |
| --- | --- |
| `game-modes.duel-helpers.json` | §1 |
| `queue-options.duel-helpers.json` | §2, all 22 choices |
| `queue-options.duel.json` | §2 empty-choices case |
| `status.capabilities.json` | §5 |
| `provision.valid.json` | §4 happy path |
| `provision.missing-options.json` | §6 default-loadout path |
| `provision.duplicate-helper.json` | §4 → `400` |
| `provision.unknown-helper.json` | §4 → `400` |
| `provision.wrong-arity.json` | §4 → `400` |

A fixture change is a contract change: it lands in both repos or neither, and the
version at the top of this document goes up.

`scripts/stub-lobby.sh` replays a provision fixture against a locally-running game
API, so the game repo's tests and CI never need a lobby.
