# JQ-221 — The in-game ability HUD

Linear: [JQ-221](https://linear.app/joinquest/issue/JQ-221/in-game-ability-hud-see-a-charge-spend-it-name-its-target)
Depends on: JQ-220 (a firing's path from the player to the round) — merged, PR #14.
Builds on: JQ-215 (playable-but-marked) — merged, PR #19. JQ-207 (the client reads
the server's rules) — merged, PR #15.
Absorbs: JQ-150's client half — see "Oracle arrives without a prompt" below.

## Problem

Nothing under `client/src` reads a loadout, a charge or a firing. `App.tsx`
renders the pentagon and the round strip and that is the whole board, so a
player holding Quarantine or Rust can see no charge, spend nothing, and is told
nothing afterwards about what fired.

The server half is complete. JQ-220 opened `{"type":"fire", …}` on the socket and
`POST /matches/:ref/fire` beside it, validated every target in `namedMovesFor`,
and put the viewing seat's own charge state on `MatchState.abilities` — projected
per socket by `viewSnapshotAs`, so one seat's unresolved firing never reaches the
other. All six cards are reachable and none of them is reachable *by a player*.

## Non-goals

- The lobby's loadout picker. A different screen in a different repo.
- The pre-round loadout reveal, which JQ-149 owns. This ticket shows you your own
  cards, not a reveal of theirs.
- Retuning any ability's numbers. `roster.ts` is the authority and this reads it.

## Decisions

### The rail is your own cards, and the opponent has no rail

`MatchState.abilities` is the viewing seat's map and only ever that — it is
seat-private by construction, because a charge that reads unavailable is exactly
the tell that says an unresolved firing happened. AC #1 asks for charge state
"read from `MatchState`, never recomputed client-side from the round history",
and the only map that satisfies both halves is your own.

So there is no opponent rail. It could be recomputed — `seat.loadout` is public
and resolved firings are public — but recomputing is the thing AC #1 forbids, and
telling a player which two helpers the other side brought is JQ-149's job.
What the opponent's abilities do reaches you the same way it reaches them: in the
round account, once the round has resolved.

### The rail sits below the pentagon, and is absent without abilities

The pentagon is the tap surface. `App.tsx` already keeps an always-present
`board-status` slot above it for exactly this reason — "anything that appears
above it mid-decision would shift the board under the player's thumb" — so the
rail goes *below* `MovePicker` and above `History`, where appearing and
disappearing costs the tap surface nothing.

`duel` brings the null loadout, so `slotsFor(null)` is `{}`, so `abilities` is
`{}`. The rail renders `null` on an empty map rather than an empty container:
AC #7 asks for no empty rail and no layout shift, and the way to have neither is
to have no element.

### Three charge states, each carrying a word

`AbilityState` is `{ marks: number | null, available: boolean }` and reads three
ways, per JQ-195's rule that no state on the board is carried by colour alone:

| State | `marks` | Card says | Card does |
|---|---|---|---|
| Ready | `0` | "Ready" | enabled |
| Recharging | `n > 0` | "n more round(s)" | disabled |
| Spent for the match | `null` | "Spent" | disabled |

The word is the signal; colour and the charge pips are reinforcement. `marks:
null` is deliberately not `Infinity` server-side precisely so a client comparing
`marks > 0` cannot read it as available — the client honours that by branching on
`marks === null` first, before any arithmetic.

A card may also read Ready but be unfirable for the round: you have already fired
this round, the match is over, the socket is down, or the Oracle sub-phase is
running (`fireAbility` refuses during it — "the round is already resolving").
Those are round conditions rather than charge conditions, so they disable the
button and say why in its hint, and leave the charge word alone.

### Targeting is a step sequence inside the card, not a mode on the pentagon

Turning the pentagon into a target picker is tempting and wrong: it is the
element under the player's thumb for the whole round, its five nodes already
carry playability, cooldown cause, threat arrows and a reveal slot, and a
mis-tap during targeting would be a mis-tap on the thing that commits your round.

Instead a card that needs a target expands in place into a row of move chips.
Thief needs two, so the sequence is general: `targetSteps(helperId)` returns zero,
one or two steps, and the card walks them.

| Ability | Steps |
|---|---|
| Quarantine | one target, any move — it is a blind guess and every move is legal |
| Rust | one target, an opponent move currently carrying a mark |
| Thief | a source (one of yours carrying a mark), then a target (any of theirs) |
| Sacrifice, Freeze | none |
| Oracle | none — the server names its move, and refuses one from the client |

### Legality is asked, not restated

`legalTargets` mirrors `namedMovesFor` and is checked against the same delay maps
the server checks: `mySeat.delays` and `oppSeat.delays`, which are the marks as
they stand entering this round. An illegal chip renders `disabled` with the
reason spoken ("Rock is clear — Rust needs a move they have on cooldown"), so
AC #2's "an illegal target cannot be submitted" holds at the widget rather than
by hoping the player reads a hint.

The server still refuses. This is a courtesy, not a gate — `namedMovesFor` is the
authority, and a rejection surfaces in the existing error line.

### A firing is final, and the confirm step says so

JQ-220 settled AC #3 in the negative and wrote it into `ws.ts`: *"A firing is
final; there is no withdraw message, by design."* There is no withdraw route to
call, so the card does not offer one.

What it offers instead is a confirm step that states it: after the last target is
named, the card shows what is about to happen and two buttons — **Fire** and
**Cancel**. Cancel is withdrawal of an *unsent* firing, which is the only kind
there is; once Fire is pressed the charge is gone whether the ability lands or
not, and the confirm line says so in those words.

### Oracle arrives without a prompt, and this ticket builds it

JQ-150 is closed, and its merge touched `client/src/api.ts` for types and no
other client file. There is no re-pick prompt. `api.ts:22` says the prompt
"belongs with the ability HUD (JQ-221)" while JQ-221 lists it as JQ-150's
non-goal; the code is right and the ticket is stale. Without it Oracle is the one
card that can be fired and then does nothing visible, which is worse than a card
that cannot be fired at all.

The protocol needs nothing new. During the sub-phase the holder re-picks by
sending an ordinary `move`, which `submitMove` routes to `replaceMove` and
resolves on; re-sending the move they already had is how a holder says "keep it";
letting the clock run out keeps it too, at no strike, because both players did
pick on time.

So the prompt is:

- Shown when `match.phase === 'oracle'` and `state.oracle.round ===
  match.currentRound` — the round guard is why `OracleReveal` carries a round.
- Says the named move — "They did not play **Paper**" — or, when `namedMove` is
  null, that they played their only live move and there is nothing to name.
- Re-opens the pentagon for the holder, with a **Keep <Move>** button that
  re-sends the current pick.
- For the *non*-holder, the picker stays locked and the status slot says the
  round is resolving. `submitMove` refuses them anyway ("your move is locked
  while the round resolves"); the board should not offer what the server refuses.

`RoundTimer` needs no change: it reads `phaseDeadline`, so the shorter sub-phase
clock already renders as a shorter clock.

`App.play` currently returns early on `lockedMove || currentRoundMoves[me] ||
pendingMove`. That guard is what stops a double-commit and it has to stay for the
pick phase, so the re-pick is an explicit exception rather than a loosening: when
the sub-phase is running and this seat holds the reveal, the guard is skipped and
the local pick state is cleared so the board follows the new choice.

### The round account lives in History

AC #4 wants the board to say, after a round resolves, which abilities fired and
what they did, for both seats. `abilityFirings` is exactly that and is withheld
until the round resolves, which is the same moment `results` grows.

`History` already lists resolved rounds for both seats, is durable — you can look
back three rounds later, which a reveal card cannot offer — and needs no new
timing. Firing lines join the round they belong to, attributed by `seatKey`:

> R3 · You played Rock, they played Paper · **Rust** — you added 2 marks to their Scissors

`RevealCard` is left alone. A second copy of the account, on a timer, is a second
thing to keep in step for a moment the player is already reading.

### Transport mirrors a move

`sendFire` on the socket with the REST `/fire` route as fallback, exactly as
`play` does — the socket is the path, and REST still publishes to the opponent
through the hub. Round is named on both, so a firing that arrives after its round
resolved is refused rather than landing on the next one.

## Shape

New:

- `client/src/abilities.ts` — pure. Held cards from `@game/helpers/roster` and
  `slotsFor`, charge phrasing, `targetSteps`, `legalTargets`, and the prose for a
  resolved firing. No React, no fetch.
- `client/src/components/AbilityRail.tsx` — the rail, its cards, and the
  idle → target → confirm walk.
- `client/src/components/OraclePrompt.tsx` — the sub-phase panel.

Changed:

- `client/src/api.ts` — `MatchState` gains `abilities: AbilityMap` and
  `oracle: OracleReveal | null`, plus `api.fireAbility`.
- `client/src/ws.ts` — `sendFire`.
- `client/src/App.tsx` — rail and prompt placement, the re-pick exception.
- `client/src/components/History.tsx` — firing lines.
- `client/src/styles.css` — rail, card, chip and prompt rules.

## Testing

- `abilities.test.ts` — legality against `namedMovesFor`'s rules for all six
  cards, the three charge readings including `marks: null`, and the firing prose.
- `AbilityRail.test.tsx` — the rail is absent on an empty map (the duel case);
  each charge state renders its word; an illegal chip cannot be clicked; Thief
  walks two steps; Cancel sends nothing; Fire sends once with the named moves.
- `OraclePrompt.test.tsx` — the named move and the null case; Keep re-sends the
  current pick; a stale round renders nothing.
- `Board.test.tsx` — a duel board is unchanged, and the rail does not appear.
- The standing guard suites cover the rest: `designSystem` (tokens, no emoji),
  `boardFit` (tap targets at 360px and 320px, no overflow), `motionSafety`
  (reduced motion removes motion, not meaning).
