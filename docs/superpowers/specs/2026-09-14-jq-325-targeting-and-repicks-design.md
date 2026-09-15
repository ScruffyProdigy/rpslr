# JQ-325 — Ability targeting and re-picks in the two-view picker

Linear: [JQ-325](https://linear.app/joinquest/issue/JQ-325/ability-targeting-and-re-picks-integrate-with-the-two-view-move-picker)
Depends on: JQ-324 (the two-view move picker) — merged, PR #39.
Builds on: JQ-221 (the ability HUD) — merged. JQ-239 (the generalised sub-phase).
Reverses: one decision of JQ-221's, named below.

## Problem

JQ-324 split the pentagon into two views and made the opponent's board
**read-only**: a tap there inspects and can reach no commit path at all. That is
the right default and it leaves two flows stranded.

Four of the six helpers name a move on somebody's board. Rust, Quarantine and
Tripwire name one of *theirs*; Thief names one of yours and then one of theirs.
Today those are chosen from a row of chips inside the rail card, which now sits
under a board that is showing the very moves being named and cannot be used to
name them.

And the mid-round window — Oracle's reveal, or a public firing acted against you
— renders `SubPhasePrompt` *below* the pentagon while the picker stays on
whatever tab was open. A seat entitled to re-pick while inspecting the opponent
gets an actionable prompt under a board that refuses input.

## The decision this reverses

JQ-221 has a section heading that says the opposite of this ticket:

> **Targeting is a step sequence inside the card, not a mode on the pentagon.**
> Turning the pentagon into a target picker is tempting and wrong: it is the
> element under the player's thumb for the whole round, its five nodes already
> carry playability, cooldown cause, threat arrows and a reveal slot, and a
> mis-tap during targeting would be a mis-tap on the thing that commits your
> round.

That reasoning was sound against a single board that was always the commit
surface. JQ-324 removed the premise. The opponent's board is not a commit
surface — it has no `Lock in`, no `aria-pressed`, and its taps write to a
separate `inspected` state precisely so nothing on it can become a move. Three
of the four targeted cards name a move only over there.

Thief's first step is the real remaining case, because it names one of *your*
marked moves on the board that does commit. The answer is not to exempt it but
to make targeting a **mode**: while it holds, the two-tap sequence, `Lock in` and
the auto-commit are all suppressed, and a node tap is routed to naming before the
commit branch is ever reached. The protection JQ-221 wanted comes from the mode,
not from keeping targeting off the board.

So this supersedes that section. Everything else JQ-221 decided stands: one
ability system, `targetSteps` / `legalTargets` mirroring `namedMovesFor`, the
server as the authority on legality, charge state read and never recomputed, one
firing per slot per round, and a firing that is final once sent.

## What targeting is

### The walk moves out of `AbilityRail`

The idle → name → confirm walk is `AbilityRail`'s local `firing` state today. The
board has to render it now, and the rail and the picker are siblings under
`Board`, so the walk moves into a new hook, `client/src/lib/useAbilityTargeting.ts`,
owned by `Board`. `AbilityRail` keeps the cards, the charge words and
`blockedBecause`; `MovePicker` receives a small read-only view-model:

```ts
export interface Targeting {
  helperId: string;
  name: string;                 // "Rust"
  /** The step being answered, or null once every step has a move. */
  step: TargetStep | null;
  named: Partial<FiringChoice>;
  /** Which board must be open — `step.side`, or the last step's while confirming. */
  side: 'own' | 'opponent';
  /** This step's legal moves, from `legalTargets`. */
  legal: Move[];
  /** "Choose one of their moves for Rust" — names the ability and the side. */
  instruction: string;
  /** The step's own words, e.g. "Name a move they have on cooldown." */
  prompt: string;
  /** Why a disallowed move is disallowed, spoken on the node. */
  rejection: (move: Move) => string;
}
```

`targetSteps` already carries `side: 'own' | 'opponent'` — added by JQ-221 as
"whose board you are pointing at" and never read, because the chips drew against
`MarksBySide` instead. It is the whole "which board" signal and needs no new
data.

### The open board is derived while targeting holds

`MovePicker` keeps `view` state for ordinary use, but reads

```ts
const view = targeting ? (targeting.side === 'own' ? 'mine' : 'theirs') : viewState;
```

That is the mechanism behind AC #5, not a guard on top of one: during targeting
there is no path by which a tab can change the open board, because the stored
view is not being read. `PickerTabs` gains a `locked` prop — the tabs render
`aria-disabled`, keep `aria-selected` on the targeting side so the strip still
names whose board is open, and their click and arrow handlers no-op.

Thief moves the board itself between its two steps: your board for the source,
theirs for the target. That is a view change the player did not ask for, and it
is explained by the instruction in the centre naming the step each time.

### A node tap during targeting cannot reach `commit`

`handleClick` gains a branch **before** the existing `view === 'theirs'` and
two-tap branches:

```ts
if (targeting) { if (targeting.legal.includes(move)) onNameTarget(move); return; }
```

Illegal moves render `disabled` with `targeting.rejection(move)` spoken through
`aria-describedby` — the chips' existing behaviour, moved to the nodes, so AC #3
holds at the widget as well as at the server.

Suppressed for the duration of targeting: the preview highlight and `hovered`,
`Lock in`, the inspection state and the opponent centre, the matchup arrows, both
one-time note bars, and the auto-commit effect (which gains `!targeting` beside
its existing `view === 'mine'` gate). `picked` is **not** touched — that is AC
#6's "preserves a still-legal tentative move", and it comes for free because
targeting writes to none of the state a pick lives in.

### The instruction lives in the centre slot

Not a banner above the board. JQ-324 spent the page's last 0.9px on the tab strip
and left 3.5px of slack at 375×812; a banner would blow that budget and shift the
tap surface mid-decision, which is the thing `board-status` exists to prevent.
The centre slot is free, is already the board's one live region, and is already
what the reveal card takes over.

`TargetingCenter` renders into it, in place of `PickerCenter` / `OpponentCenter`:

- **Naming a step**: the instruction as the heading — *"Choose one of their moves
  for Rust"*, which is what distinguishes targeting from inspection at a glance —
  then `step.prompt` underneath in the card's own words ("Name a move they have on
  cooldown."), the moves named so far ("taking a mark from your Rock"), and
  **Cancel**. The prompt is reused rather than rewritten: it is the only place a
  player is told whether they hold Quarantine or Tripwire, which is the one thing
  that distinguishes the pair.
- **Confirming**: what is about to happen, JQ-221's exact finality line — *"This
  can't be taken back — the charge is spent whether or not it lands"* — and
  **Fire** / **Cancel**. AC #4 forbids implying a submitted firing is reversible,
  and that line is what already says so.

The round reveal still outranks everything: `centerSlot` is checked first, as it
is today. A reveal arriving mid-targeting is a staleness event (below), so the
two never contend for the slot.

### Cancel restores; Fire returns to Your moves

Straight from the ACs, and the asymmetry reads right — cancelling undoes an
interruption, firing completes an action:

- **Cancel** (AC #4) puts the view back to whatever was open when targeting
  started, restores the tabs, and sends nothing. `picked` is still there.
- **Fire** (AC #6) sends through the existing `onFire` → `sendFire` path,
  unchanged, and returns the view to `'mine'`.

Escape cancels, matching the board's existing Escape handling. When targeting
starts, focus moves to the first legal node, so pressing *Fire Rust* in the rail
does not leave focus inside a card that has become a status line (AC #10).

### Saying what was fired while the echo is in flight

AC #6 wants "a clear queued/fired status". This is **not** a protocol change —
the ticket's own Delivery section rules out backend changes, and JQ-220 settled
that a firing is sent and final. What is missing is only that the board says so
during the round-trip.

So the hook holds a local `fired: { name, summary }` until the server's own
`abilities` map catches up, and the rail card shows it — "Rust fired, naming
their Rock" — after which `charge.available === false` makes
`blockedBecause` say "You have already fired Rust this round", which is the
server's answer and the durable one. One firing per slot per round and the
two-charge-helper case are untouched: both are server state and neither is
re-derived here.

## Re-picks

### The window takes the board back

When this seat may re-pick — `mayRepick(state)`, which is already
`phase === 'react'` plus an entitlement for this round that has not `acted` —
the picker snaps to Your moves. A re-pick you cannot reach is not a window, and
the sub-phase runs on a short clock.

`MovePicker` gains `demandOwnBoard: number | null`, the round of an open window
this seat may act in. An effect fires when it changes to a non-null value —
once per window rather than on every state refresh, and again for a later round's
window — and sets the view to `'mine'` and clears `inspected`. Nothing else in the picker reads it.

The switch is attributed rather than silent, which is the half JQ-324 was
guarding: `Board` passes `idleCaption` — the prop that already exists for exactly
this, overriding "Pick a move" — as *"Something changed — pick again, or keep
your move"*, and `SubPhasePrompt` below says what changed and offers
**Keep <Move>** as it does today.

JQ-324's line — "nothing here silently switches the view for them" — is honoured
in the word *silently*. This ticket is what it deferred to.

An unentitled seat is unaffected: `demandOwnBoard` is null for them, the picker
stays `disabled` because `youMovedThisRound && !repicking`, and `submitMove`
refuses them anyway. Ordinary inspection cannot become a re-pick because nothing
about the view feeds the entitlement (AC #7).

Countdown, legal options, secrecy and the timeout behaviour are untouched.
`RoundTimer` already reads `phaseDeadline`, so the shorter sub-phase clock keeps
rendering as a shorter clock, and letting it run out still keeps your pick at no
strike.

### Targeting and the window cannot overlap

`fireAbility` refuses during the sub-phase — "the round is already resolving",
non-cascading, or a public firing inside a window would open another and the
round would never close. `firingUnavailable` already returns a reason for
`phase === 'react'`, so the rail will not start one; an *in-flight* targeting
when the phase turns is a staleness event, below.

## Staleness (AC #8)

Unsent targeting is cleared, never substituted, when any of these becomes true:

| Trigger | Told as |
|---|---|
| `match.currentRound` changed | "The round moved on." |
| `firingUnavailable(...)` turned non-null | its own words — the reveal, the sub-phase, a dropped socket, the opponent leaving |
| this card's charge stopped being firable | "Rust has already fired this round." |
| a named move left the step's legal set | "That target is no longer legal." |

The last is defensive: marks only move between rounds, so within a round the
legal set is stable — but a projection arriving for a seat mid-claim can re-shape
`abilities`, and a control that has quietly become invalid is exactly what AC #8
is about.

On any of them the hook clears `targeting`, restores the view, and records
`cancelled: { name, reason }`, which the rail card renders as a `role="status"`
line — *"Rust was not fired — the round moved on."* Nothing is auto-submitted and
no substitute target is chosen. The note clears on the next round or when a new
targeting starts.

## Ownership of the rail (AC #9)

The rail already survives a tab switch: same cards, same charge words, same place
below the board, because it lives outside the tab panel. What it lacks is a
visible owner, and with the opponent's board open above it an unlabelled row of
cards can read as theirs.

It gets one — `Your abilities`, or `<You>'s abilities` under a replay's `Voice`,
as the section's own visible heading, with the same possessive added to each
card's `role="group"` label.

**It is visible at ≥360px and `sr-only` below that**, and that is measured rather
than guessed. `boardFit.test.ts` holds the rail shorter than the board it serves;
the headroom today is 72.6px at 390×844, 40.6px at 375×812 and **8.1px at
320×568**. A heading row costs ~27.6px (a 19.6px line plus the rail's 8px gap),
which fits on both phones JQ-165 promised a duel board would not scroll on and
does not fit on the one screen where a duel board already scrolls. There the
spoken name still carries it, which is the reading that was load-bearing anyway:
a player who cannot see the heading is the player being told by their screen
reader.

The rail also takes the you-role accent, the same hue as your tab's underline and
your cooldown pills. That is reinforcement, not the signal — JQ-195's rule is
kept because the word is present in the accessible name at every width.

## Shape

New:

- `client/src/lib/useAbilityTargeting.ts` — the walk, the staleness rules, the
  fired/cancelled notes. Pure state over props; no fetch, no DOM.

Changed:

- `client/src/components/AbilityRail.tsx` — local `firing` state removed, the
  walk driven from props; the in-progress, fired and cancelled lines; the visible
  owner heading.
- `client/src/components/MovePicker.tsx` — `targeting` and `demandOwnBoard`
  props, the derived view, the targeting branch in `handleClick`, the
  suppressions, `TargetingCenter`.
- `client/src/components/PickerTabs.tsx` — `locked`.
- `client/src/App.tsx` — `Board` owns the hook and wires the three components
  together; `idleCaption` during a window.
- `client/src/styles.css` — the targeting board mode, the centre, the rail
  heading and accent.
- `client/src/boardFit.test.ts` — the heading counted in `railHeight`.

`client/src/abilities.ts` is unchanged. That is the "do not build a second
ability system" check: if this design needed a new legality rule, it would be
wrong.

## Testing

- `useAbilityTargeting.test.ts` — the walk for each card including Thief's two
  steps and its side change; cancel sends nothing and restores the view; fire
  sends once with the named moves; each staleness trigger clears without
  submitting and records its reason.
- `MovePicker.test.tsx` — targeting forces and holds the board, tabs are locked
  and cannot switch it, a node tap names rather than commits, an illegal node is
  disabled and says why, `Lock in` and the two-tap sequence are absent, a pending
  pick survives targeting and cancel, `demandOwnBoard` snaps to Your moves once
  per window and not on an ordinary refresh.
- `AbilityRail.test.tsx` — existing cases keep passing with the state lifted; the
  card reads as in-progress while targeting; the fired line appears before the
  server echo and gives way to it; a cancelled note names its reason.
- `Board.test.tsx` — a duel board is still unchanged and still has no rail; a
  window opening on the opponent tab lands the player on their own board with the
  prompt visible.
- `board.browser.test.tsx` — target an opponent move and cancel, at 360px and at
  390×844, with the rail present.
- `boardFit.test.ts` — the heading is inside the budget at both of JQ-165's
  phones and absent from the 320px measurement.
- Standing guards unchanged: `designSystem`, `motionSafety`, `liveRegions`.
- Manual, on a phone (AC #10): inspect the opponent, then target an ability;
  cancel and resume your own selection; complete a target; enter a re-pick window
  and let one expire. Screen-reader validation extends JQ-196's existing audit
  rather than duplicating it.

## Scope

Client only. No new abilities, no rule change, no protocol change, no change to
secrecy, timers or auto-commit policy. Replay keeps its neutral two-player
framing — it has no rail and no entitlement, so neither flow reaches it.
