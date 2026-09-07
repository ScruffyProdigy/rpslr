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
| Round allowance | 20s, with 45s for round 1 |
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

The timer renders on the round label rather than in `board-status`, which sits
directly above the tap surface — a number changing every second there would shift
the board under the player's thumb.

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
