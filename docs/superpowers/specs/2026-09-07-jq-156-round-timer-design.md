# JQ-156 — Round timer and idle policy

Source: [JQ-156](https://linear.app/joinquest/issue/JQ-156). Follows Phase 4
([JQ-96](https://linear.app/joinquest/issue/JQ-96)), which is merged on `main`.

## Problem

There was no time limit on a round and no idle policy. If your opponent locked
in and walked away — or never picked at all — you waited indefinitely.
`submitMove` recorded a move and, if both were in, resolved; otherwise it
published state and waited forever. Nothing in the server fired without a client
message.

The reconnect bar and the 3s polling fallback both handle *your* connection
dropping. Neither handles a human who simply stops playing.

It matters more since the round reveal holds 3.2s: the pacing is decide → wait
an unbounded time → 3.2s reveal → decide. The unbounded segment is the one that
loses players.

## Non-goals

- No per-player clock accumulating across rounds. Per-round is enough at this
  match length.
- No new mode. `duel-helpers` is a design draft
  ([JQ-146](https://linear.app/joinquest/issue/JQ-146)); this ticket only makes
  sure the policy it will inherit already exists and already fits it.
- No background timer process, and no change to how state reaches the client.

## Decisions

| Question | Decision |
| --- | --- |
| Expiry policy | Escalating: auto-pick first, forfeit on the second consecutive miss |
| Round allowance | 20s of thinking time, plus the 3.2s reveal hold on rounds 2+; 45s for round 1 |
| Forfeit trigger | 2 consecutive expiries, **or** 45s disconnected |
| Auto-picked move | Uniformly random among that player's live moves |

**Why escalating.** One missed round is usually a tab-switch, not a departure;
ending the match on it is disproportionate. Two in a row is a departure. A
no-show therefore resolves in roughly 45 + 20 ≈ 65s, which is bounded enough
that waiting feels finite.

**Why 45s for round 1.** The how-to-play panels open themselves over the board on
a player's first match ever (JQ-96). They are ~850px of content in a 775px box
on a phone and the graph steps a move every 2.5s, so a thorough first read is
plausibly 30s. Round 1 is read-time plus decide-time; later rounds are only a
two-tap pick.

This is currently safe only because matchmaking is expected to pair newcomers
with newcomers. **The assumption stops holding the moment a newcomer can be
matched against a veteran** — at that point round 1's allowance needs revisiting,
and the sharper fix is to start the round-1 clock when the rules panel closes
(with a ceiling), which was considered and rejected here for putting a
client-reported event in charge of a server-authoritative deadline.

**Why the reveal hold is added rather than charged.** The client replays the
previous round's showdown for 3.2s (`REVEAL_HOLD_MS` + `REVEAL_OUTRO_MS`) with
the picker inert. Starting the deadline when the round advances would spend ~16%
of a 20s round on an animation the player cannot act during. The allowance for
rounds 2+ is therefore 23.2s. Deferring the deadline until the client reported
the reveal finished was rejected for the same reason as the round-1 variant: it
puts a client-reported event in charge of a server-authoritative deadline.

The constant is duplicated on the server, which is a real coupling — but a loose
one in the safe direction. If the two drift apart the player gets a second of
extra thinking time, never a wrong forfeit. Skipping the reveal is likewise just
generous.

**Why random, not safest.** A move chosen for you that happens to be the
strongest available rewards walking away. Uniform is neutral, unpredictable by an
opponent watching the clock, and still spends a cooldown — so absence carries a
real cost into later rounds.

## Design

### 1. The deadline is on a *phase*, not a round

`matches` gains `phase`, `phase_started_at`, `phase_deadline`. Only `'pick'`
exists today.

A round is not always one decision. `duel-helpers` adds an Oracle sub-phase —
after both players lock in, the charge-holder may spend it and re-pick before the
round resolves — and a draft screen with a ~30s clock of its own before round 1.
A deadline keyed to "the round" assumes a round ends when both moves are in,
which stops being true. Keying it to a phase costs one column now and saves
touching every call site later.

`phase` deliberately carries no `CHECK` constraint: each future phase would
otherwise be a migration.

### 2. The policy is a pure module

`api/src/roundPolicy.ts` — no I/O, no clock of its own:

```ts
policyForMode(modeKey): RoundPolicy        // duel and duel-helpers share one
deadlineFor(policy, phase, round, startedAtMs): number
chooseAutoPick(delays, rng): Move          // uniform over availableMoves()
decidePenalty({...}): ExpiryAction         // none | auto-pick | forfeit
```

`duel-helpers` is listed explicitly in the mode table rather than left to the
fallback, so adding the mode cannot silently invent a second idle policy. That is
the acceptance criterion about the two modes sharing the policy, discharged
without building the mode.

`chooseAutoPick` reads liveness through the existing `availableMoves` rather than
reimplementing it, so a helper that changes what "live" means (Ferrus,
Featherweight) stays correct for free.

### 3. Enforcement is lazy

Expiry is a pure function of `(deadline, now, moves)` evaluated on every state
read and every move, not by a background timer.

- **Correct across restarts and replicas for free.** An in-process `setTimeout`
  is lost on restart and invisible to a second replica; a derived rule is not.
- **Prompt where promptness matters.** The waiting player already polls every 3s
  ([App.tsx](../../../client/src/App.tsx)) precisely while waiting on an
  opponent, so the person who cares is the one driving the policy. Expiry lands
  within ~3s.
- **When nobody is watching, promptness has nobody to serve.**

This is a deliberate simplification of the design as originally presented, which
paired lazy evaluation with a timer for liveness. The timer is purely additive if
a future need appears.

Passes are serialized per match, so two concurrent readers cannot both auto-pick.
The `UNIQUE (match_id, round, player_id)` constraint on `moves` is the backstop.

### 4. Presence — absent vs slow

`api/src/presence.ts` tracks who holds a live socket, keyed by match and player,
refcounted so multiple tabs behave. In-process and not persisted, like
`MatchHub`; a restart drops every socket anyway.

The WebSocket layer had **no player identity at all** — `subscribe` carried only
a ref — so this is the genuinely new surface in the change. `subscribe` now
carries an optional `playerId`; a socket that omits it still receives state and
simply never counts as presence.

**A player never seen reads as present, not absent.** A REST-only client has no
socket, and treating unknown as gone would forfeit it the moment the grace
elapsed.

`markConnected`/`markDisconnected` live on `GameService` and resolve a join code
to a match id. Presence is keyed by match id but every caller holds a code —
resolving it at the service boundary keeps a mismatch that would *silently
disable the grace period* out of the transport layer.

### 5. Expiry is announced, and the announcement is persisted

`round_results.auto_picked` records who did not choose. Persisted rather than
broadcast once, so a player who reconnects after an expiry still learns it
happened, and the history strip can show it. `RevealCard` names it.

A forfeit ends a match without anyone scoring, so `matches` also gains
`winner_seat_key` and `end_reason`; `MatchEndCard` explains which of them ended
the match. Otherwise the loser sees a defeat they never played and the winner a
win they did not earn on the board.

`end_reason` is `played | forfeit-strikes | forfeit-disconnect | abandoned`.
`abandoned` is both players going silent: nobody was there to earn the win, so
there is no winner.

### 6. Client — render, never own

`useRoundDeadline` derives remaining time from `phaseDeadline` against
`serverNow`, not the device clock, which may be minutes off. The allowance comes
from `phaseDeadline - phaseStartedAt`, so it is identical on the snapshot that
opened the round and every snapshot after it — inferring it from arrival time
would shrink the total as the round ran down, and a progress ring drawn from that
would never move.

Under `prefers-reduced-motion` the per-second repaint is skipped; the value still
updates on each snapshot.

The clock renders between the two seat cards, stacked under the "vs". That row
is centred and already 201px tall, so it costs **no page height** — which matters
because the board overflows a 390x844 phone by ~111px during play
([JQ-165](https://linear.app/joinquest/issue/JQ-165)). It is also the honest
placement: there is one deadline, so there is one clock, and it belongs to the
round rather than to either player.

The expiry announcement lives in the pentagon's centre slot (`RevealCard`), which
overlays the graph and likewise costs no height. The `.hint.opponent-ready` pill
would have been the matching precedent but renders above the board.

Colour: urgency is `--warn`, never `--danger` (a clock running low is a state,
not an error) and never `--you`/`--opp` (fixed role colours — tinting a shared
clock with either would claim it belonged to that player). Type is
`--font-display` with `tabular-nums`, since digits changing in place twitch
otherwise. `--warn` and `--font-display` are Phase 5 tokens and carry fallbacks
until that branch lands.

## Constraint for Phase 5 and for JQ-147

**The clock must not react to lock-in state.** `RoundTimer` takes no lock-in prop
and renders identically whether or not either player has picked. `duel-helpers`
has a Minor called Poker Face whose entire effect is that the opponent is never
told you have locked in; a clock that paused, dimmed, or restyled itself on
commit would leak exactly that.

Today `Board` leaks lock-in openly via `opponentLockedIn`, which is fine for
`duel` and becomes JQ-147's problem. The point is not to add a second place that
has to be unpicked.

Also for `duel-helpers`: Quarantine and Sacrifice are per-round pre-pick inputs.
They must fit inside the same allowance, not extend it.

### 7. The tapped move gets the last word

A move is tapped, then locked. If you tapped one and ran out of time, having the
server play something else at random reads as the game taking the decision away
from you.

So two seconds before the deadline the client commits the tapped move through the
ordinary play path. No protocol change and no new state: **first write wins.**
`recordMove` rejects a duplicate in both repositories — Postgres on the unique
constraint, memory explicitly — so if the auto-commit loses the race (backgrounded
tab, slow network, dead client) the server's pick simply stands and the duplicate
is refused. `App.isLateMoveConflict` swallows that one message; surfacing "move
already submitted for this round" in red at the moment the round resolves would
be alarming and useless.

**It commits `picked`, never `preview`.** `preview` falls back to `hovered`,
which is desktop mouse-over and keyboard focus — auto-committing that would be
*worse* than random, since a cursor resting anywhere on the board would silently
decide the round. A tap is evidence of intent; a cursor is not. On touch there is
no `hovered` at all.

A move tapped only to ask "why can't I play this?" — one on cooldown — is not
committed either.

This does not weaken server authority the way deferring the deadline would have.
The server still owns when the round ends and still auto-picks when nothing
arrives; the client is given a last chance to speak, not trusted with the clock.

Nor does it undo two-tap: one tap is still not a commit. It commits at expiry,
where the alternative is not "nothing" but "a move chosen at random", and the
player can switch or clear right up to the threshold.

Because it arrives as an ordinary on-time move, it resets the strike run — the
player did choose. That does not reopen the idle hole: `picked` resets each
round, so someone who taps once and leaves auto-commits that round and then takes
strikes normally.

**Product call:** a player who tapped and walked away is treated as having
chosen. Ryan's decision, on the reading that a deliberate tap is the closest
available evidence of intent.

## Testing

- `roundPolicy.test.ts` — allowances, escalation, grace, auto-pick distribution
  with an injected RNG (20 tests).
- `presence.test.ts` — multi-tab refcounting, unknown-reads-as-present (9).
- `roundTimer.test.ts` — the policy end-to-end through `GameService` on an
  injected clock, so nothing waits in real time (22).
- `useRoundDeadline.test.ts` — countdown under a device clock five minutes fast
  and five minutes slow (8).
- `RoundTimer.test.tsx` — urgency thresholds, screen-reader labelling, and that
  it does not announce every tick (9).
- `Board.test.tsx` — the clock renders inside `.scoreboard` and not on the round
  label, so a later refactor cannot quietly re-break the height budget.

Beyond the suites, the whole policy was exercised against a real Postgres on a
throwaway container: jsonb round-tripping for `auto_picked`, persisted strikes,
both forfeit paths, and the down migration dropping cleanly. The in-memory
repository never touches the hand-written SQL.
