# JQ-215 — Playable-but-marked move selector: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client agree with the server about which moves are playable, and give the move that is marked-but-playable-anyway a visual state of its own.

**Architecture:** The server's `availableMoves` has a floor — when every move carries marks, the least-marked ones stay playable. The client currently reimplements playability as `delays[move] > 0` in eight places and so disagrees with the server on exactly the round the floor exists for. JQ-207 already bundles `api/src/game.ts` into the frontend under the `@game/*` alias, so the fix is two helpers in `client/src/moves.ts` that *call* `availableMoves` rather than mirror it, and eight call sites that ask them.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + @testing-library/react, plain CSS with custom properties.

Spec: `docs/superpowers/specs/2026-09-08-jq-215-playable-but-marked-design.md`
Linear: [JQ-215](https://linear.app/joinquest/issue/JQ-215/move-selector-needs-a-playable-but-marked-state)

## Amendments after execution

The steps below are kept as executed. The final whole-branch review overturned
three of them; the shipped code follows the amendments, not the original text.

1. **`forcedPickCost` was deleted, not shipped** (Task 3, Steps 1/3/4/5).
   `DELAY_ON_CHOICE` is the duel constant, but the forced panel renders only in
   helpers matches, where the cost is `rules.delayOnChoice(...)` — loadout-
   dependent, and for some cards outcome-dependent, so unknowable at pick time.
   The copy is qualitative instead: **"Playing it puts it further down"**, and
   the label fragment is **"marked but playable, costs you more"**.
2. **A ninth site was found and fixed** (not in any task below).
   `opponentCooldownPhrase` in `PickerCenter` renders "Opponent can't play X for
   N turns" — a playability claim, which Task 4's site list wrongly excused as a
   mark count. It takes the same `!isPlayable` gate.
3. **`safeRead` in `commentary.ts` needed a tenth swap.** Task 4 made
   `threatsTo` floor-aware, which left `reachable` (`delaysBefore[move] === 0`)
   contradicting its sibling `punish` one line below. Both now use `isPlayable`.

One error of fact in Task 4's Step 5 rationale: `HowToPlayGraph` is named as a
`threatsTo` consumer. It is not — it imports only `describeBeatsOf`. The real
consumers are `commentary.ts` and `replay.ts`.

Left for a follow-up ticket, pre-existing and not introduced here: `liveMoves`
(`commentary.ts`) hardcodes "exactly three playable moves", and `roundValue`
hard-indexes a 3×3 grid — so a frame leaving either side fully marked throws.

## Global Constraints

- All work happens in the worktree `.claude/worktrees/jq-215-marked-playable` on branch `ryanckohler/jq-215-move-selector-needs-a-playable-but-marked-state`. Never edit the primary clone.
- Run client tests with `npm test --prefix client` (Vitest, single run). A single file: `npm test --prefix client -- src/moves.test.ts`.
- Type-check with `npm run build --prefix client` (`tsc -b && vite build`). `noUnusedLocals` and `noUnusedParameters` are on — an unused import fails the build.
- Lint with `npm run lint --prefix client`.
- **Do not modify anything under `api/src/`.** `availableMoves` is the authority this change defers to; changing it would defeat the purpose.
- `DELAY_ON_CHOICE` is `2`. `MOVES` is `['rock', 'paper', 'scissors', 'lizard', 'robot']`. `DelayMap` is `Record<Move, number>`.
- No new animation or transition — `prefers-reduced-motion` is satisfied by adding only static properties to `.move-btn`.
- Every existing test must keep passing untouched. Several pass partial maps like `{ lizard: 2 }` meaning "everything else is zero"; Task 1's `asDelayMap` is what keeps them green.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `client/src/moves.ts` | Presentation predicates over the rules. Gains `asDelayMap`, `isPlayable`, `isForcedPick`; `threatsTo` and `describeBeatsGraph` start using them. | 1, 4 |
| `client/src/moves.test.ts` | Unit tests for the above. | 1, 4 |
| `client/src/components/MovePicker.tsx` | The board. Four your-side reads and one opponent-side read swap to the helpers; gains the forced paint. | 2, 3, 4 |
| `client/src/components/MovePicker.test.tsx` | Component tests. | 2, 3, 4 |
| `client/src/styles.css` | The `.move-btn--forced` rules. | 3 |
| `client/src/commentary.ts` | Replay prose. One trap-line read swaps. | 5 |
| `client/src/commentary.test.ts` | Commentary tests. | 5 |

---

## Task 1: The shared playability helper

**Files:**
- Modify: `client/src/moves.ts:1` (imports) and end of file
- Test: `client/src/moves.test.ts`

**Interfaces:**
- Consumes: `availableMoves(delays: DelayMap): Move[]` and `MOVES` from `@game/game`.
- Produces:
  - `asDelayMap(delays: Record<string, number>): DelayMap`
  - `isPlayable(move: Move, delays: Record<string, number>): boolean`
  - `isForcedPick(move: Move, delays: Record<string, number>): boolean`

  All three take a loose `Record<string, number>` because that is what `MovePicker` holds: `myDelays` and `oppDelays` arrive off the wire and every existing read of them is written `?? 0`. Tasks 2–5 call these three and nothing else.

**Why `asDelayMap` is load-bearing:** `availableMoves` does `Math.min(...MOVES.map((m) => delays[m]))`. Given a partial map, that is `Math.min(NaN, ...)` → `NaN`, and `delays[m] === NaN` is false for every move, so the floor returns an **empty list** — every move unplayable. That is the exact dead board this ticket exists to remove, reintroduced by the fix. It would also break roughly a dozen existing tests that pass `{}` or `{ rock: 2 }` as shorthand.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/moves.test.ts`:

```ts
describe('isPlayable defers to the server floor (JQ-215)', () => {
  it('is the zero-marked moves when any move is on zero', () => {
    const delays = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toEqual(['rock', 'paper', 'scissors']);
  });

  it('falls back to the least-marked when nothing is on zero', () => {
    // The floor: no move is clear, so the two on 1 mark become playable.
    const delays = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toEqual(['paper', 'lizard']);
  });

  it('never leaves a player with nothing to play', () => {
    const delays = { rock: 3, paper: 3, scissors: 3, lizard: 3, robot: 3 };
    expect(ALL_MOVES.filter((m) => isPlayable(m, delays))).toHaveLength(5);
  });

  it('treats a missing key as zero rather than collapsing to nothing', () => {
    // `Math.min` over a partial map is NaN, and NaN matches no move, so an
    // unguarded call returns the empty list — every move unplayable. The
    // picker holds partial maps, so this case is the common one, not the edge.
    expect(isPlayable('rock', {})).toBe(true);
    expect(ALL_MOVES.filter((m) => isPlayable(m, {}))).toHaveLength(5);
    expect(isPlayable('lizard', { lizard: 2 })).toBe(false);
    expect(isPlayable('rock', { lizard: 2 })).toBe(true);
  });
});

describe('isForcedPick — marked, and playable anyway (JQ-215)', () => {
  it('is empty whenever any move is on zero', () => {
    const delays = { rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 };
    expect(ALL_MOVES.filter((m) => isForcedPick(m, delays))).toEqual([]);
  });

  it('is the least-marked moves when nothing is on zero', () => {
    const delays = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };
    expect(ALL_MOVES.filter((m) => isForcedPick(m, delays))).toEqual(['paper', 'lizard']);
  });

  it('is false for a move that is playable because it is clear', () => {
    expect(isForcedPick('rock', {})).toBe(false);
  });
});
```

Add `isForcedPick` and `isPlayable` to the existing import block at the top of the file (the one that already pulls `threatsTo`, `winsNeeded`, and the rest from `./moves`).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --prefix client -- src/moves.test.ts
```

