# JQ-325 — Targeting and re-picks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ability targeting an explicit board mode in the two-view picker, and make a mid-round re-pick window take the board back, without adding a second ability system.

**Architecture:** The idle → name → confirm walk moves out of `AbilityRail`'s local state into a `useAbilityTargeting` hook owned by `Board`, which hands a read-only `Targeting` view-model to `MovePicker` and the same walk's handlers back to `AbilityRail`. While targeting holds, `MovePicker`'s open view is *derived* from `targeting.side` rather than read from state, which is what makes tab switching unable to move the board. A separate `demandOwnBoard` prop snaps the view to Your moves once per re-pick window.

**Tech Stack:** React 18, TypeScript, Vite, Vitest + Testing Library (jsdom), a second Vitest project for real-browser layout checks (`vitest.browser.config.ts`).

**Spec:** `docs/superpowers/specs/2026-09-14-jq-325-targeting-and-repicks-design.md`

## Global Constraints

- Client only. No change to `api/`, the protocol, game rules, secrecy, timers or auto-commit policy.
- `client/src/abilities.ts` is **unchanged**. If a task needs a new legality rule, the design is wrong.
- Legality is mirrored, never invented: `targetSteps` / `legalTargets` only. The server (`namedMovesFor`) stays the authority and a rejection surfaces in the existing error line.
- A firing is final once sent. The confirm step keeps JQ-221's exact words: `This can't be taken back — the charge is spent whether or not it lands.`
- No state carried by colour alone (JQ-195). Every targeting state has a word.
- Nothing may appear *above* the pentagon mid-decision. The centre slot (`.picker-slot`) is the only place targeting UI goes.
- The board's one live region is `.picker-slot`; do not nest a second `role="status"` inside it (JQ-157).
- `--board-furniture` stays a single declaration (`boardFit.test.ts` asserts it).
- Commands run from `client/`: `npm test` (jsdom), `npm run test:browser`, `npm run lint`, `npm run build`.

---

## File Structure

| File | Responsibility |
|---|---|
| `client/src/lib/useAbilityTargeting.ts` | **New.** The walk, the staleness rules, the fired/cancelled notes. Pure state over props. |
| `client/src/lib/useAbilityTargeting.test.ts` | **New.** Unit tests for the above, via `renderHook`. |
| `client/src/components/AbilityRail.tsx` | Cards, charge words, `blockedBecause`; the walk driven from props; in-progress / fired / cancelled lines; visible owner heading. |
| `client/src/components/MovePicker.tsx` | `targeting` + `demandOwnBoard` props, derived view, targeting branch in `handleClick`, suppressions, `TargetingCenter`. |
| `client/src/components/PickerTabs.tsx` | `locked`. |
| `client/src/App.tsx` | `Board` owns the hook and wires the three components; `idleCaption` during a window. |
| `client/src/styles.css` | Targeting board mode, targeting centre, rail heading and accent. |
| `client/src/boardFit.test.ts` | The heading counted in `railHeight`. |

---

### Task 1: The targeting walk as a hook

**Files:**
- Create: `client/src/lib/useAbilityTargeting.ts`
- Test: `client/src/lib/useAbilityTargeting.test.ts`

**Interfaces:**
- Consumes: `targetSteps`, `legalTargets`, `TargetStep`, `MarksBySide` from `../abilities`; `FiringChoice` from `../components/AbilityRail`; `HeldAbility` for the name.
- Produces:

```ts
export interface Targeting {
  helperId: string;
  name: string;
  step: TargetStep | null;
  named: Partial<FiringChoice>;
  side: 'own' | 'opponent';
  legal: Move[];
  instruction: string;
  prompt: string;
  rejection: (move: Move) => string;
}

export interface TargetingNote {
  name: string;
  /** 'fired' — sent, awaiting the server echo. 'cancelled' — cleared, with a reason. */
  kind: 'fired' | 'cancelled';
  text: string;
}

export interface AbilityTargeting {
  targeting: Targeting | null;
  note: TargetingNote | null;
  /** True while a walk is open for this card, so the rail can replace its Fire button. */
  isTargeting: (helperId: string) => boolean;
  start: (ability: HeldAbility) => void;
  name: (move: Move) => void;
  cancel: () => void;
  confirm: () => void;
}

