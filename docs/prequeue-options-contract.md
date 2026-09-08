# Pre-Queue Options — Lobby ↔ Game Contract

**Contract version:** 4
**Status:** Agreed and closed. Nothing open.
**Game side:** [JQ-146 epic](https://linear.app/joinquest/issue/JQ-146), primarily
[JQ-148](https://linear.app/joinquest/issue/JQ-148)
**Lobby side:** [JQ-163](https://linear.app/joinquest/issue/JQ-163) — **already
implemented**, PR #45, CI green

How a game declares that a mode has a pre-queue pick, how the lobby fetches the
roster of choices, and how a player's selection reaches the game.

RPSLR's `duel-helpers` is the first real consumer. The lobby side shipped first, so
where the two designs disagreed the shipped shape generally wins — noted per section.

Companion to [`lobby-protocol-handoff.md`](./lobby-protocol-handoff.md), which covers
discovery, provisioning, link-out and claim. Read that first; this only adds options.

## Changelog

| Version | Date | Change |
| --- | --- | --- |
| 4 | 2026-09-08 | Blind Spot cut from the roster (Ryan). The roster is 21 helpers. `exclusionKey` keeps its specification but has no consumer and is **not to be built** until one appears. |
| 3 | 2026-09-08 | `exclusionKey` agreed and promoted into §2. Added the sibling-replacement rule for pickers at max, the ban on inferring exclusion from id syntax, and the degenerate-roster rule. |
| 2 | 2026-09-08 | Negotiated with JQ-163. `group`→`section` to resolve a collision; `select`→per-group `min`/`max`; `rosterPath` dropped for the conventional path; `capabilities` dropped; `blurb`→`description`; provision options become an array of per-group selections. |
| 1 | 2026-09-08 | First draft from the JQ-146 epic plan. |

## Vocabulary — the one collision worth knowing about

Both sides independently used **"group"** for different things. Resolved:

- **Selection group** (`preQueue.groups[]`) — an *independent roster with its own
  arity*. A mode can ask for a weapon **and** an armour set: two groups, picked
  separately. This is the lobby's shipped meaning and it keeps the name.
- **Section** (`choices[].section`) — a *display heading inside one roster*. RPSLR
  has one selection group whose 21 choices fall under three sections: Major, Minor,
  Trinket.

RPSLR is therefore **one group, three sections** — not three groups.

---

## 1. Mode manifest — `GET /api/v1/game-modes`

```json
{
  "key": "duel-helpers",
  "displayName": "Helpers",
  "minPlayers": 2,
  "maxPlayers": 2,
  "seatTemplate": { "count": 2 },
  "preQueue": {
    "groups": [
      {
        "key": "helpers",
        "kind": "Loadout",
        "label": "Choose your two helpers",
        "min": 2,
        "max": 2,
        "sectionOrder": ["Major", "Minor", "Trinket"],
        "locking": "none"
      }
    ]
  }
}
```

- `min`/`max` live **on the group**, not the block, so a weapon+armour mode is two
  groups with their own arity. Both default to `1`, so a champion picker is just
  `{key, kind, label}`. `min: 0` makes a group optional.
- **Duplicates are rejected within a group** — the validator already enforces it and
  there is no `distinct` field. Correct for RPSLR: two helpers bound to the same
  *move* are legal, the same *helper* twice is not.
- `sectionOrder` sits on the group because sections subdivide a group's choices.
  Order is meaningful — RPSLR's reads as a price ladder — and neither alphabetical
  nor roster order produces it.

**The manifest is also the capability signal.** The lobby sends `options` only for a
mode whose own manifest declares `preQueue`. A game deployment that declares it
necessarily understands it; one that doesn't never receives the field. No version
table, no separate flag, and it self-synchronises in either deploy order. (v1
proposed a `capabilities` array on `/api/v1/status` for this; it isn't needed and
was dropped.)

A mode without a pre-queue pick omits `preQueue`.

---

## 2. Roster — `GET /api/v1/players/{lobbyUserId}/queue-options?modeKey=…`

A **fixed conventional path**, not one the game declares. It matches the shipped
mode-eligibility endpoint, so integrators learn one rule, and the lobby
SSRF-validates `apiBaseUrl` once rather than having to prove a game-declared path
stayed on its own origin. (v1 proposed `rosterPath`; withdrawn — the security
argument is better than the flexibility one.)

There is **no static/inline roster mode**. Live won outright: a CCG's roster is "the
decks you built", which no manifest can express.

```json
{
  "modeKey": "duel-helpers",
  "choices": [
    {
      "id": "ferrus",
      "label": "Ferrus",
      "section": "Major",
      "badge": "2 marks",
      "description": "Your Robot takes 1 mark instead of 2.",
      "locked": false
    }
  ]
}
```

- `section`, `badge` and `description` are rendered **verbatim, uninterpreted**. The
  lobby never learns what a "mark" is. A champion picker uses `section: "Assassin"`,
  `badge: "Free"`.
- `description` is the shipped name for what v1 called `blurb`, documented in
  integration guide §13. Kept so the docs don't fork.
- A mode with no pre-queue pick returns `{ "modeKey": "duel", "choices": [] }` with
  **200**, not `404`.
- `locked` follows the mode-eligibility vocabulary from JQ-11/12/13 — a locked
  choice carries a requirement rather than vanishing. RPSLR sends `false` throughout.

### `exclusionKey` — "at most one of these"

> **Specified, not built (v4).** Blind Spot was cut, so nothing in the roster has
> variants and no game needs this yet. **Do not implement it** — an unused
> validation rule is a rule nothing keeps honest. The specification stays because
> the problem it solves is real and will recur the first time any game ships
> variants of one thing, and re-deriving it (including the two rules below, which
> cost a round trip to find) would be waste. Ryan's call, 2026-09-08: "there might
> be use for the exclusionKey at some point, we can cross that bridge when we get
> to it."

An optional string. **At most one choice per `exclusionKey` may be selected within a
group.** Choices without one are unconstrained.

```json
{ "id": "blind-spot:rock", "label": "Blind Spot: Rock", "section": "Minor",
  "badge": "1 mark", "exclusionKey": "blind-spot", "locked": false }
```

It exists because variants of one thing are distinct ids to the lobby and the same
thing to the game. Without it, a 2/2 group lets a player select `blind-spot:rock`
*and* `blind-spot:paper` — two distinct ids, so the lobby's only distinctness rule
("the same id twice") passes — and the game then rejects a loadout the lobby told
the player was fine. That is the `400`-should-be-unreachable invariant in §4 broken
by two clicks, and it was already broken before this field existed.

Three rules go with it:

- **Never infer exclusion from id syntax.** Splitting `blind-spot:rock` on `:` would
  couple the lobby to a game's id conventions and silently mis-group any game that
  uses a colon for something else. The field is explicit or it is absent.
- **A picker at `max` replaces the *sibling*, not the oldest pick.** Pickers that
  evict the oldest selection produce this: pick `blind-spot:rock`, pick `ferrus`,
  tap `blind-spot:paper` → `ferrus` is evicted and the player holds two Blind Spots.
  Invalid, in three ordinary clicks. Tapping a choice whose `exclusionKey` matches an
  already-selected one must replace **that** choice. It also reads correctly —
  "changing which Blind Spot" — and is better than disabling the siblings, which
  leaves a player who picked the wrong variant unable to see why the others died.
- **A group whose `max` exceeds its number of distinct exclusion classes has no
  valid selection at all.** A 2/2 group where every choice shares one `exclusionKey`
  is unsatisfiable, and it presents to a player as "this mode is mysteriously
  unjoinable". It is a roster bug; the game checks it when building the roster, and
  the lobby may reject it too rather than let a player discover it.

The client rule is the UX and the server rule is the authority — both sides enforce,
as with everything else here.

### This endpoint does not fail open

If it errors, times out, or returns unreadable JSON, the mode becomes **unjoinable**
and the player is told why. There is no safe default roster, so the lobby will not
invent one. A slow or flaky `queue-options` is therefore a full outage of the mode,
not a degraded experience — worth knowing before it is served off anything with a
cold start.

---

## 3. Queue join

The selection travels on `joinQueue` alongside `queuePath`, mirroring §4's array
shape — one entry per selection group.

---

## 4. Provision — `POST /api/v1/matches`

`assignment.seats[]` gains an optional `options`, an **array of per-group
selections**:

```json
{
  "seatKey": "1",
  "lobbyUserId": "u_1",
  "options": [
    { "groupKey": "helpers",
      "optionIds": ["ferrus", "chimera"],
      "labels": ["Ferrus", "Chimera"] }
  ]
}
```

- An **array** because an object cannot carry a weapon *and* an armour selection.
  RPSLR's is a one-element array — cheap now, and a second mode with two groups
  needs no contract change.
- **No `kind`** on the selection. It is already in the manifest; repeating it on
  every seat of every provision only invites the two copies to disagree.
- `labels` are the game's own strings captured at pick time, stored so a waiting
  player still reads "Ferrus" if the game is unreachable. **The game ignores them**
  — they are not authoritative and must never be read back as identity.

**The game re-validates every selection** — arity, distinctness, membership. Not
distrust: a lobby that could report helper state could report a win, exactly as a
client could. The lobby's validation is the good UX; the game's is the authority.

### Rejections are `400`, never `403`

```json
{ "error": "invalid pre-queue selection", "seatKey": "1",
  "reason": "a loadout needs two different helpers" }
```

`403` is reserved for the banlist handshake and seat-reservation violations; the
shipped lobby parses `403` specifically as the banlist shape and treats every other
non-2xx as a hard error, so there is no re-matchmake loop on a `400`.

Two properties worth stating explicitly:

- **A `400` fails the whole provision, not one seat.** Every player in that match is
  affected. `seatKey` in the body is for diagnosis; the lobby cannot salvage the
  other seats.
- **A `400` should be unreachable in practice**, because the lobby already validated
  the selection against the roster this game served this player. If one fires, it is
  a bug on one side or the other. The game's re-validation stays — authority belongs
  with the game — but neither side should design around `400` as a routine path.

---

## 5. Deploying the two sides

The manifest self-synchronises (§1), so no capability flag and no ordering
constraint. What remains on the game side:

A `duel-helpers` provision with **no** `options` on a seat gets a default loadout of
Ferrus + Featherweight — 2 marks on Robot, 1 on Lizard, exactly RPSLR's existing
`lizard: 1, robot: 2` opening. Every defaulted seat logs a warning, and
`REQUIRE_PREQUEUE_OPTIONS=true` turns it into a `400`.

This is now a **narrow** safety net rather than the deploy mechanism it was in v1:
it covers standalone mode, the stub-lobby harness, and any provision that omits
options for a reason neither side anticipated.

---

## 6. Fixtures

`docs/fixtures/prequeue/` holds golden bodies. **They are the specification**; both
repos test against them and code is checked against the fixture, never the reverse.
A fixture change is a contract change: it lands in both repos, and the version at the
top of this document goes up.

| File | Covers |
| --- | --- |
| `game-modes.duel-helpers.json` | §1 |
| `queue-options.duel-helpers.json` | §2, full roster |
| `queue-options.duel.json` | §2 empty-choices case |
| `queue-options.unavailable.json` | §2 fail-closed behaviour |
| `provision.valid.json` | §4 happy path |
| `provision.missing-options.json` | §5 default-loadout path |
| `provision.duplicate-helper.json` | §4 → `400` |
| `provision.unknown-helper.json` | §4 → `400` |
| `provision.wrong-arity.json` | §4 → `400` |

`scripts/stub-lobby.sh` replays a provision fixture against a locally-running game
API, so the game repo's tests and CI never need a lobby.

---

## 7. Blind Spot, and why `exclusionKey` exists anyway

**Resolved 2026-09-08: Blind Spot is cut.** Ryan's reason is a design one rather
than an integration one — *"Blind Spot's ability doesn't seem like it would be fun
in general"* — so it is not a card worth carrying a contract feature for.

The roster is therefore **21 helpers** and **210 loadouts**. The tier split moved
separately under JQ-209 (Second Wind promoted, Poker Face demoted) and is
**10 Majors / 5 Minors / 6 Trinkets** as of `main`. `api/src/helpers/roster.ts` and `ladder.test.ts` on `main` already
reflect this.

### What this leaves behind

Nothing in the roster now has variants, so `exclusionKey` has no consumer. It keeps
its specification in §2 and is explicitly **not to be built** — an unused validation
rule is one nothing keeps honest, and it would sit in the lobby untested until the
day it mattered.

Keeping the specification is still worth it. The problem it solves recurs the moment
any game ships variants of one thing, and two of the three rules around it were only
found by trying to use it:

- a picker at `max` must replace the *sibling*, not the oldest pick, or three
  ordinary clicks produce an invalid selection;
- a group whose `max` exceeds its exclusion classes is unsatisfiable and presents as
  a mysteriously unjoinable mode.

Both cost a round trip between the two repos to discover. Re-deriving them later
would be waste; reading §2 would not.

### If Blind Spot ever comes back

It would need a way to name a move at pick time. The options were: a parameterised
choice (`{id, param}`) — generic, but a conditional sub-selection rather than one
field, so real contract and UI surface; or one roster entry per move, which is what
`exclusionKey` was specified for. The second is cheaper and migrates to the first
cleanly, since only ids change.