Expected: FAIL. The import of `isPlayable` / `isForcedPick` does not resolve, so the whole file errors before any assertion runs.

- [ ] **Step 3: Write the implementation**

In `client/src/moves.ts`, change the first import from a type-only import to a value import, since `availableMoves` and `MOVES` are needed at runtime:

```ts
import { MOVES, availableMoves, type DelayMap } from '@game/game';
```

Append to the end of the file:

```ts
/**
 * A total delay map from a partial one.
 *
 * The picker holds `Record<string, number>` — the maps arrive off the wire and
 * every read of them is written `?? 0`. `availableMoves` takes `Math.min` over
 * all five moves, and a missing key makes that `NaN`, which matches no move and
 * silently returns *nothing playable*. That is precisely the dead board this
 * ticket removes, so the defaulting happens once, here, rather than being
 * remembered at each call site.
 */
export function asDelayMap(delays: Record<string, number>): DelayMap {
  return Object.fromEntries(MOVES.map((m) => [m, delays[m] ?? 0])) as DelayMap;
}

/**
 * Playable this round — the server's own rule, not a copy of it.
 *
 * `availableMoves` has a floor: when helpers have driven every move above zero
 * the least-marked ones stay playable, because a player with nothing to play
 * takes an expiry strike for a state they had no way to escape. The client used
 * to decide this for itself and disagreed with the server on exactly that
 * round. Asking the same function is what makes the two agree by construction
 * rather than by care (JQ-215).
 */
export function isPlayable(move: Move, delays: Record<string, number>): boolean {
  return availableMoves(asDelayMap(delays)).includes(move);
}

/**
 * Marked, and playable anyway: the floor is the only reason it is on offer.
 *
 * The state that needs its own paint — neither free like a clear move nor
 * refused like a blocked one. Empty on every round where any move is on zero,
 * which is every duel round and nearly every helpers round.
 */
export function isForcedPick(move: Move, delays: Record<string, number>): boolean {
  return isPlayable(move, delays) && (delays[move] ?? 0) > 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test --prefix client -- src/moves.test.ts
```