export function useAbilityTargeting(input: {
  held: readonly HeldAbility[];
  marks: MarksBySide;
  round: number;
  /** `firingUnavailable(...)`'s answer — non-null means the round will not take a firing. */
  unavailable: string | null;
  onFire: (choice: FiringChoice) => void;
}): AbilityTargeting;
```

Zero-step cards (Sacrifice, Freeze, Oracle) open directly on the confirm step: `step` is null and `side` is `'own'`.

`instruction` is composed, not stored per card: `Choose one of ${side === 'own' ? 'your' : 'their'} moves for ${name}`.

- [ ] **Step 1: Write the failing tests** in `useAbilityTargeting.test.ts`, using `renderHook` from `@testing-library/react` and real `heldAbilities` output:
  - `start('rust')` opens on the opponent side with the legal set from `legalTargets`, and `instruction` reads `Choose one of their moves for Rust`.
  - `start('thief')` opens on `'own'`; naming a marked own move advances to `side: 'opponent'`; naming again puts `step` at null (confirm).
  - `start('freeze')` (no steps) opens straight on confirm with `step: null`.
  - `cancel()` clears `targeting` and never calls `onFire`.
  - `confirm()` calls `onFire` exactly once with `{ helperId, target, source }` and clears `targeting`.
  - After `confirm()`, `note` is `{ kind: 'fired' }` and its text names the ability and the named moves.
  - Staleness, one case each — `round` changes; `unavailable` turns non-null; the card's charge goes `available: false`; a named move leaves the legal set. Each clears `targeting`, sets `note.kind === 'cancelled'` with the matching reason, and calls `onFire` zero times.
  - `note` clears when `round` changes after it was set, and when a new `start` happens.
- [ ] **Step 2:** `npm test -- src/lib/useAbilityTargeting.test.ts` — expect FAIL (module not found).
- [ ] **Step 3:** Implement the hook. State is one `{ helperId, named }` plus a `note`; everything else is derived per render from `targetSteps(helperId)` and `legalTargets`. Staleness runs in a `useEffect` keyed on `round`, `unavailable`, the card's `charge.available`, and the derived legality of already-named moves.
- [ ] **Step 4:** `npm test -- src/lib/useAbilityTargeting.test.ts` — expect PASS.
- [ ] **Step 5:** Commit: `JQ-325: the firing walk, lifted out of the rail`

---

### Task 2: The rail drives the walk from props

**Files:**
- Modify: `client/src/components/AbilityRail.tsx`
- Test: `client/src/components/AbilityRail.test.tsx`

**Interfaces:**
- Consumes: `AbilityTargeting` from Task 1.
- Produces: `AbilityRail` props gain `targeting: AbilityTargeting` and lose nothing; `TargetRow` and `ConfirmRow` are **deleted** (the board owns both now). `FiringChoice` stays exported from this file — Task 1 imports it.

`AbilityCard` renders, in place of its Fire button, when `targeting.isTargeting(ability.id)`: a `<p>` reading `Naming a target on the board`. The `note` line renders on the card it names, as a `role="status"` paragraph.

The `<section className="ability-rail">` gains a visible `<h2 className="ability-rail__owner">` whose text is `Your abilities` (or `` `${voice.you}'s abilities` `` when `voice.you` is set), and `aria-label` on the section is dropped in favour of `aria-labelledby` pointing at it. Each `AbilityCard`'s `role="group"` label gains the same possessive.

- [ ] **Step 1: Write the failing tests** — existing cases rewritten against the new props plus: the card reads `Naming a target on the board` while its walk is open; a `fired` note renders and is replaced by `blockedBecause`'s `You have already fired Rust this round` once `charge.available` is false; a `cancelled` note names its reason; the rail is labelled `Your abilities` and each card's group label says whose it is.
- [ ] **Step 2:** `npm test -- src/components/AbilityRail.test.tsx` — expect FAIL.
- [ ] **Step 3:** Implement. Delete `TargetRow` and `ConfirmRow`.
- [ ] **Step 4:** `npm test -- src/components/AbilityRail.test.tsx` — expect PASS.
- [ ] **Step 5:** Commit: `JQ-325: the rail hands targeting to the board`

---

### Task 3: The tabs can be locked

**Files:**
- Modify: `client/src/components/PickerTabs.tsx`
- Test: `client/src/components/PickerTabs.test.tsx`

