# Replay auto-commentary and just-in-time rule callouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (JQ-121):** A watcher who has never heard of RPSLR can learn the game from a replay itself — a sentence per round saying what happened, a strategy note when the cooldown state justifies one, and a rule card the first time each rule actually shows up on screen.

**Architecture:** `buildReplay()` (JQ-116) already derives everything the commentary needs — `delaysBefore`, `safeMoves`, `recentMoves`, `scoreBefore`/`score` — so no new data is computed and nothing is fetched. All copy lives in one pure module, `client/src/commentary.ts`, in the same shape as `moves.ts`: plain functions over frames returning plain strings, unit-tested without React. The page renders what those functions return.

The first-occurrence rule cards are scheduled the same way: a pure `ruleCardSchedule(frames)` decides, once, which frame each card belongs to. The component only tracks dismissal.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library. No new dependencies.

## Global Constraints

- **No new npm dependencies**, and **no server changes** — every input already exists on `Replay`.
- **No "You" / "Opponent" copy.** Players are named, per JQ-117. The commentary never addresses the watcher as a player either — one deliberate exception, the cooldown rule card, whose copy is quoted verbatim in the ticket ("Every move you play goes on cooldown for 2 rounds"); there "you" means "whoever is playing", not the watcher.
- **Never spoil a round the reveal card has not landed yet.** `ReplayPage` already gates the score and the winning edge on `settled` (`playback.beat !== 'reveal'`). Narration and callouts are gated on exactly the same flag.
- **Tone: neutral / explanatory**, not sportscaster (ticket's open question, answered 2026-09-07). Copy is a Content-pass placeholder — which is the whole reason it lives in a pure helper.
- **Mobile-first, works at 360px**; `prefers-reduced-motion` unaffected (the commentary does not animate).
- Tests: `cd client && npm test`. Lint: `npm run lint`. Typecheck+build: `npm run build`.

## Reuse, not reinvention

- `describeBeat(winner, loser)` in `moves.ts` gives "Paper covers Rock" — the ticket names it explicitly.
- `MOVE_META[m].label`, `beatsOf`, `threatsTo`, `winsNeeded` cover the rest of the vocabulary.
- **The 3-panel intro already exists.** `<HowToPlay>` is exactly "win graph · cooldown · first to N", `<HowToPlayDialog>` already wraps it in a focus-trapped modal with a Close, and `useFirstMatchRules` already opens it once and remembers that in `localStorage` via `prefs.ts`. AC 4 is wiring, not a new component.
- The replay reuses the **same** `howToPlay` note key as a match rather than a `replayIntro` of its own: it is the same three panels answering the same question, and someone who read them in a match should not be shown them again by a replay link.

## Data facts this plan leans on

- Every move beats exactly two and loses to exactly two, so `safeMoves` containing a move means *both* of its attackers were on cooldown — the callout can always name both.
- A drawn round therefore means both players played the *same* move.
- `delaysBefore` on frame 0 is the opening `{lizard: 1, robot: 2}` — the *starting* lock, which is the "Lizard and Robot start locked" rule, not the "moves you play go on cooldown" rule. The two must not be conflated.

## File Structure

**Create**
- `client/src/commentary.ts` — narration, callouts, rule-card schedule. Pure, no React.
- `client/src/commentary.test.ts`
- `client/src/components/ReplayCommentary.tsx` — renders the above under the board.
- `client/src/components/ReplayCommentary.test.tsx`

**Modify**
- `client/src/ReplayPage.tsx` — mount the commentary, add the `?` button and the first-visit intro, pause playback while the intro is open.
- `client/src/ReplayPage.test.tsx` — cover the wiring.
- `client/src/styles.css` — `.replay-commentary`, `.replay-rule-card`.

## Copy contract (what the pure helpers return)

**Narration** — `narrateRound(frame, names)`:
- decisive: `Ana plays Rock, Ben plays Paper — Paper covers Rock. Ben leads 2–1.`
- drawn: `Both play Rock — no winner. Ben leads 2–1.`
- score clause: `Ben leads 2–1.` / `Level at 2–2.` / `No score yet.` / `Ben wins the match 3–1.` (en dash, matching the ticket).

**Callouts** — `calloutsFor(frame, names, bestOf)`, in this order, at most one of each:
- `safe-pick` — the played move was in that side's `safeMoves`: `Paper and Robot were on cooldown for Ben, so nothing could cover or vaporize Rock — a safe pick.`
- `cooldown` — one per round, for the round's winner (a draw covers both, since both played the same move): `Ana's Paper is now out for 2 rounds.`
- `match-point` — the leader is one round short and the match is not over: `Match point for Ben.`

**Rule cards** — `ruleCardSchedule(frames)` returns one `RuleCardId | null` per frame index. Each card is placed at the earliest frame where its rule is visible in the data, and **at most one card lands on a frame** — a rule whose first frame is taken waits for the next frame where it still holds. Priority is the order a watcher needs them: `cooldown`, `unlock`, `safe`.

## Tasks

- [ ] **Task 1 — `commentary.ts` narration.** Test-first: decisive round, drawn round, tied score, 0–0, match-winning round. Then implement.
- [ ] **Task 2 — callouts.** Test-first: safe pick names both attackers and both verbs (and says one verb once when they match); cooldown line for the winner; draw wording; match point appears at `winsNeeded − 1` and not on the final round.
- [ ] **Task 3 — `ruleCardSchedule`.** Test-first: each card lands once, on the right frame, never two on one frame, `safe` absent from a replay with no safe move.
- [ ] **Task 4 — `<ReplayCommentary>`.** Renders narration + callouts + at most one dismissible rule card; renders nothing while `settled` is false.
- [ ] **Task 5 — wire into `ReplayPage`.** Commentary under the board; `?` button in the header; intro on first visit, remembered; opening it pauses playback and closing restores what it interrupted.
- [ ] **Task 6 — styles**, then `npm test`, `npm run lint`, `npm run build` all green.