Expected: PASS, including every pre-existing test in the file. Pay attention to the `threatsTo` and `describeBeatsGraph` cases — they must still pass unchanged at this point, because Task 1 does not touch them.

- [ ] **Step 5: Run the full client suite**

```bash
npm test --prefix client
```

Expected: PASS. Nothing calls the new helpers yet, so this is a check that the import change from `import type` to a value import did not break the bundle.

- [ ] **Step 6: Commit**

```bash
git add client/src/moves.ts client/src/moves.test.ts
git commit -m "JQ-215: ask the server's availableMoves for playability

The client decided playability itself and so disagreed with the server's
floor on exactly the round the floor exists for. isPlayable calls
availableMoves rather than mirroring it; asDelayMap keeps a partial map
from collapsing that call to NaN and returning nothing playable."
```

---

## Task 2: The tap path and the auto-commit path agree

**Files:**
- Modify: `client/src/components/MovePicker.tsx:170-181` (the `AUTO_COMMIT_AT_S` effect and `handleClick`)
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `isPlayable` from `../moves` (Task 1).
- Produces: no new exports. After this task a marked-but-playable move commits on the second tap and auto-commits at the deadline.

This is acceptance criteria 2 and 6. Both paths currently carry their own copy of `(myDelays[x] ?? 0) > 0`; after this they ask one function, so they cannot drift.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/components/MovePicker.test.tsx`:

```tsx
/**
 * Every move marked, two tied on the fewest. The server's floor makes Paper and
 * Lizard playable; the client used to grey out all five and refuse every tap.
 * Unreachable before JQ-210 gave the abilities something to do.
 */
const ALL_MARKED: Record<string, number> = {
  rock: 2,
  paper: 1,
  scissors: 3,
  lizard: 1,
  robot: 4,
};

describe('<MovePicker> a marked move can still be played (JQ-215)', () => {
  it('commits the least-marked move on the second tap', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker({ myDelays: ALL_MARKED });
    const paper = screen.getByRole('button', { name: /^Paper/ });
    await user.click(paper);
    expect(onPlay).not.toHaveBeenCalled(); // one tap is a preview, as ever
    await user.click(paper);
    expect(onPlay).toHaveBeenCalledWith('paper');
  });

  it('still refuses a move that is not among the least-marked', async () => {
    const user = userEvent.setup();
    const { onPlay } = renderPicker({ myDelays: ALL_MARKED });
    const robot = screen.getByRole('button', { name: /^Robot/ });
    await user.click(robot);
    await user.click(robot);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('auto-commits a forced pick rather than letting it expire into a strike', async () => {
    // The whole point: the player has no clear move, so if the deadline path
    // declines to commit they take an expiry strike, and strikes forfeit.
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10, myDelays: ALL_MARKED });

    await user.click(screen.getByRole('button', { name: /^Lizard/ }));
    tickTo(rerender, 1, { onPlay, myDelays: ALL_MARKED });
    expect(onPlay).toHaveBeenCalledWith('lizard');
  });

  it('does not auto-commit a move the floor did not reach', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const { rerender } = renderPicker({ onPlay, secondsLeft: 10, myDelays: ALL_MARKED });

    await user.click(screen.getByRole('button', { name: /^Scissors/ }));
    tickTo(rerender, 1, { onPlay, myDelays: ALL_MARKED });
    expect(onPlay).not.toHaveBeenCalled();
  });
});
```

`tickTo` is defined inside the existing `describe('<MovePicker> auto-commit at the deadline (JQ-156)')` block. Move it up to module scope (just below `incomingArrows`) so both blocks can use it, leaving its body byte-identical. That is the only edit to existing test code in this task.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --prefix client -- src/components/MovePicker.test.tsx
```

Expected: FAIL on three of the four — "commits the least-marked move on the second tap" (`onPlay` never called), "auto-commits a forced pick" (`onPlay` never called), and nothing else. "still refuses" and "does not auto-commit" pass already, for the wrong reason: today *everything* is refused. Keep them; after the fix they pass for the right reason.

- [ ] **Step 3: Write the implementation**

In `client/src/components/MovePicker.tsx`, add `isPlayable` to the existing `../moves` import block.

Replace the guard inside the `AUTO_COMMIT_AT_S` effect:

```tsx
    // A tapped move on cooldown was a "why can't I play this?", not a choice.
    if ((myDelays[picked] ?? 0) > 0) return;
```

with:

```tsx
    // A tapped move you cannot play was a "why can't I play this?", not a
    // choice. Asked of the same helper the tap path uses, so the two cannot
    // disagree about what is playable — they used to hold separate copies of
    // the test, and the copies were both wrong under the floor (JQ-215).
    if (!isPlayable(picked, myDelays)) return;
```

Replace the guard in `handleClick`:

