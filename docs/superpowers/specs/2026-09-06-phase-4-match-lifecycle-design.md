# Phase 4 — Match lifecycle screens

Source: `Claude outputs/rpslr-ux-plan.md` §Phase 4. Follows Phases 1–3, which are
merged on `main`.

## Problem

The two ends of a match are the thinnest screens in the game.

**Before the opponent claims their seat**, the board shows a rule note, the
scoreboard, the line `Waiting for all seats to be filled…`, and a fully drawn
but disabled pentagon. The player has nothing to do and nothing to read. This is
the one stretch of dead time in a match, and the game spends it saying nothing —
even though a new player arriving from the Lobby has never been told the rules
beyond a single line.

**After the match ends**, `Board` renders a winner avatar, a banner, and a Back
to Lobby button, with the scoreboard still above it and the history strip below.
There is no final score anywhere on the screen — the only record of `3 – 1` is
the round pips in a scoreboard that is now stale. Two Back to Lobby buttons
render: one in `match-results` and one that `History` adds when it is handed a
`lobbyReturnUrl`. The loss banner uses `--danger`, so losing a game of Rock
Paper Scissors is coloured like a server error.

**Errors** from `play()` and the socket render at the bottom of the board, below
the picker and above the history — far from the tap that caused them.

## Non-goals

- No room-code display, copy, or share. No rematch. The Lobby owns invites and
  re-queueing.
- No new API calls or state. Everything here is drawn from `MatchState`.
- The standalone create/join `Lobby` view is dev tooling and stays as it is.

## Design

### 1. `HowToPlay` — three panels, two mounts

One component, rendered bare inline or wrapped in a dialog:

- **Inline**, in place of the `Waiting for all seats to be filled…` hint, while
  `!allSeated && !finished`. The picker is disabled in that state anyway, so
  the panels take its place rather than sitting alongside it.
- **In a `<dialog>`**, opened by a `?` button in the topbar, available for the
  whole match.

The three panels:

| Panel | Content |
|---|---|
| What beats what | The `HowToPlayGraph` (below). |
| Cooldowns | A move you play rests for 2 rounds; Lizard and Robot start the match on cooldown. Shows the real `⏳ N` pill so the mark is learned before it appears on a button. |
| First to 3 | `winsNeeded(bestOf)` round wins takes the match, drawn as the same win pips the scoreboard uses. |

The panels stack on a phone and sit in a row on a wide screen; the dialog is a
bottom sheet under 640px and a centred card above it. `<dialog>` gives the focus
trap, `Esc`, and backdrop dismissal without a library.

### 2. `HowToPlayGraph` — the pentagon, one move at a time

Uses `lib/pentagon.ts` (`CIRCLE_ORDER`, `circleNodePos`, `ARROW_INSET`,
`BOARD`), so the shape is the board's own pentagon at a smaller size. It lights
**one** node and its **two** outgoing arrows, captioned with
`describeBeatsOf(move)` — "Rock crushes Scissors & Lizard" — and steps through
all five moves.

Drawing all ten arrows here would re-introduce exactly the "ten identical
arrowheads teach nothing" problem Phase 2 exists to fix. Five readable beats
teach the same graph, and the geometry match means what is learned here
transfers to the board directly.

Stepping: auto-advances every 2.5s, with tappable dots to jump and a paused
state once the player touches a dot. Under `prefers-reduced-motion` it does not
auto-advance and opens on Rock with the dots as the only control.

### 3. `MatchEndCard` — replaces the board

When `match.status === 'finished'` and no reveal is playing, `Board` returns
`MatchEndCard` instead of the board. The scoreboard and picker come off screen
entirely, so the end state reads as an end state rather than a board with a
banner on it.

Contents, in order:

1. Winner's avatar at `lg` with a trophy ring, and their name.
2. Verdict: `You win the match!` / `{Opponent} wins the match.` The loss variant
   is neutral (muted foreground on the standard surface), not `--danger`. Red is
   left to errors, per the Phase 1 colour rule.
