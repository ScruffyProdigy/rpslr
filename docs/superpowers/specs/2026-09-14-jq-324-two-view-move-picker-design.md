# JQ-324 — Two-view move picker: Your moves / Opponent's moves

One board, two views, switched by tabs. The pentagon stops encoding both players
at once and shows one player's options at a time, defaulting to your own.

Supersedes JQ-94's and JQ-106's requirement that both perspectives stay encoded
on the live picker simultaneously. Their rule accuracy and accessibility work is
kept; only the "both at once" premise is dropped.

## Why

The UX refresh improved the encoding and the board is still hard to read: your
selectable moves, your cooldown causes, the opponent's availability and the
threats they can make all share five nodes and ten arrows. Splitting the two
perspectives is cheaper than compressing them further.

## What the two views are

The board is the same pentagon in both: five fixed positions, same dimensions,
same button set. What changes is whose state the nodes and arrows read.

### Your moves (default)

- Your delays; your cooldown pills and causes (`cooldownReason`, ledger-aware).
- Your `beats` graph, including any edge a helper granted you (Chimera's curve).
- The forced-but-playable paint from JQ-215, decided by shared legality
  (`isPlayable` / `isForcedPick`), never by `marks > 0`.
- Your tentative selection, and the explicit `Lock in [move]` action.
- **No opponent encoding at all**: no opponent hourglass badges, no faded
  "attacks they can't make" arrows.

### Opponent's moves (inspect only)

- Their delays and mark counts, their `beats` graph and their added edges.
- Their cooldown causes phrased in the third person.
- `aria-disabled` on the moves they cannot play; those nodes stay inspectable.
- No selection, no `aria-pressed`, no `Lock in` control, and nothing about their
  unrevealed commitment for this round.

## Arrow state, per view

The fade (`beat-arrow--opp-off`, renamed to a view-neutral `--off`) means "this
attack cannot be made this round" and is scoped to whoever's board is open:

| | Your moves | Opponent's moves |
|---|---|---|
| Edge leaves a move the viewed player can't play | faded | faded |
| Preview highlight on a tapped move | every outgoing edge of that move lights | n/a |
| Tentative pick carried into the other view | n/a | edges connecting your pick to their **live** moves light, both directions |

Two decisions inside that table:

**The preview highlight in Your view is not gated on opponent availability.**
Previewing Rock lights `rock → scissors` and `rock → lizard` because the caption
says "Rock crushes Scissors & Lizard". Dropping an arrow because they cannot
play Lizard this round puts the board and the caption in disagreement, and
rebuilds the two-perspectives-on-one-board problem this ticket removes.

**The cross-player comparison lives in the opponent view.** With a tentative
pick, their board lights exactly the edges that connect your pick to a move they
can actually play — your pick beats this one; that one beats your pick — read
through both graphs, so an asymmetric pair (Chimera) is never assumed to be
symmetric. Edges to moves they cannot play this round stay faded. The full
beginner-facing version of this comparison is JQ-326, which this ticket unblocks;
what is built here is the mechanism, not the teaching.

## The tabs

A single `role="tablist"` inside `MovePicker`, above the board, so the live match
and the replay share one implementation and one accessibility surface.

- Two tabs: `Your moves` / `<Opponent>'s moves`. On a replay, where there is no
  "you", both tabs carry player names and the strip defaults to the side being
  called for; `Voice` already draws that distinction and is reused rather than
  duplicated.
- Each tab shows the player's avatar and name, an explicit heading, and
  `aria-selected`. Active state is carried by weight and an underline, with the
  player's colour as a supplementary cue, never the only one.
- Keyboard: arrow keys move between tabs, the panel is labelled by its tab, and
  controls hidden with the inactive view leave the focus order entirely.
- Announcements name whose options are open without narrating both cooldown sets
  on every node.
- An obvious return to your own moves: the tab itself, plus a `← Back to your
  moves` action in the board's centre while inspecting.

### Paying for the tab strip's height

There is no spare vertical space. Measured from the shipped CSS:

| viewport | furniture | pentagon | slack |
|---|---|---|---|
| 390 × 844 | 489.1px | 254px | 0.9px |
| 375 × 812 | 489.1px | 222px | 0.9px |

So the strip is paid for rather than added:

- The legend collapses from two lines (39.2px) to one. In Your view it has a
  single item left — `⌛N your cooldown`, plus `curved = an extra rule` when
  helpers are in play — because the opponent badge and the faded-arrow clause no
  longer exist on that board. The opponent view's legend is the mirror of it.
- The board's phone `margin-top` and the `.move-picker` gap above the board are
  absorbed into the strip's own margin.

Net furniture goes up by roughly 14px, which the `svh` formula takes out of the
pentagon: ~254 → ~240 at 390px, ~222 → ~208 at 375px. Both stay above the 205px
floor that keeps a move button at JQ-108's 56px. `--board-furniture` moves with
it, and `boardFit.test.ts` recomputes the constant from the stylesheet, so the
two cannot drift apart silently.

## The centre, per view

Your view keeps today's `PickerCenter` exactly: idle prompt, preview caption,
forced-pick explanation, blocked-move explanation, `Lock in`, and the pinned pick
plus wait after lock-in.

The opponent view's centre explains the move you tapped on *their* board: what it
beats under their graph, why it is down and when it is back, and — when you are
carrying a tentative pick — the matchup both ways. A new
`describeMatchup(mine, theirs, myBeats, oppBeats)` in `moves.ts` states it, so no
caller has to assume the two graphs match. `← Back to your moves` sits in the
centre alongside it.

Your own lock-in status, the opponent's readiness, the score, the round and the
timer are not moved: they already live in the seat cards, the round label and
`.board-status`, all of which sit outside the tab panel and are visible in either
view.

## State and switching

`MovePicker` owns `view: 'mine' | 'theirs'`.

- Switching views never calls `onPlay`. It cannot commit, and it cannot clear a
  valid pending choice: `picked` survives a switch.
- The second-tap-to-commit sequence resets across a switch, so returning to your
  board never commits on what reads as a first tap.
- Opponent taps write a separate `inspected` state that never feeds `commit`
  or the auto-commit effect. Auto-commit is additionally gated on `view ===
  'mine'` so an inspection at the deadline cannot become a move.
- After lock-in, and whenever `disabled` holds, neither view accepts input.
- A new round resets the view to `'mine'` and clears both `picked` and
  `inspected`. A state refresh that is not a new round leaves the view alone, so
  an inspection is not interrupted by an ordinary update.
- Round resolution interrupts either view with the existing two-player reveal
  (`centerSlot`), and the next ordinary selection phase opens on Your moves.
- Forced actionable sub-phases keep their own explicit prompt
  (`SubPhasePrompt`); nothing here silently switches the view for them.

## Scope

Client UX only. No change to game rules, secrecy, timers, auto-commit policy or
the protocol. Spectator/replay keeps its play-along behaviour and its neutral,
name-based framing; replay redesign beyond the tabs is out of scope. No
hold-to-peek gesture in this slice.

## Verification

- `MovePicker.test.tsx` gains three blocks: switching (cannot commit, preserves
  a pending choice, resets the commit sequence, inert after lock-in, resets on a
  new round), asymmetric rules (each owner's added edges render in the right
  view; the matchup reads both graphs), and tabs (roles, `aria-selected`,
  keyboard operation, hidden controls leave the focus order, announcements name
  the viewed player).
- `boardFit.test.ts` counts the strip in `pageHeight`, keeps the furniture
  constant honest, and keeps the legend to one line.
- `board.browser.test.tsx` covers switch and return at 360px and at 390 × 844,
  including the helpers rail.
- Screen-reader validation on a real device is JQ-196's existing audit, extended
  rather than duplicated.
- Manual: on a phone, a new player selects a legal move, inspects an opponent
  cooldown, returns, and can say whose board is open. Record whether the
  next-round reset to Your moves helps or disrupts.