```tsx
  function handleClick(move: Move) {
    // A move on cooldown can be inspected but never committed: tapping it asks
    // "why can't I play this?", which previously got no answer at all.
    if ((myDelays[move] ?? 0) > 0) {
```

with:

```tsx
  function handleClick(move: Move) {
    // A move you cannot play can be inspected but never committed: tapping it
    // asks "why can't I play this?", which previously got no answer at all.
    // A *marked* move may still be playable — see `isPlayable`.
    if (!isPlayable(move, myDelays)) {
```

Leave the bodies of both branches exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test --prefix client -- src/components/MovePicker.test.tsx
```

Expected: PASS, all four new cases plus every existing one. The existing "never commits a move you cannot play, however many times you tap it" (`myDelays: { lizard: 2 }`) and "does not commit a move you tapped to ask why it is on cooldown" (`myDelays: { rock: 2 }`) must both still pass — those maps have moves on zero, so the floor does not engage and behaviour is unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx
git commit -m "JQ-215: commit a marked-but-playable move from either path

The tap path and the deadline auto-commit each carried their own copy of
the > 0 test, so a move the server would have accepted was refused by
both — and the deadline one turned that refusal into an expiry strike."
```

---

## Task 3: The forced pick reads as its own state

**Files:**
- Modify: `client/src/components/MovePicker.tsx` — the node loop (`CIRCLE_ORDER.map`) and `PickerCenter`
- Modify: `client/src/styles.css` — after the `.move-btn--cooldown .move-btn__emoji` rule
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `isPlayable`, `isForcedPick` from `../moves` (Task 1); `DELAY_ON_CHOICE` from `@game/game`.
- Produces: the CSS class `move-btn--forced`, and `forcedPickCost(move, delays): number` exported from `client/src/moves.ts`.

Acceptance criteria 3, 4 and 5. The node's single `onCooldown` flag splits in two: `blocked` (cannot be played) and `forced` (marked but playable). `blocked || forced` is exactly the old `myDelay > 0`, so the pill and the opponent badge need no change.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('<MovePicker> a marked move can still be played (JQ-215)')` block from Task 2:

```tsx
  it('paints a forced pick as playable, not as blocked', () => {
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    const paper = screen.getByRole('button', { name: /^Paper/ });
    expect(paper).toHaveClass('move-btn--forced');
    expect(paper).not.toHaveClass('move-btn--cooldown');
    expect(paper).not.toHaveAttribute('aria-disabled');
    // Still marked, so it still carries its count — but the pill no longer
    // says "on cooldown" about a move you can play.
    expect(within(paper).getByText('1', { selector: '.cooldown-pill' })).toBeInTheDocument();
    expect(paper.querySelector('.cooldown-pill')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByLabelText('on cooldown, 1 turn')).toBeNull();
    // And the moves the floor did not reach are unchanged.
    const robot = screen.getByRole('button', { name: /^Robot/ });
    expect(robot).toHaveClass('move-btn--cooldown');
    expect(robot).not.toHaveClass('move-btn--forced');
    expect(robot).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelectorAll('.move-btn--forced')).toHaveLength(2);
  });

  it('says in words that it is playable and what it costs', () => {
    renderPicker({ myDelays: ALL_MARKED });
    // Not colour-only: the same sentence the sighted player reads off the pill
    // and the centre has to reach a screen reader too.
    expect(
      screen.getByRole('button', { name: /^Paper, marked but playable, costs 2 turns/ }),
    ).toBeInTheDocument();
  });

  it('offers Lock in and names the cost in the centre', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    await user.click(screen.getByRole('button', { name: /^Paper/ }));
    const centre = container.querySelector('.picker-center') as HTMLElement;
    // 1 mark, minus this round's decrement, plus DELAY_ON_CHOICE = 2.
    expect(centre).toHaveTextContent('Every move is marked — Paper is your cheapest.');
    expect(centre).toHaveTextContent('Playing it puts it down to 2.');
    expect(container.querySelector('.picker-center--why')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lock in Paper/ })).toBeInTheDocument();
  });

  it('still explains a move the floor did not reach', async () => {
    const user = userEvent.setup();
    const { container } = renderPicker({ myDelays: ALL_MARKED });
    await user.click(screen.getByRole('button', { name: /^Robot/ }));
    expect(container.querySelector('.picker-center--why')).toHaveTextContent('back in 4 turns');
    expect(screen.queryByRole('button', { name: /^Lock in/ })).not.toBeInTheDocument();
  });

  it('leaves an ordinary round exactly as it was', () => {
    // Criterion 4. One move on zero is every duel round and nearly every
    // helpers round; the new state must be unreachable there.
    const { container } = renderPicker({ myDelays: { rock: 0, lizard: 1, robot: 2 } });
    expect(container.querySelector('.move-btn--forced')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lizard/ })).toHaveClass('move-btn--cooldown');
    expect(screen.getByRole('button', { name: /^Robot/ })).toHaveClass('move-btn--cooldown');
    expect(container.querySelectorAll('.move-btn--cooldown')).toHaveLength(2);
  });
```