3. Final score, `3 – 1`, read from the seats' scores in your-first order.
4. The round strip.
5. One primary **Back to Lobby**.

`describeOutcome` already maps an outcome to a viewer-relative verdict; the
final score comes from `mySeat.player.score` and `oppSeat.player.score`, the
same numbers the scoreboard pips draw.

### 4. `RoundStrip` — extracted from `History`

The chip strip in `History` is lifted into its own component so the end card and
the in-match history render the same thing. `History` keeps the heading, the
tapped-chip detail line, and the `All rounds` disclosure, and composes
`RoundStrip` for the chips.

`History` loses its `lobbyReturnUrl` prop and `LobbyReturnFooter`. It was only
ever passed a URL when the match was finished, which is precisely when the end
card now owns that button — this is what removes the duplicate.

### 5. Errors move next to the action

The board-level error moves from below the history to directly **under** the
picker, inside the `.moves` block. Under, not above: the `board-status` slot
above the picker exists so that nothing appearing mid-decision shifts the
pentagon under the player's thumb, and an error is exactly the kind of thing
that appears mid-decision.

### 6. `PlayerAvatar` gains `winner`

A `winner` prop adds a gold ring and a small 🏆 badge. It composes with the
existing `role` colouring rather than replacing it, so a winning opponent keeps
their amber identity and gains the trophy.

## Components

| File | Status |
|---|---|
| `client/src/components/HowToPlay.tsx` | new |
| `client/src/components/HowToPlayGraph.tsx` | new |
| `client/src/components/MatchEndCard.tsx` | new |
| `client/src/components/RoundStrip.tsx` | new (extracted) |
| `client/src/App.tsx` | `?` button, pre-match mount, end-card branch, error move |
| `client/src/components/History.tsx` | composes `RoundStrip`; drops lobby return |
| `client/src/components/PlayerAvatar.tsx` | `winner` prop |
| `client/src/styles.css` | panels, dialog, end card, trophy ring, neutral loss |

No API, `moves.ts`, or `pentagon.ts` changes — the helpers Phase 2 and 3 added
(`beatsOf`, `describeBeatsOf`, `winsNeeded`, `describeOutcome`) already cover
what these screens need to say.

## Testing

- `HowToPlayGraph.test.tsx` — five steps; each caption equals
  `describeBeatsOf(move)`; exactly two arrows drawn per step; dots jump to a
  move; no auto-advance under `prefers-reduced-motion`.
- `HowToPlay.test.tsx` — three panels render; the `?` button opens the dialog
  and `Esc` closes it.
- `MatchEndCard.test.tsx` — final score in your-first order; winner name and
  trophy; **exactly one** Back to Lobby link; loss variant carries no danger
  class.
- `Board.test.tsx` — finished matches render the end card and no picker; the
  pre-match state renders the panels, not the old waiting line; an error renders
  after the picker in DOM order.
- `History.test.tsx` — updated for the extracted strip; asserts `History` no
  longer renders a lobby return button.

## Acceptance criteria

- [ ] Pre-match wait shows the opponent's reserved name/avatar plus three
      how-to-play panels; the `Waiting for all seats to be filled…` line is gone
- [ ] A `?` in the topbar opens the same panels at any point in a match, and is
      dismissable with `Esc`, the backdrop, and a close button
- [ ] The graph panel steps through all five moves with the correct verb line
- [ ] Match end shows winner avatar + trophy, verdict, final score, round strip,
      and exactly one Back to Lobby button
- [ ] Losing renders in neutral colour; `--danger` appears only on errors
- [ ] Board errors render under the picker; the pentagon does not shift when one
      appears
- [ ] `npm run test`, `npm run lint`, and `npm run build` pass in `client/`
- [ ] No horizontal overflow at 320px on either new screen
