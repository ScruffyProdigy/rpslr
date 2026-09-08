# Helpers Mode (JQ-146) — Epic Plan & Lobby Contract

> **For agentic workers:** This is the *epic* plan — sequencing, the cross-repo wire
> contract, and the coordination protocol with the JQ-163 agent. Individual tickets
> get their own plans under `docs/superpowers/plans/`. Use
> superpowers:subagent-driven-development to run them.

**Goal:** Ship `duel-helpers`, a second RPSLR mode where each player brings two of
22 helpers chosen before queueing, delivered to the game in the JoinQuest provision
payload.

**Architecture:** `api/src/game.ts` stays pure and gains a `PlayerRules` parameter;
a new `api/src/helpers/` module compiles a `Loadout` into `PlayerRules`. Loadouts
arrive from the lobby on provision, are re-validated server-side, and are never
reported by a client. `duel` is unchanged and shares every code path via a null
loadout.

**Tech Stack:** TypeScript, Express, Postgres (node-pg-migrate style raw SQL under
`api/migrations/`), Vitest, React + Vite, WebSocket via `api/src/ws.ts`.

## Global Constraints

- `duel` must play identically to today. A `duel` match produces **byte-identical**
  `MatchState` to the current build. This is a test, not an aspiration.
- Everything is server-authoritative. A client that could report its own helper
  state could report a win. The same-move random roll is server-rolled.
- `api/src/game.ts` stays pure — no I/O, no clock, no imports from `helpers/roster.ts`.
- The roster is **all 22 helpers** (9 Majors, 8 Minors, 5 Trinkets) — Ryan's call,
  2026-09-08, over the design doc's recommended curated 10.
- Loadouts are picked **pre-queue in the lobby only** — Ryan's call, 2026-09-08.
  There is no in-game draft screen. See "Consequences of pre-queue-only" below.
- A loadout is any **two distinct** helpers. No slot rule.
- Mark costs: Major 2, Minor 1, Trinket 0, placed on the helper's bound move.
- Only a Major may carry a charge. A Minor or Trinket with one is a **build error**
  (a TypeScript type error), not a runtime check.
- Tier ladder prices one tier step at 3pp of ability. It is fitted to two constants:
  a two-helper loadout and `DELAY_ON_CHOICE = 2`. Changing either invalidates it.
- Colour/type tokens: `--warn` for urgency, never `--danger`; never `--you`/`--opp`
  for anything shared. `--font-display` with `tabular-nums` for digits.
- Everything renders at 360px and respects `prefers-reduced-motion`.

---

## Decisions taken

