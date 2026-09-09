# JQ-215 — A playable-but-marked state for the move selector

Linear: [JQ-215](https://linear.app/joinquest/issue/JQ-215/move-selector-needs-a-playable-but-marked-state)
Depends on: JQ-210 (the five cooldown effects) — merged, PR #10.
Builds on: JQ-207 (client reads the server's rules) — merged, PR #15.

## Problem

`availableMoves` has a floor. Normally it returns the moves on zero marks, but
helpers can drive every move above zero — Quarantine deepens what you played,
Rust blocks what is left, Freeze stops the decrement that would have freed
something — and a player with nothing to play cannot submit, waits out the
timer, and takes an expiry strike for a state they had no way to escape. Strikes
forfeit the match. So when nothing is clear, the least-marked moves are playable.

The server honours that floor: `service.ts` gates a submitted move on
`availableMoves(delays).includes(move)`, and `roundPolicy.ts` auto-picks from the
same list. `MovePicker` does not. It asks `(myDelays[move] ?? 0) > 0` in four
places and calls that unplayable, so on exactly the round the floor exists for,
the board greys out every move and refuses every tap while the server stands
ready to accept any of the least-marked ones. The player sees a dead board and
takes the strike anyway.

The same lie is told about the opponent. Four more reads treat
`oppDelays[m] > 0` as "they cannot play that", which drives the faded threat
arrows, the `safe` flag meaning *this move cannot lose*, the screen-reader
legend, and the replay commentary's prose. Against a fully-marked opponent all
four say they can play nothing: every arrow draws faded, every move reads safe.
That is worse than a dead board — a dead board stops you, whereas this hands you
a false all-clear and you lose to a least-marked pick the server was always
going to allow.

Unreachable until JQ-210, because nothing drove all five moves above zero. It is
reachable now.

## Non-goals

- Retuning the floor. `availableMoves` is the server's rule and this ticket
  makes the client agree with it, not argue with it.
- The lobby's loadout picker. Different component, different question — that one
  is about which helpers you bring, not which move you play.
- Surfacing *why* every move is marked. Naming the ability that did it is the
  ability HUD's job (JQ-221); this ticket only has to stop lying about what is
  playable.

## Decisions

### The client asks, it does not decide

JQ-207 made `api/src/game.ts` reachable from the frontend: `vite.config.ts`
aliases `@game/*` at `api/src/*` and rewrites the api's NodeNext `./foo.js`
imports back to `.ts`, so the rules engine bundles into the client. The client
already imports `INITIAL_DELAYS` and `DELAY_ON_CHOICE` through it.

So the shared helper is not a reimplementation of the floor. It is a call to it:

```ts
// client/src/moves.ts
import { availableMoves } from '@game/game';

/** Playable this round — the server's own rule, not a copy of it. */
export function isPlayable(move: Move, delays: Record<string, number>): boolean {
  return availableMoves(asDelayMap(delays)).includes(move);
}

/** Marked, and playable anyway: the floor is the only reason it is offered. */
export function isForcedPick(move: Move, delays: Record<string, number>): boolean {
  return isPlayable(move, delays) && (delays[move] ?? 0) > 0;
}
```

`Record<string, number>` and not `DelayMap`, because that is what the picker
holds — `myDelays` and `oppDelays` both arrive off the wire loosely typed, and
every existing read of them is written `?? 0` against a missing key.
`availableMoves` needs a total `Record<Move, number>` or its `Math.min` over the
five moves goes `NaN` and the floor silently returns nothing, so a small
`asDelayMap` fills the gaps with zero. That is the one piece of arithmetic this
module owns, and it is defaulting, not rule-keeping.

Both take the delay map as the second argument rather than closing over a side,
so the opponent's board can ask the same question about the opponent.

This is the first acceptance criterion, and it is the whole of it. There is no
arithmetic here to keep in step with the server, because there is no arithmetic
here. `moves.ts` is where the picker's other presentation predicates already
live (`threatsTo`, `cooldownCause`), so the two go there rather than into a new
module.

`isPlayable` re-derives the list per call. The board has five nodes and the map
has five keys; a memo would cost more to read than it saves.

### One flag becomes two

`MovePicker` currently derives a single `onCooldown` per node and hangs the
class, the `aria-disabled`, and the label off it. That flag conflates "has
marks" with "cannot be played", which is precisely the bug. It splits:

| | today | after |
|---|---|---|
| blocked | `myDelay > 0` | `!isPlayable(m, myDelays)` |
| forced | — | `isForcedPick(m, myDelays)` |

The two are mutually exclusive by construction, and `blocked || forced` is
exactly `myDelay > 0`, so nothing else on the node has to move.

**Criterion 4 then holds structurally rather than by care.** When any move is on
zero, `availableMoves` returns precisely the zero-marked moves — so `blocked` is
identical to today's `myDelay > 0` and `forced` is empty for every node. Every
duel round and nearly every helpers round renders byte-identically. The new
state cannot appear except in the case it exists for.

### The four call sites

All four become one question, asked of the helper:

1. `handleClick` — was "on cooldown, so inspect but never commit". Now: a
   playable move commits on the second tap whether or not it carries marks; a
   blocked move still only opens its explanation.
2. The `AUTO_COMMIT_AT_S` effect — had its own copy of the same `> 0` test, and
   so would decline to auto-commit a forced pick and let it expire into a strike.
   It now gates on `isPlayable`, and agrees with the tap path because it is
   asking the same function, not the same-looking expression. That is criterion 6.
3. `PickerCenter`'s "why this is down" panel — gated on `myDelay > 0`, which
   would swallow a forced pick's Lock in button. Gated on `blocked` instead.
4. The node's class/`aria-disabled`/label derivation, per the table above.

### The opponent's four

Same swap, no new visual state — the opponent side has only two cases, can and
cannot, because you are not choosing for them and there is nothing to price:

1. `threatsTo` — `live` is the moves that beat yours *and* the opponent can
   play, and `safe` means none of them can. `oppDelays[m] === 0` becomes
   `isPlayable(m, oppDelays)`. This is the load-bearing one: `safe` is the claim
   that a move cannot lose.
2. `describeBeatsGraph` — the screen-reader line naming the attacks they cannot
   make. Against a fully-marked opponent it currently claims all five are off;
   after, it names only the ones actually out of reach, and falls through to
   "every arrow is live" when the floor leaves them everything.
3. `MovePicker`'s `oppOff` — the faded arrow flag, which is the sighted player's
   version of the same sentence and has to agree with it.
4. `commentary.ts` — the trap line asserts `beatsOf(move).every(m => oppDelays[m] > 0)`,
   i.e. *nothing they could play beat it*. As prose in a replay this is not a
   greyed button but a false statement of fact, so it takes the negated helper.

Sites 5 and 6 (`oppDelay` in the node badge and in `PickerCenter`'s caption) are
left alone. They report a mark count, which is true either way; they make no
claim about playability.

### How it reads

Three states, separated on channels that survive a colour-blindness check:

| | border | glyph | pill |
|---|---|---|---|
| clear | solid `--line-3` | full colour | none |
| **forced** | **solid, `--warn` tint** | **full colour** | **`⏳ N`, `--warn`** |
| blocked | dashed `--line-2` | `--muted`, 0.75 | `⏳ N`, neutral |

A forced pick stays in the *playable* family — solid border, full-strength
surface and glyph — because the one thing it must not read as is blocked. What
marks it out is the pill it shares with the blocked state, recoloured so the
count reads as a price rather than a lockout. Against clear it differs by having
a pill at all; against blocked, by border style, glyph treatment and pill
colour. Three channels, none of them colour alone.

No new motion, so `prefers-reduced-motion` needs no new rule — the existing
`@media` block covering `.move-btn` already applies, and the state adds only
static properties. Sizing is inherited from `.move-btn`, which is `cqw`-based,
so 360px comes free.

### What the centre says

The cost is real and worth naming. `computeDelays` does
`delays[move] += DELAY_ON_CHOICE` *on top of* what is already there, so playing
a move on 2 marks brings it back on 3 rather than 2. Playing your way out of a
locked board digs the hole deeper, and the player should be able to see that
before committing rather than discover it next round.

So `PickerCenter` gains a third branch, between the blocked "why" panel and the
ordinary caption:

> Rock crushes Scissors & Lizard
> **Every move is marked — Rock is your cheapest. Playing it puts it down to 3.**
> `[ Lock in Rock ]`

"down to 3" is computed as `myDelays[move] - 1 + DELAY_ON_CHOICE`, mirroring the
decrement-then-add order `computeDelays` uses, so the number is what will
actually happen and not an approximation of it. The node's `aria-label` carries
the same sentence, so the state is not colour-only for a screen reader.

The blocked branch is untouched: `cooldownCause` still explains a move that is
genuinely down, and on a forced round the more-marked moves still get it.

## Testing

`moves.test.ts`:

- `isPlayable` agrees with `availableMoves` across the mark maps `game.test.ts`
  already pins, including the all-marked and tied-least cases.
- `isForcedPick` is false for every move whenever any move is on zero.
- `isPlayable` against a partial map — a key missing rather than zero — does not
  return the empty list. This is the `NaN` trap `asDelayMap` exists for, and it
  fails loudly rather than quietly greying the board.
- `threatsTo` against a fully-marked opponent reports their least-marked movers
  as live, and `safe` is false for a move one of them beats.
- `describeBeatsGraph` says "every arrow is live" when the floor gives the
  opponent every move back.

`MovePicker.test.tsx`:

- A marked least-marked move, with nothing on zero, previews on the first tap
  and commits on the second — criterion 2.
- A more-marked move in the same round still refuses to commit.
- Auto-commit at `AUTO_COMMIT_AT_S` fires for a tapped forced pick. This is the
  regression the current code would fail: it returns early today.
- The unchanged-affordance case — one move on zero, everything else marked —
  renders exactly the cooldown treatment it does now, and no node carries the
  forced class. Criterion 4, as a test rather than a claim.
- The centre names the resulting mark count for a forced pick, and offers Lock
  in for it.
- A fully-marked opponent does not draw every arrow faded.

`commentary.test.ts`:

- The trap line is withheld when the floor leaves the opponent a move that beats
  the pick. A replay that says "nothing they could play beat it" about a round
  where something could is the failure this prevents.