**Interfaces:**
- Produces: `PickerTabs` gains `locked?: boolean`.

When `locked`, every tab renders `aria-disabled="true"`, `aria-selected` still marks the open one, `onClick` and the arrow-key handler no-op, and the strip carries `data-locked="true"` for styling. The tabs stay in the focus order — a disabled control that vanishes moves focus, which AC #10 forbids.

- [ ] **Step 1: Write the failing tests** — a click on the inactive tab while locked does not call `onView`; ArrowRight while locked does not call `onView`; both tabs are `aria-disabled`; the active tab keeps `aria-selected="true"`.
- [ ] **Step 2:** `npm test -- src/components/PickerTabs.test.tsx` — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- src/components/PickerTabs.test.tsx` — expect PASS.
- [ ] **Step 5:** Commit: `JQ-325: a tab strip that can be held`

---

### Task 4: Targeting mode on the board

**Files:**
- Modify: `client/src/components/MovePicker.tsx`
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `Targeting` from Task 1, `locked` from Task 3.
- Produces: `MovePicker` gains

```ts
targeting?: Targeting | null;
onNameTarget?: (move: Move) => void;
onCancelTargeting?: () => void;
onConfirmTargeting?: () => void;
```

Implementation points, in one pass:

- `const view = targeting ? (targeting.side === 'own' ? 'mine' : 'theirs') : viewState;` — `setView` still exists for ordinary switching and is simply not read while targeting holds. `switchTo` returns early when `targeting` is set.
- `handleClick` gains the targeting branch first: name a legal move, ignore an illegal one, never reach `commit`.
- Node rendering while targeting: `disabled` unless `targeting.legal.includes(m)`; `aria-describedby` a hidden `targeting.rejection(m)` on the illegal ones; `data-targeting` on `.move-board`; no `move-btn--preview`, no `--inspected`, no `--selected` check mark change (a chosen move keeps its mark — it is still your pick).
- `preview`, `matchupEdges`, `showTapHint`, `showCooldownNote` all gated off while targeting.
- The auto-commit effect gains `&& !targeting`.
- Escape while targeting calls `onCancelTargeting` (checked before the existing `view === 'theirs'` and `picked` branches).
- The centre slot order becomes `centerSlot ?? (targeting ? <TargetingCenter/> : view === 'theirs' ? <OpponentCenter/> : <PickerCenter/>)`.
- A `useEffect` on `targeting?.helperId` + `targeting?.step?.field` focuses the first legal node.
- `demandOwnBoard?: number | null` — an effect that, when it changes to a non-null value, calls `setView('mine')` and `setInspected(null)`.

`TargetingCenter` renders `instruction` as its heading, `prompt` under it, a `named`-so-far line when non-empty, and Cancel; on the confirm step it renders the summary, the finality line and Fire / Cancel. No `role="status"` of its own.

- [ ] **Step 1: Write the failing tests** — a new `describe('targeting (JQ-325)')` block:
  - targeting on the opponent side opens their board even though `view` state is `'mine'`, and the tabs are locked.
  - clicking the locked opponent tab does not change the open board.
  - a tap on a legal node calls `onNameTarget` and never `onPlay`.
  - an illegal node is `disabled` and its reason is in the accessible description.
  - `Lock in` is absent while targeting, and a previously `picked` move is still picked after `onCancelTargeting` runs (simulated by re-rendering with `targeting={null}`).
  - the auto-commit does not fire at `secondsLeft = 1` while targeting.
  - Escape calls `onCancelTargeting`.
  - the confirm step renders the finality line and Fire calls `onConfirmTargeting` once.
  - `demandOwnBoard` going `null → 3` while on the opponent tab opens Your moves; a re-render with the same `3` does not re-switch after the player moves back to the opponent tab.
- [ ] **Step 2:** `npm test -- src/components/MovePicker.test.tsx` — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- src/components/MovePicker.test.tsx` — expect PASS (including every pre-existing JQ-324 case).
- [ ] **Step 5:** Commit: `JQ-325: the board takes a target`

---

### Task 5: `Board` wires it together, and the window takes the board back

**Files:**
- Modify: `client/src/App.tsx`
- Test: `client/src/Board.test.tsx`

**Interfaces:**
- Consumes: everything above.