| Question | Decision | Who |
| --- | --- | --- |
| Roster size for v1 | All 22 helpers, 231 loadouts | Ryan, 2026-09-08 |
| Where the pick happens | Pre-queue in the lobby only; no in-game draft | Ryan, 2026-09-08 |
| JQ-163 contract status | **Not frozen** — the game may push changes back as real data appears | Ryan, 2026-09-08 |
| Missing `options` on provision | Default to Ferrus + Featherweight (today's `lizard: 1, robot: 2` opening), until `REQUIRE_PREQUEUE_OPTIONS=true` | This plan, §Tandem deploy |
| Rejection code for a bad loadout | `400`, not `403` — `403` is reserved for banlist and seat-reservation | This plan |

### Consequences of pre-queue-only

Choosing pre-queue-only over an in-game draft has four effects the tickets do not
yet reflect. Each is handled by a task below.

1. **`duel-helpers` has no in-game way to pick a loadout, so the lobby is in the
   loop for every playtest.** A basic lobby is already standing (Ryan, 2026-09-08),
   so this is a coordination cost rather than a blocker. The stub-lobby harness
   (Task 0.3) still earns its place: it keeps the game's own test suite and CI free
   of a lobby dependency, and it keeps the game workable while the lobby side is
   mid-change. It is a test double, not the primary path.
2. **JQ-149 changes meaning.** It is no longer a draft screen. Its timer, auto-pick,
   blind-pick, no-card-disabled, live-pentagon-preview and reload-restore criteria
   all belong to the lobby now. What remains game-side is a **reveal**: both
   loadouts flip face-up, the same-move roll is disclosed, round 1 begins. JQ-149
   must be rewritten to say that before anyone builds it.
3. **Blindness is free.** Picking before matchmaking means neither player can
   counter-pick, so the design doc's blind-simultaneous machinery is unnecessary.
   Mirror loadouts remain legal for the same reason.
4. **Blind Spot needs a home.** "At draft, name one of your moves" has no draft to
   happen at. It becomes a second-order selection inside the pre-queue pick, which
   the current `choiceIds: string[]` contract cannot express. See §Contract, note 3.

### Open, and blocking JQ-147

**The four charge Majors are underpriced and must be resized before they are built.**
The design doc is explicit: Rust, Freeze, Thief and Sacrifice are each a one-off
tempo nudge worth about +0.2 for one round (≈ +3.7pp of match win) against passives
earning 9–10pp. Under "all 22" they cannot be deferred. Task 1.0 puts concrete
numbers in front of Ryan for sign-off; **no charge Major is implemented until that
is signed off.**

---

## Gaps found that no ticket covers

Both were found by reading the code, not the tickets. Both need Linear issues.

### Gap A — the client re-implements the rules, and helpers break it

`client/src/replay.ts:27-46` keeps its **own copies** of `INITIAL_DELAYS` and
`DELAY_ON_CHOICE` and reconstructs both players' cooldowns from `results[]`
(`replay.ts:122-123`). `client/src/commentary.ts:12` imports them, and
`commentary.ts:247` computes "back in N turns" from `DELAY_ON_CHOICE`.

Every one of those numbers is wrong in `duel-helpers`. Ferrus, Featherweight,
Tempered, Copycat and Bookend change what a move costs; Quarantine, Rust, Thief,
Grudge, Echo Chamber and Small Mercy change the opponent's marks; Freeze stops
decrementing. A `duel-helpers` replay would render a board that never existed, and
the commentary from JQ-121/JQ-204 would narrate it confidently.

JQ-116, JQ-121 and JQ-204 are all Done and all assume the fixed constants.

**Needs a new ticket:** replay and commentary become loadout-aware, or
`duel-helpers` matches are excluded from replay until they are.

### Gap B — the replay card's move verbs are checked against a global `BEATS`

`api/src/replayCard/moveVerbs.ts:32` exports every matchup its verb table claims so
a test can compare it against `BEATS`. Chimera makes `BEATS` per-player by adding
`lizard → scissors` for its owner. A Chimera win therefore has no verb, and the
consistency test either fails or has to be weakened.

**Needs a new ticket,** or a scoped decision to give Chimera wins a generic verb.

---

## The wire contract

This is the artifact to agree with the JQ-163 agent **before either side writes
code**. It lives at `docs/prequeue-options-contract.md` with golden fixtures under
`docs/fixtures/prequeue/`, and both repos test against those fixtures.

Ryan has confirmed the JQ-163 contract is not frozen — RPSLR is its first real
consumer, so where the prototype's shape does not survive contact, the game side
proposes a change rather than working around it. Four such changes are marked
**[CHANGE]** below.

### 1. Mode manifest — `GET /api/v1/game-modes`

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
    "locking": "none",
    "rosterPath": "/api/v1/players/{lobbyUserId}/queue-options?modeKey=duel-helpers"
  }
}
```

**[CHANGE 1] `select` replaces the prototype's `options` string.** The prototype
carries `options: "22 helpers"`, which is display copy. The lobby cannot derive
*how many* a player must pick from it, and "choose your two helpers" is a label, not
a rule. Without `select`, arity validation is impossible on the lobby side and every
game hardcodes its own. `select: { min, max, distinct }` is generic and covers a
single-character pick (`{min:1,max:1}`) as easily as a loadout.

**[CHANGE 2] `rosterPath` resolves JQ-163's open question in favour of live fetch.**
JQ-163 asks whether the roster is static in the manifest or fetched live. JQ-148
already assumes an endpoint. Declaring the path in the manifest gets both: the lobby
learns where to look without hardcoding a game-specific URL, and a game that wants a
static roster can inline `choices` instead. Recommend `rosterPath` **or** inline
`choices`, exactly one.

### 2. Roster — `GET /api/v1/players/{lobbyUserId}/queue-options?modeKey=duel-helpers`

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

- All 22 choices, `locked: false` for every one — `locking: "none"`, no progression.
- `modeKey=duel` returns `{ "modeKey": "duel", "choices": [] }` with **200**, not 404.

**[CHANGE 3] `group` and `badge` are added; the lobby renders them without
interpreting them.** JQ-148 requires each choice to carry "its tier and mark cost",
and Ryan has confirmed (2026-09-08) that the lobby picker must **separate the Major,
Minor and Trinket sections**. Modelling tier and cost as first-class fields would
teach the lobby what a mark is. `group` is a section-header key, `badge` a short
verbatim string. A champion picker uses `group: "Assassin"`, `badge: "Free"`.
Neither field needs the lobby to understand the game.

Two sub-asks that go with it, because "separate the sections" is not only a data
question:

- **`groupOrder: ["Major", "Minor", "Trinket"]`** on the `preQueue` block. Section
  order is meaningful — the roster reads as a price ladder, cheapest last — and
  neither alphabetical nor roster order produces it.
- **Confirm the lobby renders `group` as sections rather than a flat list with a
  tag.** If the picker can only do flat, say so now: the fallback is to fold the
  tier into `label` ("Ferrus · Major"), which is worse but survivable, and the game
  should know before it writes the fixture.

**Note 3 — Blind Spot is unrepresentable.** Blind Spot's effect is "name one of your
moves; its cooldown is hidden all match". Under pre-queue-only there is no in-game
moment to name it, and `choiceIds: string[]` cannot carry a parameter. Options, in
rough preference order:

- **(a)** Expand the selection to `choices: [{ id, param? }]` — a second **[CHANGE]**
  to propose, and the only one that keeps Blind Spot as designed.
- **(b)** Explode Blind Spot into five roster entries (`blind-spot:rock`, …). No
  contract change; makes the roster 26 and the ladder arithmetic unchanged, but
  clutters the picker.
- **(c)** Cut Blind Spot from v1. Contradicts "all 22".

**This needs Ryan's decision, and it needs the JQ-163 agent's input on (a).** It is
the one place where "all 22" and "pre-queue only" genuinely conflict.

### 3. Queue join

The selection travels on `joinQueue` alongside `queuePath`:

```json
{ "preQueueSelection": { "modeKey": "duel-helpers", "choiceIds": ["ferrus", "chimera"] } }
```

The lobby validates arity, distinctness, membership and `locked` against the roster
it fetched. Rejection is server-side, not merely a disabled button.

### 4. Provision — `POST /api/v1/matches`

`assignment.seats[]` gains an optional `options`:

```json
{
  "lobbyId": "https://lobby.example",
  "lobby": { "returnUrl": "...", "graphqlUrl": "..." },
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

The game **re-validates** — arity, distinctness, membership. The lobby having
validated is not sufficient; a lobby that could report helper state could report a
win, exactly as a client could.

Rejections are `400` with `{ error, seatKey, reason }`. **Not `403`**:
`docs/lobby-protocol-handoff.md` reserves `403` for the banlist handshake and
seat-reservation violations, and a lobby that treats `403` as "re-matchmake" would
loop forever on a malformed loadout.

### 5. Capability advertisement — `GET /api/v1/status`

**[CHANGE 4]** Add `capabilities: ["preQueueOptions"]`. The lobby needs to know
whether a given game deployment understands `options` *before* it sends them, and
the existing `version` field cannot express that without the lobby keeping a version
table per game. This is what makes the tandem deploy safe in both orders.

### 6. Tandem deploy — default, then tighten

Neither repo should have to deploy in the same minute as the other.

- **Game deploys first.** A `duel-helpers` provision with no `options` on a seat
  gets the default loadout **Ferrus + Featherweight** — 2 marks on Robot, 1 on
  Lizard, which is exactly today's `lizard: 1, robot: 2` opening. The mode is
  therefore playable and correct the moment the game ships, before the lobby knows
  the mode exists.
- **Lobby deploys second**, reading `capabilities` and sending real `options`.
- **Then tighten.** Set `REQUIRE_PREQUEUE_OPTIONS=true` on the game so a missing
  selection becomes a `400`. Rolling back is one env var, not a deploy.

The default is a deliberate silent fallback, which is normally a bad idea. It is
correct here only because the fallback state is a *known-good, already-shipped*
position rather than an invented one, and because the env var makes the window
closeable. Log a warning on every defaulted seat so the window is visible.

---

## Coordination protocol with the JQ-163 agent

The problem: RPSLR is the first game to use pre-queue options, so there is nothing
real on either side to test against, and both sides are being built at once.

The answer is a **shared fixture set that both repos test against**, so neither side
waits for the other to be running.

### Artifacts (owned by this repo, mirrored to the lobby repo)

```
docs/prequeue-options-contract.md          # the contract above, versioned
docs/fixtures/prequeue/
  game-modes.duel-helpers.json             # §1 response
  queue-options.duel-helpers.json          # §2 response, all 22
  queue-options.duel.json                  # §2 empty-choices case
  provision.valid.json                     # §4 happy path
  provision.missing-options.json           # → default loadout + warning
  provision.duplicate-helper.json          # → 400
  provision.unknown-helper.json            # → 400
  provision.wrong-arity.json               # → 400
  status.capabilities.json                 # §5
```

- **Game side** asserts its handlers produce/accept exactly these bytes.
- **Lobby side** asserts its client parses them and its `joinQueue` validation agrees.
- A fixture change is a contract change: it lands in both repos or neither.

### Sync points

| # | Gate | Owner | Done when |
| --- | --- | --- | --- |
| S1 | Contract agreed, incl. the 4 `[CHANGE]`s and the Blind Spot question | **This session** ↔ JQ-163 agent | Both repos hold identical `docs/prequeue-options-contract.md` and fixtures |
| S2 | Game serves §1, §2, §5; accepts §4 | JQ-148 agent | Fixture tests green in the game repo |
| S3 | Lobby builds against a locally-running game API on `:3001` | JQ-163 agent | Lobby can queue and provision a real `duel-helpers` match, with the picker sectioned by `group` |
| S4 | Tandem deploy | Ryan | Game shipped, lobby shipped, `REQUIRE_PREQUEUE_OPTIONS=true` |

### Who talks to whom

**This session owns S1 and the contract document**, and messages the JQ-163 agent
directly. The contract spans JQ-147, JQ-148, JQ-149 and JQ-152; handing it to a
per-ticket subagent would give the negotiation to someone who can only see a sixth
of it.

Per-ticket agents do **not** negotiate. If one hits a contract problem, it reports
back here and this session renegotiates, so there is a single voice on the game side.

Escalate to Ryan, not to the other agent, for: the Blind Spot representation, the
charge-Major resize, and anything that changes the tier ladder.

---

## Sequencing

```
Task 0  Contract + fixtures + stub lobby     ← this session, blocks everything
   │
Task 1  JQ-147 rules engine                  ← blocks all four below
   │
   ├── Task 2  JQ-148 manifest + roster endpoint + provision options
   ├── Task 3  JQ-152 telemetry        (must land with first playable version)
   ├── Task 4  JQ-150 Oracle sub-phase
   ├── Task 5  JQ-151 per-player pentagon + helper-aware cooldown causes
   └── Task 6  JQ-149 loadout reveal   (rewrite the ticket first — see above)
   │
Task 7  Gap A — replay/commentary            ← new ticket needed
Task 8  Gap B — replay-card verbs            ← new ticket needed
```

Tasks 2–6 are parallelisable across agents once Task 1 merges. Task 3 is listed
early deliberately: JQ-152 says balance data that starts accumulating late is
balance data you do not have, and with 231 loadouts that is more true, not less.

### Per-task plans

Each gets its own plan document, written **after** the task it depends on merges, so
its interfaces are real rather than invented:

- `2026-09-08-jq-147-rules-engine.md` — written now, in this batch
- `2026-09-08-jq-148-manifest-and-roster.md` — after Task 0 (contract is its spec)
- The rest — after JQ-147 merges

---

## Task 0: Contract, fixtures, and the stub lobby

> **DONE 2026-09-08**, on branch `ryanckohler/jq-146-epic-plan-and-contract`.
> All five steps below are complete: the contract is at
> `docs/prequeue-options-contract.md`, the nine fixtures at
> `docs/fixtures/prequeue/`, the harness at `scripts/stub-lobby.sh`, and the
> proposal has been sent to the JQ-163 session (`local_2a534150…`, lobby repo,
> PR #45). **Awaiting their reply on the five `[CHANGE]`s and Blind Spot** —
> that reply is what unblocks JQ-148.

**Files:**
- Create: `docs/prequeue-options-contract.md`
- Create: `docs/fixtures/prequeue/*.json` (the nine files listed above)
- Create: `scripts/stub-lobby.sh`
- Modify: `docs/joinquest-integration.md` (link the new contract)

**Interfaces:**
- Produces: the fixture files every later task tests against, and
  `scripts/stub-lobby.sh <fixture>` — provisions a match against a locally-running
  API and prints claim URLs.

- [ ] **Step 0.1: Write the contract document.** Copy §1–§6 above verbatim into
  `docs/prequeue-options-contract.md`, with a `Contract version: 1` line at the top
  and a changelog table. Mark the four `[CHANGE]`s and the Blind Spot question as
  **Proposed — not agreed**.

- [ ] **Step 0.2: Write the nine fixtures.** Hand-author them from §1–§4. They are
  the specification; the code is checked against them, never the reverse. The 22
  entries in `queue-options.duel-helpers.json` come from the design doc's Majors,
  Minors and Trinkets tables.

- [ ] **Step 0.3: Write `scripts/stub-lobby.sh`.** It must `POST /api/v1/matches`
  with a chosen fixture, mint nothing (the game's standalone claim path is enough
  locally), and print the two play URLs. Follow `scripts/dev.sh`'s conventions —
  `source lib.sh`, `load_env`, `log`/`ok` helpers. This is the only way to play
  `duel-helpers` until S3, so it is not optional and not a scratch script.

- [ ] **Step 0.4: Send the contract to the JQ-163 agent.** Include: the four
  `[CHANGE]`s with their rationale, the Blind Spot question, the `400`-not-`403`
  point, and the default-then-tighten deploy rule. Ask for agreement or
  counter-proposals on each, not a general review.

- [ ] **Step 0.5: Commit.**

```bash
git add docs/prequeue-options-contract.md docs/fixtures/prequeue scripts/stub-lobby.sh docs/joinquest-integration.md
git commit -m "JQ-146: agree the shape of a pre-queue loadout before building one"
```

---

## Task 1.0: Resize the four charge Majors (blocks JQ-147)

**Files:**
- Modify: the Notion design doc's Majors table (via `notion-update-page`)
- Modify: `docs/prequeue-options-contract.md` fixture blurbs, if wording changes

Not a code task. Rust, Freeze, Thief and Sacrifice are each worth ≈ +3.7pp against
passives earning 9–10pp. Put concrete resized effects in front of Ryan — each
either scaled up to roughly a +0.5 one-shot swing (Oracle's proven size) or
converted to a passive — get sign-off, then update the design doc and the roster
fixture. **No charge Major is implemented before this closes.**

---

## Self-review

**Spec coverage.** JQ-147 → Task 1. JQ-148 → Task 2 (spec'd by Task 0's contract).
JQ-149 → Task 6, ticket rewrite required first. JQ-150 → Task 4. JQ-151 → Task 5.
JQ-152 → Task 3. JQ-146's own criteria: "`duel` plays identically" is a Global
Constraint and a JQ-147 test; "win rate measurable before any balance pass" is Task
3's placement in the order; "a passive Major never has to be remembered" falls out
of the type-level charge rule. **Not covered by any ticket:** Gaps A and B, and the
JQ-149 rewrite — all three are called out above rather than silently folded in.

**Placeholders.** None. The two genuinely open items — Blind Spot's representation
and the charge-Major numbers — are named as blocking decisions with owners and a
gate, not deferred as "TBD".

**Type consistency.** `Loadout`, `PlayerRules`, `choiceIds`, `select`, `group`,
`badge` are used identically here and in the JQ-147 plan.