And in `client/src/moves.test.ts`:

```ts
describe('forcedPickCost (JQ-215)', () => {
  it('is what computeDelays will actually do to the move', () => {
    // computeDelays decrements every move by one, then adds DELAY_ON_CHOICE to
    // the one played — so a move on 1 comes back on 2, not on 3.
    expect(forcedPickCost('paper', { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 })).toBe(2);
    expect(forcedPickCost('rock', { rock: 3, paper: 3, scissors: 3, lizard: 3, robot: 3 })).toBe(4);
  });
});
```

Add `forcedPickCost` to that file's import block.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --prefix client -- src/moves.test.ts src/components/MovePicker.test.tsx
```

Expected: FAIL. `moves.test.ts` fails to import `forcedPickCost`; the MovePicker cases fail on the missing `move-btn--forced` class and the missing centre copy. "leaves an ordinary round exactly as it was" and "still explains a move the floor did not reach" should already pass — they are the guard rails, and they must stay green through the whole task.

- [ ] **Step 3: Add `forcedPickCost` to `client/src/moves.ts`**

Extend the `@game/game` import to bring in the constant:

```ts
import { DELAY_ON_CHOICE, MOVES, availableMoves, type DelayMap } from '@game/game';
```

Append to the file:

```ts
/**
 * What a forced pick leaves the move sitting on.
 *
 * `computeDelays` decrements every move by one and *then* adds
 * `DELAY_ON_CHOICE` to the one played, so playing a move that already carries
 * marks digs the hole deeper than playing a clear one — the cost the player
 * should be able to see before committing rather than discover next round.
 */
export function forcedPickCost(move: Move, delays: Record<string, number>): number {
  return Math.max(0, (delays[move] ?? 0) - 1) + DELAY_ON_CHOICE;
}
```

- [ ] **Step 4: Split the node's flag in `MovePicker.tsx`**

Add `isForcedPick` and `forcedPickCost` to the `../moves` import block.

Inside `CIRCLE_ORDER.map`, replace:

```tsx
          const onCooldown = myDelay > 0;
```

with:

```tsx
          // Two flags, not one. `onCooldown` used to mean both "carries marks"
          // and "cannot be played", which is the bug: under the floor a marked
          // move may be the only thing you can play. `blocked || forced` is
          // exactly the old test, so the pill and the opponent badge below are
          // untouched (JQ-215).
          const blocked = !isPlayable(m, myDelays);
          const forced = isForcedPick(m, myDelays);
```

Replace the `label` array with:

```tsx
          const label = [
            MOVE_META[m].label,
            forced ? `marked but playable, costs ${forcedPickCost(m, myDelays)} turns` : '',
            blocked ? cooldownPhrase(myDelay) : '',
            blocked ? cooldownCause(m, myRecentMoves, myOpeningDelays).toLowerCase() : '',
            oppDelay > 0 ? `opponent cooldown, ${oppDelay} turn${oppDelay === 1 ? '' : 's'}` : '',
          ]
            .filter(Boolean)
            .join(', ');
```

In the same node's `className` array, replace `onCooldown ? 'move-btn--cooldown' : ''` with two entries:

```tsx
                blocked ? 'move-btn--cooldown' : '',
                forced ? 'move-btn--forced' : '',
```

Replace `aria-disabled={onCooldown || undefined}` with `aria-disabled={blocked || undefined}`.

Replace the pill block. The count is shown whenever there are marks — blocked or forced, which is what the old flag happened to mean here — but its `aria-label` must not survive into the forced state: `cooldownPhrase` says "on cooldown, 1 turn", which is the opposite of what the button's own label now claims. On a forced pick the button's accessible name already carries the meaning and the cost, so the pill is decorative there.

```tsx
              {myDelay > 0 &&
                (forced ? (
                  // The button's own label says "marked but playable, costs N
                  // turns". A second voice saying "on cooldown" would
                  // contradict it, so here the pill is decoration.
                  <span className="cooldown-pill" aria-hidden="true">
                    <UiIcon name="hourglass" /> {myDelay}
                  </span>
                ) : (
                  <span className="cooldown-pill" role="img" aria-label={cooldownPhrase(myDelay)}>
                    <UiIcon name="hourglass" /> {myDelay}
                  </span>
                ))}
```

Then update the two remaining `onCooldown` readers outside the loop. `myCooldowns` drives the one-time explainer note and should keep meaning "has marks", so change it for clarity only:

```tsx
  const myMarked = CIRCLE_ORDER.filter((m) => (myDelays[m] ?? 0) > 0);