`Board` calls `useAbilityTargeting({ held: heldAbilities(mySeat?.loadout ?? null, state.abilities), marks: { own: myDelays, opponent: oppDelays }, round: match.currentRound, unavailable: firingUnavailable({...}), onFire })`, passes `targeting.targeting` and the three handlers to `MovePicker`, and the whole `AbilityTargeting` to `AbilityRail`.

`demandOwnBoard` is `repicking ? match.currentRound : null`.

`idleCaption` becomes `beforeRoundOne ? "Round 1 hasn't started" : repicking ? 'Something changed — pick again, or keep your move' : undefined`.

- [ ] **Step 1: Write the failing tests** — a duel board still renders no rail and is otherwise unchanged; starting Rust from the rail opens the opponent's board with the instruction; a state where `mayRepick` holds puts the board on Your moves with the new idle caption and `SubPhasePrompt` visible; an unentitled seat mid-`react` gets neither.
- [ ] **Step 2:** `npm test -- src/Board.test.tsx` — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- src/Board.test.tsx` — expect PASS.
- [ ] **Step 5:** Commit: `JQ-325: the window takes the board back`

---

### Task 6: Styles, and the rail heading inside the budget

**Files:**
- Modify: `client/src/styles.css`, `client/src/boardFit.test.ts`
- Test: `client/src/boardFit.test.ts`, `client/src/board.browser.test.tsx`

`.move-board[data-targeting]` gets a distinct treatment from ordinary inspection — a ring on the board and the targeting centre's own panel — so AC #2's "clearly distinguish targeting from ordinary opponent inspection" is visible and not only spoken.

`.ability-rail__owner` is `font: inherit`-scale, one line, and **`sr-only` below 360px** via the existing `@media (max-width: 359px)` idiom, because `boardFit`'s "rail shorter than the board" bound has only 8.1px of headroom at 320×568 against a ~27.6px heading row.

`railHeight()` in `boardFit.test.ts` adds the heading plus one rail gap at viewports ≥ 360 only.

- [ ] **Step 1: Write the failing tests** — `boardFit`: the heading is counted and the rail stays shorter than the board at 390×844, 375×812 and 320×568; the legend is still one line. `board.browser.test.tsx`: at 390×844 with helpers, start a target, the opponent board opens, Cancel returns to Your moves, no horizontal overflow at 360px.
- [ ] **Step 2:** `npm test -- src/boardFit.test.ts` and `npm run test:browser` — expect FAIL.
- [ ] **Step 3:** Implement the CSS and the `railHeight` term.
- [ ] **Step 4:** Re-run both — expect PASS.
- [ ] **Step 5:** Commit: `JQ-325: the targeting board, and a rail that says whose it is`

---

### Task 7: Full verification and the PR

- [ ] **Step 1:** `npm run lint`
- [ ] **Step 2:** `npm test` (whole jsdom suite)
- [ ] **Step 3:** `npm run test:browser`
- [ ] **Step 4:** `npm run build`
- [ ] **Step 5:** Read every failure; fix; re-run until clean.
- [ ] **Step 6:** Push the branch and open the PR against `main`, body listing each acceptance criterion and where it is met, and naming the JQ-221 reversal explicitly so a reviewer sees it rather than finds it.
- [ ] **Step 7:** Attach the PR to JQ-325 in Linear.

---

## Self-review

**Spec coverage.** AC #1 → Global Constraints + Task 1 (`abilities.ts` untouched). AC #2 → Tasks 4, 6. AC #3 → Task 4. AC #4 → Tasks 1, 4. AC #5 → Tasks 3, 4 (derived view). AC #6 → Tasks 1, 2, 4. AC #7 → Tasks 4, 5. AC #8 → Task 1. AC #9 → Tasks 2, 6. AC #10 → Tasks 6, 7 plus the manual pass, which stays manual by design.

**Type consistency.** `Targeting`, `TargetingNote`, `AbilityTargeting` are defined once in Task 1 and referenced by those names in Tasks 2, 4 and 5. `FiringChoice` stays exported from `AbilityRail.tsx`, where it already lives, so Task 1 imports from there and Task 2 does not move it.

**Known risk.** Task 4 is the largest and touches a file that is already 988 lines. If `MovePicker.tsx` passes ~1100 lines, split `TargetingCenter` (and only it) into `client/src/components/TargetingCenter.tsx` — it has no shared state with the picker beyond its props.