```

and update its two uses (`myCooldowns.length > 0` in `showCooldownNote`) to `myMarked`.

- [ ] **Step 5: Add the third branch to `PickerCenter`**

All three helpers are already imported at module scope — `isPlayable` in Task 2, `isForcedPick` and `forcedPickCost` in Step 4 above — so `PickerCenter`, defined in the same file, sees them without further imports.

Replace:

```tsx
  // An unavailable move explains itself: why it is down, and when it is back.
  const myDelay = myDelays[shown] ?? 0;
  if (myDelay > 0) {
```

with:

```tsx
  const myDelay = myDelays[shown] ?? 0;

  // Marked, and the only thing on offer. It is *not* the blocked panel below:
  // it has to say the move can be played and what playing it costs, and it
  // still offers Lock in. Reachable only when no move is on zero (JQ-215).
  if (isForcedPick(shown, myDelays)) {
    const commitForced = !lockedIn && picked != null && preview === picked ? picked : null;
    return (
      <div className="picker-center picker-center--forced">
        <p className="picker-center__caption">{describeBeatsOf(shown)}</p>
        <p className="picker-center__forced">
          Every move is marked — {MOVE_META[shown].label} is your cheapest. Playing it puts it
          down to {forcedPickCost(shown, myDelays)}.
        </p>
        {commitForced && (
          <button className="picker-center__lock" onClick={() => onCommit(commitForced)}>
            Lock in {MOVE_META[commitForced].label}
          </button>
        )}
      </div>
    );
  }

  // An unavailable move explains itself: why it is down, and when it is back.
  if (!isPlayable(shown, myDelays)) {
```

The old branch's body (the `picker-center--why` div) is unchanged; only its guard moves from `myDelay > 0` to `!isPlayable(...)`. `myDelay` is still read inside it, so leave the `const` where it is.

- [ ] **Step 6: Add the CSS**

In `client/src/styles.css`, immediately after the `.move-btn--cooldown .move-btn__emoji` rule, add:

```css
/* Marked, and playable anyway — the floor is the only reason it is on offer.
   It stays in the *playable* family, because the one thing it must not read as
   is blocked: solid border, full-strength surface, full-colour glyph. What sets
   it apart is the pill it shares with the blocked state, recoloured so the
   count reads as a price rather than a lockout. Against a clear move it differs
   by having a pill at all; against a blocked one, by border style, glyph
   treatment and pill colour — three channels, so none of this rests on colour
   alone. No transition or transform, so `prefers-reduced-motion` needs no new
   rule here (JQ-215). */
.move-btn--forced {
  border-color: color-mix(in srgb, var(--warn) 60%, var(--line-3));
}
.move-btn--forced .cooldown-pill {
  color: var(--surface-0);
  background: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 70%, var(--line-3));
}
/* Inspecting one: the preview ring wins, as it does for every other state. */
.move-btn--forced.move-btn--preview {
  border-color: var(--you);
}
.picker-center__forced {
  margin: 0;
  color: color-mix(in srgb, var(--warn) 74%, var(--text));
  font-size: 0.78rem;
  line-height: 1.35;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test --prefix client -- src/moves.test.ts src/components/MovePicker.test.tsx
```

Expected: PASS, including every pre-existing case. Watch in particular "marks only your own cooldowns unavailable, and shows the numeric pill" and "answers 'why can I not play this?' when you tap it" — both use maps with a move on zero, so they exercise the unchanged path.

- [ ] **Step 8: Run the full suite, the linter and the build**

```bash
npm test --prefix client && npm run lint --prefix client && npm run build --prefix client
```

Expected: all three clean. The build is where an unused `onCooldown` binding left behind in Step 4 would surface, because `noUnusedLocals` is on.

- [ ] **Step 9: Commit**

```bash
git add client/src/moves.ts client/src/moves.test.ts client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx client/src/styles.css
git commit -m "JQ-215: paint the marked-but-playable move as its own state

Solid border and full-colour glyph keep it in the playable family; the
warn-tinted pill and the centre's 'puts it down to N' say what it costs.
The node's single onCooldown flag splits into blocked and forced, whose
union is the old test — so a round with any move on zero is untouched."
```

---

## Task 4: The opponent's board stops claiming they can play nothing

**Files:**
- Modify: `client/src/moves.ts` — `describeBeatsGraph` (~line 90) and `threatsTo` (~line 116)
- Modify: `client/src/components/MovePicker.tsx` — the `oppOff` flag in the arrow loop (~line 284)
- Test: `client/src/moves.test.ts`, `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `isPlayable` from Task 1. No signature changes — `threatsTo` and `describeBeatsGraph` keep their exact parameter lists and return shapes, so `MovePicker`, `HowToPlayGraph` and `commentary.ts` need no adjustment.
- Produces: nothing new.

Same bug, mirrored. Three reads treat `oppDelays[m] > 0` as "they cannot play that", which drives `safe` (the claim that *this move cannot lose*), the screen-reader legend, and the faded threat arrows. Against a fully-marked opponent all three say they can play nothing — a false all-clear, which is worse than the dead board, because a dead board stops you.

- [ ] **Step 1: Write the failing tests**

Append to `client/src/moves.test.ts`:

```ts
describe('the opponent gets the floor too (JQ-215)', () => {
  /** Every move marked; Paper and Lizard tied on the fewest. */
  const THEIRS = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 };

  it('does not call a move safe when the floor leaves a threat live', () => {
    // Paper beats Rock, and the floor makes Paper playable — so Rock is not
    // safe. Reading marks directly would call it safe and get you beaten.
    const t = threatsTo('rock', THEIRS);
    expect(t.live).toEqual(['paper']);
    expect(t.safe).toBe(false);
  });

  it('says the graph is fully live when the floor gives them everything back', () => {
    expect(describeBeatsGraph({ rock: 3, paper: 3, scissors: 3, lizard: 3, robot: 3 }).opponent).toBe(
      'The opponent can play every move this round, so every arrow is live.',
    );
  });

  it('names only the moves the floor did not reach', () => {
    expect(describeBeatsGraph(THEIRS).opponent).toBe(
      "The opponent can't play Rock, Scissors or Robot this round, so those attacks are drawn faded.",
    );
  });
});
```

Append to `client/src/components/MovePicker.test.tsx`:

```tsx
  it('does not fade every arrow when the opponent is fully marked', () => {
    const { container } = renderPicker({ oppDelays: ALL_MARKED });
    // Paper and Lizard are their least-marked, so their attacks are live.
    expect(arrow(container, 'paper', 'rock')).not.toHaveClass('beat-arrow--opp-off');
    expect(arrow(container, 'lizard', 'robot')).not.toHaveClass('beat-arrow--opp-off');
    expect(arrow(container, 'robot', 'rock')).toHaveClass('beat-arrow--opp-off');
  });
```

Place it inside the `describe('<MovePicker> a marked move can still be played (JQ-215)')` block, which already has `ALL_MARKED` in scope.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --prefix client -- src/moves.test.ts src/components/MovePicker.test.tsx
```

Expected: FAIL on all four. `threatsTo` reports `live: []` and `safe: true`; `describeBeatsGraph` names all five moves as unplayable; every arrow carries `beat-arrow--opp-off`.

- [ ] **Step 3: Write the implementation**

In `client/src/moves.ts`, inside `describeBeatsGraph`, replace:

```ts
  const off = ALL_MOVES.filter((m) => (oppDelays[m] ?? 0) > 0).map((m) => MOVE_META[m].label);
```

with:

```ts
  // Not "carries marks" — "cannot be played". The floor means a fully-marked
  // opponent still has their least-marked moves, and saying otherwise hands
  // the player a false all-clear (JQ-215).
  const off = ALL_MOVES.filter((m) => !isPlayable(m, oppDelays)).map((m) => MOVE_META[m].label);
```

Inside `threatsTo`, replace:

```ts
  const live = all.filter((m) => (oppDelays[m] ?? 0) === 0);
```

with:

```ts
  const live = all.filter((m) => isPlayable(m, oppDelays));
```

`isPlayable` is defined lower in the same module; function declarations hoist, so no reordering is needed.

In `client/src/components/MovePicker.tsx`, replace:

```tsx
            const oppOff = !won && (oppDelays[fromMove] ?? 0) > 0;
```

with:

```tsx
            const oppOff = !won && !isPlayable(fromMove, oppDelays);
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test --prefix client -- src/moves.test.ts src/components/MovePicker.test.tsx
```

Expected: PASS. The pre-existing `threatsTo` and `describeBeatsGraph` cases must all still pass — every one of their fixtures has at least one move on zero (`{}`, `{ robot: 2 }`, `{ paper: 1, robot: 2 }`, `{ lizard: 2, robot: 1 }`, `{ rock: 0, lizard: 2 }`), so the floor does not engage and the answers are unchanged.

- [ ] **Step 5: Run the full suite**

```bash
npm test --prefix client
```

Expected: PASS. `threatsTo` is also read by `HowToPlayGraph`, `commentary.ts` and `replay.ts`, so this is the check that the changed semantics did not disturb them.

- [ ] **Step 6: Commit**

```bash
git add client/src/moves.ts client/src/moves.test.ts client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx
git commit -m "JQ-215: the opponent's floor counts too

threatsTo's safe flag, the screen-reader legend and the faded arrows all
read oppDelays > 0 as 'they cannot play that'. Against a fully-marked
opponent that draws every arrow faded and calls every move safe — a false
all-clear, and worse than a dead board, because a dead board stops you."
```

---

## Task 5: The replay stops asserting it in prose

**Files:**
- Modify: `client/src/commentary.ts:349`
- Test: `client/src/commentary.test.ts`

**Interfaces:**
- Consumes: `isPlayable` from Task 1. `commentary.ts` already imports from `./moves`.
- Produces: nothing new.

The trap line says *nothing they could play beat it*. In a greyed button a wrong playability read is a bad affordance; in replay prose it is a false statement of fact about a match that already happened.

- [ ] **Step 1: Read the surrounding code**

```bash
sed -n 320,355p client/src/commentary.ts
```

Note how `oppDelays` is bound in that scope and what `trapText(mover, blocked, side.move)` renders, so the new test can assert against the real string rather than a guess.

- [ ] **Step 2: Write the failing test**

Add to `client/src/commentary.test.ts`, following the file's existing fixture-building convention (build the same shape of input the neighbouring `trap` tests use, with the opponent's delays set to `{ rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 }` and the mover playing a move that Paper or Lizard beats):

```ts
it('withholds the trap line when the floor leaves them an answer (JQ-215)', () => {
  // Every move marked, so Paper and Lizard are playable. Paper beats Rock, so
  // "nothing they could play beat it" is simply untrue of a Rock pick.
  const notes = /* build the round as the neighbouring trap tests do, with
     oppDelays = { rock: 2, paper: 1, scissors: 3, lizard: 1, robot: 4 }
     and the mover playing 'rock' */;
  expect(notes.some((n) => n.kind === 'trap')).toBe(false);
});
```

Replace the comment placeholder with the actual fixture call read in Step 1 — the neighbouring `trap` test in this file shows the exact shape. Do not leave the comment in the committed test.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test --prefix client -- src/commentary.test.ts
```

Expected: FAIL — a trap note is produced, because all five marks are above zero and the current `every` is satisfied.

- [ ] **Step 4: Write the implementation**

Add `isPlayable` to the `./moves` import block in `client/src/commentary.ts`, then replace:

```ts
    if (beatsOf(side.move).every((m) => oppDelays[m] > 0)) {
```

with:

```ts
    // "Nothing they could play beat it" — so it has to be playability, not
    // marks. Under the floor a fully-marked opponent still holds their
    // least-marked moves, and this line would otherwise state as fact
    // something the round disproves (JQ-215).
    if (beatsOf(side.move).every((m) => !isPlayable(m, oppDelays))) {
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test --prefix client -- src/commentary.test.ts
```

Expected: PASS, with every existing commentary case still green.

- [ ] **Step 6: Run everything**

```bash
npm test --prefix client && npm run lint --prefix client && npm run build --prefix client
```

Expected: all clean.

- [ ] **Step 7: Verify the api is untouched**

```bash
git diff --stat origin/main -- api/
```

Expected: empty output. The whole change defers to `availableMoves`; a diff here means something reimplemented it instead.

- [ ] **Step 8: Commit**

```bash
git add client/src/commentary.ts client/src/commentary.test.ts
git commit -m "JQ-215: the trap line asks playability, not marks

'Nothing they could play beat it' is a statement of fact in replay prose.
Read off marks it is false whenever the floor left them a least-marked
answer."
```

---

## Manual verification

After Task 5, confirm the state in a real browser rather than only in jsdom — the CSS is the half the tests cannot see.

- [ ] Run `npm run dev --prefix client` and open two tabs on a helpers match.
- [ ] Reach a round where all five of one side's moves carry marks. Until the ability HUD lands (JQ-221) the quickest route is to set the delay map by hand in React DevTools on the `MovePicker` node.
- [ ] Confirm: the least-marked moves are tappable and commit; the warn-tinted pill is legible against the button; the centre names the cost; the more-marked moves still refuse.
- [ ] Narrow the window to 360px and confirm the pill still clears the move's name (it hangs at `bottom: -10px`, and the name's font bottoms out at 0.66rem).
- [ ] Turn on Reduce Motion at the OS level and confirm nothing about the state animates.
- [ ] Check both the light and dark rendering of `--warn` against the button surface.

---

## Self-review notes

Checked against the spec:

| Spec requirement | Task |
|---|---|
| One shared helper implementing the server's floor | 1 |
| Least-marked move is tappable and commits | 2 |
| Reads as distinct from clear and from blocked | 3 |
| Cooldown affordance unchanged when a move is on zero | 3 (test: "leaves an ordinary round exactly as it was") |
| 360px and `prefers-reduced-motion` | 3 (CSS adds only static properties), manual verification |
| Auto-commit agrees with the tap path | 2 |
| Opponent-side reads: `threatsTo`, `describeBeatsGraph`, `oppOff` | 4 |
| Opponent-side read: commentary trap line | 5 |
| `asDelayMap` guards the `NaN` collapse | 1 |
| Cost copy computed, not hardcoded | 3 (`forcedPickCost`) |
| The pill stops saying "on cooldown" about a playable move | 3 (Step 4's pill block) |

Task 5's Step 2 is the one place a fixture must be read from the existing file rather than reproduced here — `commentary.test.ts`'s builder is long and copying it blind would be more likely to drift than to help. Step 1 exists to make that read explicit rather than leaving it to chance.
