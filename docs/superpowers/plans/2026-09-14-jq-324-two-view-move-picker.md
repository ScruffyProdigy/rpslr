# JQ-324 Two-View Move Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the move picker into two tab-switched views — Your moves and the opponent's — so the pentagon encodes one player at a time.

**Architecture:** `MovePicker` grows a `view: 'mine' | 'theirs'` state and a `role="tablist"` strip above the board. The pentagon renders from a single per-view descriptor (delays, beats graph, name, whether it is interactive) rather than from `my*`/`opp*` props read side by side, so neither view can accidentally draw the other's state. Selection and commit paths stay bound to `view === 'mine'`; the opponent view writes a separate `inspected` state that no commit path reads.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library (jsdom), a second Vitest project for real-browser layout checks (`vitest.browser.config.ts`), plain CSS in `client/src/styles.css`.

Spec: `docs/superpowers/specs/2026-09-14-jq-324-two-view-move-picker-design.md`

## Global Constraints

- Legality comes from `isPlayable` / `isForcedPick` (which call the engine's `availableMoves`), never `marks > 0`. JQ-215.
- The pentagon keeps five fixed positions and fixed board dimensions. `client/src/lib/pentagon.ts` is not modified.
- Phone budget: at 390×844 and 375×812 the page has 0.9px of slack. Any furniture added must be paid for, `--board-furniture` must stay within 2px of what `boardFit.test.ts` recomputes, and the pentagon must stay ≥ 205px so a move button stays ≥ 56px (JQ-108).
- No colour-only state: every view/active/unavailable state also carries text, shape or an icon (JQ-195).
- Reduced motion: any new transition is disabled under `@media (prefers-reduced-motion: reduce)`.
- One live region on the board (`.picker-slot`). Do not add a second `role="status"` inside it. JQ-157.
- Replay keeps play-along behaviour and third-person naming via `Voice`; no protocol, rules, secrecy or timer change.
- Run `npx vitest run` from `client/` after every task; `npx vitest run --config vitest.browser.config.ts` for Task 7.

## File Structure

- `client/src/moves.ts` — add `describeMatchup`, `liveMatchupEdges`. Pure, unit-tested.
- `client/src/components/PickerTabs.tsx` — new. The tablist only: two tabs, avatars, names, `aria-selected`, keyboard handling.
- `client/src/components/MovePicker.tsx` — view state, per-view board descriptor, arrow scoping, node scoping, per-view legend. Gains `OpponentCenter`; keeps `PickerCenter` as-is for your view.
- `client/src/styles.css` — `.picker-tabs*`, per-view arrow/legend rules, the furniture constant.
- `client/src/App.tsx`, `client/src/ReplayPage.tsx` — pass `you`/`opponent` identities; replay defaults its view to the called-for side.
- Tests: `client/src/moves.test.ts`, `client/src/components/PickerTabs.test.tsx` (new), `client/src/components/MovePicker.test.tsx`, `client/src/boardFit.test.ts`, `client/src/board.browser.test.tsx`.

---

### Task 1: Matchup and live-edge helpers

**Files:**
- Modify: `client/src/moves.ts`
- Test: `client/src/moves.test.ts`

**Interfaces:**
- Produces:
  - `describeMatchup(mine: Move, theirs: Move, myBeats?: BeatsMap, oppBeats?: BeatsMap): string`
  - `liveMatchupEdges(mine: Move, oppDelays: Record<string, number>, myBeats?: BeatsMap, oppBeats?: BeatsMap): Array<{ from: Move; to: Move; role: 'you' | 'opp' }>`

- [ ] **Step 1: Write the failing tests**

```ts
describe('describeMatchup (JQ-324)', () => {
  it('reads each side through its own graph', () => {
    expect(describeMatchup('rock', 'scissors')).toBe('Rock crushes Scissors — you win');
    expect(describeMatchup('scissors', 'rock')).toBe('Rock crushes Scissors — they win');
    expect(describeMatchup('rock', 'rock')).toBe('Rock vs Rock — same pick, no winner');
  });

  it('never assumes the two graphs match', () => {
    const chimera = { ...SHARED_BEATS, lizard: ['paper', 'robot', 'scissors'] } as BeatsMap;
    // Their Chimera Lizard takes your Scissors; the shared graph says the reverse.
    expect(describeMatchup('scissors', 'lizard', SHARED_BEATS, chimera)).toBe(
      'Lizard beats Scissors — they win',
    );
    // The same pair, with the edge on your side instead.
    expect(describeMatchup('lizard', 'scissors', chimera, SHARED_BEATS)).toBe(
      'Lizard beats Scissors — you win',
    );
  });
});

describe('liveMatchupEdges (JQ-324)', () => {
  it('connects your pick only to moves they can actually play', () => {
    const delays = { scissors: 2, lizard: 0, paper: 0, rock: 0, robot: 0 };
    const edges = liveMatchupEdges('rock', delays);
    // rock beats scissors & lizard; scissors is down, so only lizard survives.
    expect(edges).toContainEqual({ from: 'rock', to: 'lizard', role: 'you' });
    expect(edges).not.toContainEqual({ from: 'rock', to: 'scissors', role: 'you' });
  });

  it('includes the live attacks that beat your pick', () => {
    const edges = liveMatchupEdges('rock', { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 });
    expect(edges).toContainEqual({ from: 'paper', to: 'rock', role: 'opp' });
    expect(edges).toContainEqual({ from: 'robot', to: 'rock', role: 'opp' });
  });

  it('reads their attacks through their graph', () => {
    const chimera = { ...SHARED_BEATS, lizard: ['paper', 'robot', 'scissors'] } as BeatsMap;
    const edges = liveMatchupEdges('scissors', { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 }, SHARED_BEATS, chimera);
    expect(edges).toContainEqual({ from: 'lizard', to: 'scissors', role: 'opp' });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/moves.test.ts`
Expected: FAIL — `describeMatchup is not a function`.

- [ ] **Step 3: Implement both helpers**

`describeMatchup` decides the winner the way `winningEdgeOf` already does — added edges outrank shared ones, each side read through its own graph — and phrases it with `describeBeat` plus a `— you win` / `— they win` tail. `liveMatchupEdges` is `beatsOf(mine, myBeats)` filtered by `isPlayable(target, oppDelays)` for the `you` role, plus `threatsTo(mine, oppDelays, oppBeats).live` for the `opp` role. Reuse `threatsTo`; do not restate the filter.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd client && npx vitest run src/moves.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/moves.ts client/src/moves.test.ts
git commit -m "JQ-324: matchup and live-edge helpers that read both graphs"
```

---

### Task 2: The tab strip

**Files:**
- Create: `client/src/components/PickerTabs.tsx`
- Create: `client/src/components/PickerTabs.test.tsx`
- Modify: `client/src/styles.css`

**Interfaces:**
- Consumes: `Identity` from `client/src/lib/seatProfile.ts`, `PlayerAvatar`.
- Produces: `export type PickerView = 'mine' | 'theirs'` and
  `<PickerTabs view={PickerView} onView={(v: PickerView) => void} you={Identity} opponent={Identity} voice={Voice} panelId={string} />`

- [ ] **Step 1: Write the failing tests**

```tsx
it('names both sides, with yours first and selected by default', () => {
  render(<PickerTabs view="mine" onView={() => {}} you={YOU} opponent={THEM} voice={PLAYER_VOICE} panelId="board" />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(2);
  expect(tabs[0]).toHaveAccessibleName(/your moves/i);
  expect(tabs[1]).toHaveAccessibleName(/Robin's moves/i);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
});

it('names both players on a replay, where there is no you', () => {
  render(<PickerTabs view="mine" onView={() => {}} you={YOU} opponent={THEM} voice={spectatorVoice('Ada')} panelId="board" />);
  expect(screen.getAllByRole('tab')[0]).toHaveAccessibleName(/Ada's moves/i);
});

it('switches on click', async () => {
  const onView = vi.fn();
  render(<PickerTabs view="mine" onView={onView} you={YOU} opponent={THEM} voice={PLAYER_VOICE} panelId="board" />);
  await userEvent.click(screen.getAllByRole('tab')[1]);
  expect(onView).toHaveBeenCalledWith('theirs');
});

it('moves between tabs with the arrow keys', async () => {
  const onView = vi.fn();
  render(<PickerTabs view="mine" onView={onView} you={YOU} opponent={THEM} voice={PLAYER_VOICE} panelId="board" />);
  screen.getAllByRole('tab')[0].focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(onView).toHaveBeenCalledWith('theirs');
});

it('keeps only the selected tab in the tab order', () => {
  render(<PickerTabs view="mine" onView={() => {}} you={YOU} opponent={THEM} voice={PLAYER_VOICE} panelId="board" />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs[0]).toHaveAttribute('tabindex', '0');
  expect(tabs[1]).toHaveAttribute('tabindex', '-1');
});

it('says which side is active without relying on colour', () => {
  render(<PickerTabs view="theirs" onView={() => {}} you={YOU} opponent={THEM} voice={PLAYER_VOICE} panelId="board" />);
  expect(screen.getAllByRole('tab')[1]).toHaveClass('picker-tab--active');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/components/PickerTabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PickerTabs`**

A `div.picker-tabs[role=tablist]` holding two `button[role=tab]`, each with `aria-selected`, `aria-controls={panelId}`, roving `tabIndex`, a `PlayerAvatar size="xs"` (already `aria-hidden`), and a visible label — `Your moves` when `voice.you === null`, otherwise `${voice.you}'s moves`; the opponent tab is `${opponent.name}'s moves`. Active state: `.picker-tab--active` carrying weight + an underline, with the role colour as an accent only. Arrow keys Left/Right/Home/End call `onView`; Enter/Space are the button default.

- [ ] **Step 4: Run them and watch them pass**

Run: `cd client && npx vitest run src/components/PickerTabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/PickerTabs.tsx client/src/components/PickerTabs.test.tsx client/src/styles.css
git commit -m "JQ-324: the Your moves / their moves tablist"
```

---

### Task 3: Switching semantics in `MovePicker`

**Files:**
- Modify: `client/src/components/MovePicker.tsx`
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `PickerTabs`, `PickerView` (Task 2).
- Produces: `MovePicker` props gain `you?: Identity`, `opponent?: Identity`, `initialView?: PickerView`. The board panel gets `id="move-board-panel"` and `role="tabpanel"`.

Wire the strip in and give it state before changing what the board draws, so the switching rules land with the pentagon still rendering exactly as it does today.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('<MovePicker> switching between the two views (JQ-324)', () => {
  it('opens on your moves', () => {
    renderPicker();
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('cannot commit a move', async () => {
    const onPlay = vi.fn();
    renderPicker({ onPlay });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ })); // first tap
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getAllByRole('tab')[0]);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('keeps a pending choice across a switch', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getAllByRole('tab')[0]);
    expect(screen.getByRole('button', { name: /Lock in Rock/ })).toBeInTheDocument();
  });

  it('resets the second-tap-to-commit sequence across a switch', async () => {
    const onPlay = vi.fn();
    renderPicker({ onPlay });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getAllByRole('tab')[0]);
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ })); // reads as a first tap
    expect(onPlay).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(onPlay).toHaveBeenCalledWith('rock');
  });

  it('returns to your moves on a new round, clearing the inspection', () => {
    const { rerender } = renderPicker({ round: 3 });
    fireEvent.click(screen.getAllByRole('tab')[1]);
    rerender(picker({ round: 4 }));
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves the view alone when state refreshes without a new round', () => {
    const { rerender } = renderPicker({ round: 3, opponentLockedIn: false });
    fireEvent.click(screen.getAllByRole('tab')[1]);
    rerender(picker({ round: 3, opponentLockedIn: true }));
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('never auto-commits an inspection at the deadline', async () => {
    const onPlay = vi.fn();
    renderPicker({ onPlay, secondsLeft: 10 });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ })); // inspecting theirs
    rerenderWith({ secondsLeft: 1 });
    expect(onPlay).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx -t "switching between the two views"`
Expected: FAIL — no tabs in the tree.

- [ ] **Step 3: Implement the state**

Add `const [view, setView] = useState<PickerView>(initialView ?? 'mine')` and `const [inspected, setInspected] = useState<Move | null>(null)`. `switchTo(next)` sets the view, clears `inspected` and clears `hovered`, and — this is the reset the ticket asks for — leaves `picked` alone but sets a `commitArmed` ref to false, which `handleClick` requires before a second tap on the same move can commit. Render `<PickerTabs>` as the first child of `.move-picker` and give the board `role="tabpanel"` with `id="move-board-panel"`. The existing `useEffect` on `[round, disabled]` also resets `view` to `'mine'` and clears `inspected`. Gate the auto-commit effect on `view === 'mine'`.

- [ ] **Step 4: Run the whole file and watch it pass**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx`
Expected: PASS, including the existing blocks.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx
git commit -m "JQ-324: view state and the switching rules"
```

---

### Task 4: Draw the board for the viewed player

**Files:**
- Modify: `client/src/components/MovePicker.tsx`
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Produces: an internal `BoardView = { delays, beats, name, mine: boolean }` built once per render and read by both the arrow loop and the node loop, so the two cannot disagree about whose board is open.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('<MovePicker> each view draws only its own player (JQ-324)', () => {
  it('drops the opponent badge and the opponent fade from your board', () => {
    const { container } = renderPicker({ oppDelays: { scissors: 2 } });
    expect(container.querySelectorAll('.opp-cooldown-mark')).toHaveLength(0);
    expect(container.querySelectorAll('.beat-arrow--off')).toHaveLength(0);
  });

  it('fades the arrows leaving a move you cannot play', () => {
    const { container } = renderPicker({ myDelays: { lizard: 2 } });
    const off = [...container.querySelectorAll('.beat-arrow--off')];
    expect(off).not.toHaveLength(0);
    expect(off.every((a) => a.getAttribute('data-from') === 'lizard')).toBe(true);
  });

  it('shows their cooldowns and their counts on their board', async () => {
    const { container } = renderPicker({ oppDelays: { scissors: 2 }, showOppCooldownCounts: true });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('button', { name: /Scissors.*cooldown, 2 turns/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.cooldown-pill')).not.toHaveLength(0);
  });

  it('offers no commitment on their board', async () => {
    const onPlay = vi.fn();
    renderPicker({ onPlay });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Lock in/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rock/ })).not.toHaveAttribute('aria-pressed', 'true');
  });

  it('draws each owner’s added edge in that owner’s view', async () => {
    const chimera = { ...SHARED_BEATS, lizard: ['paper', 'robot', 'scissors'] } as BeatsMap;
    const { container } = renderPicker({ oppBeats: chimera });
    expect(container.querySelector('[data-added-from="lizard"]')).toBeNull();
    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(container.querySelector('[data-added-from="lizard"]')).not.toBeNull();
  });

  it('keeps the five positions and the button count in both views', async () => {
    const { container } = renderPicker();
    const before = [...container.querySelectorAll('.move-btn')].map((b) => (b as HTMLElement).style.left);
    await userEvent.click(screen.getAllByRole('tab')[1]);
    const after = [...container.querySelectorAll('.move-btn')].map((b) => (b as HTMLElement).style.left);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx -t "each view draws only its own player"`
Expected: FAIL — the opponent badge is still on your board.

- [ ] **Step 3: Implement the per-view board**

Build `const board: BoardView = view === 'mine' ? { delays: myDelays, beats: myBeats, name: youLabel(voice), mine: true } : { delays: oppDelays, beats: oppBeats, name: oppName ?? 'Opponent', mine: false }`. The arrow loop reads `board.delays` for the fade (class renamed `beat-arrow--off`, the old `--opp-off` rule kept as the same paint) and `board.beats` for the added curves — one role's edges at a time, so the `role="you" | "opp"` tagging collapses to "the viewed player's". The node loop reads `board.delays` for the pill and the blocked/forced flags; `aria-pressed`, `aria-label`'s opponent clause, and the opponent badge are all gated on `board.mine`. In their view the label is third person: `${MOVE_META[m].label}, ${name}'s cooldown, N turns`.

- [ ] **Step 4: Run the whole file and watch it pass**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx`
Expected: PASS. The JQ-106 block ("opponent cooldown is drawn on the graph") is rewritten by this task — its assertions move into the opponent view and the ticket reference becomes JQ-324.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx
git commit -m "JQ-324: draw the pentagon for whichever player is in view"
```

---

### Task 5: The opponent centre, and live matchup edges

**Files:**
- Modify: `client/src/components/MovePicker.tsx`
- Test: `client/src/components/MovePicker.test.tsx`

**Interfaces:**
- Consumes: `describeMatchup`, `liveMatchupEdges` (Task 1); `BoardView` (Task 4).

- [ ] **Step 1: Write the failing tests**

```tsx
describe('<MovePicker> inspecting their board (JQ-324)', () => {
  it('explains one of their moves in their terms', async () => {
    renderPicker({ oppDelays: { scissors: 2 } });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Scissors/ }));
    expect(screen.getByText(/Scissors cuts Paper & decapitates Lizard/)).toBeInTheDocument();
    expect(screen.getByText(/back in 2 turns/)).toBeInTheDocument();
  });

  it('reads a tapped move through their graph, not yours', async () => {
    const chimera = { ...SHARED_BEATS, lizard: ['paper', 'robot', 'scissors'] } as BeatsMap;
    renderPicker({ oppBeats: chimera });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Lizard/ }));
    expect(screen.getByText(/Lizard eats Paper, poisons Robot & beats Scissors/)).toBeInTheDocument();
  });

  it('states the matchup both ways once you have a pick', async () => {
    renderPicker();
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /^Paper/ }));
    expect(screen.getByText(/Paper covers Rock — they win/)).toBeInTheDocument();
  });

  it('offers a way back that does not commit', async () => {
    const onPlay = vi.fn();
    renderPicker({ onPlay });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await userEvent.click(screen.getByRole('button', { name: /Back to your moves/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('lights only the edges your pick shares with a move they can play', async () => {
    const { container } = renderPicker({ oppDelays: { scissors: 3 } });
    await userEvent.click(screen.getByRole('button', { name: /^Rock/ }));
    await userEvent.click(screen.getAllByRole('tab')[1]);
    const live = [...container.querySelectorAll('.beat-arrow--matchup')].map((a) => [
      a.getAttribute('data-from'),
      a.getAttribute('data-to'),
    ]);
    expect(live).toContainEqual(['rock', 'lizard']);
    expect(live).not.toContainEqual(['rock', 'scissors']); // they cannot play it
    expect(live).toContainEqual(['paper', 'rock']);
  });

  it('says nothing about their unrevealed pick', async () => {
    renderPicker({ opponentLockedIn: true });
    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.queryByText(/they picked|their move is/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx -t "inspecting their board"`
Expected: FAIL — no opponent centre.

- [ ] **Step 3: Implement `OpponentCenter` and the matchup arrows**

`OpponentCenter` renders into the same `.picker-slot` the existing centre uses — no second live region. Idle it prompts `Tap one of ${name}'s moves`; with an `inspected` move it shows `describeBeatsOf(inspected, board.beats)`, then `cooldownReason(...)` in the third person with `backInPhrase(...)` when the move is down, then `describeMatchup(picked, inspected, myBeats, oppBeats)` when `picked` is set. Below that, a `← Back to your moves` button calling `switchTo('mine')`. Arrows: in the opponent view with `picked` set, `liveMatchupEdges(picked, oppDelays, myBeats, oppBeats)` adds `beat-arrow--matchup` to the matching lines.

- [ ] **Step 4: Run the whole file and watch it pass**

Run: `cd client && npx vitest run src/components/MovePicker.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MovePicker.tsx client/src/components/MovePicker.test.tsx
git commit -m "JQ-324: the opponent centre and live matchup edges"
```

---

### Task 6: Per-view legend, and paying for the strip

**Files:**
- Modify: `client/src/components/MovePicker.tsx`, `client/src/styles.css`
- Test: `client/src/components/MovePicker.test.tsx`, `client/src/boardFit.test.ts`

- [ ] **Step 1: Write the failing tests**

```tsx
it('carries one legend entry per view, plus the extra rule when there is one', async () => {
  renderPicker();
  expect(screen.getByText(/your cooldown/i)).toBeInTheDocument();
  expect(screen.queryByText(/attacks they can.?t make/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('tab')[1]);
  expect(screen.getByText(/Robin's cooldown/i)).toBeInTheDocument();
});
```

```ts
// boardFit.test.ts
it('keeps the legend to one line', () => {
  // The two-line legend is what paid for the tab strip. Pinned here so growing
  // the copy back fails in the budget rather than on a phone.
  expect(TEXT.legend).toBeLessThan(2 * 19.6);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd client && npx vitest run src/boardFit.test.ts src/components/MovePicker.test.tsx`
Expected: FAIL — the furniture constant no longer matches, and the legend still names both sides.

- [ ] **Step 3: Implement**

The legend renders the viewed player's entry only, plus `curved = an extra rule` when the viewed player has an added edge. Add `.picker-tabs` to `pageHeight()` in `boardFit.test.ts` (its height plus its bottom margin), drop `TEXT.legend` to one line (19.6), and re-derive `--board-furniture` until `keeps the declared furniture constant honest` passes. Tune the strip's height down if `leaves the pentagon a usable size on a 375x812 phone` fails — that test is the budget's binding constraint.

- [ ] **Step 4: Run the whole client suite**

Run: `cd client && npx vitest run`
Expected: PASS, 43+ files.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/MovePicker.tsx client/src/styles.css client/src/boardFit.test.ts client/src/components/MovePicker.test.tsx
git commit -m "JQ-324: per-view legend, and the height it pays for the tabs with"
```

---

### Task 7: Wire the two surfaces, and check it in a browser

**Files:**
- Modify: `client/src/App.tsx`, `client/src/ReplayPage.tsx`
- Test: `client/src/board.browser.test.tsx`

- [ ] **Step 1: Write the failing browser test**

```tsx
it('switches views and returns without the page scrolling, at 360px', async () => {
  await mountBoard(360);
  const tabs = document.querySelectorAll('[role="tab"]');
  (tabs[1] as HTMLElement).click();
  await frame();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
  expect(document.body.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
  (tabs[0] as HTMLElement).click();
  await frame();
  expect(document.querySelectorAll('.move-btn')).toHaveLength(5);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd client && npx vitest run --config vitest.browser.config.ts`
Expected: FAIL — no tabs rendered, because neither surface passes identities yet.

- [ ] **Step 3: Wire both call sites**

`App.tsx` passes `you={you}` and `opponent={opponent}` (both already in scope at the `<MovePicker>` call). `ReplayPage.tsx` passes `you={replay.a.identity}` and `opponent={replay.b.identity}`, and `initialView="mine"` — which on a replay is the side being called for, because `frame.a` is already oriented by `playAlong.side`.

- [ ] **Step 4: Run both suites**

Run: `cd client && npx vitest run && npx vitest run --config vitest.browser.config.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/ReplayPage.tsx client/src/board.browser.test.tsx
git commit -m "JQ-324: hand both surfaces their two players"
```

---

### Task 8: Full verification and the PR

- [ ] **Step 1: Typecheck, lint, and both suites**

```bash
cd client && npx tsc -b && npm run lint && npx vitest run && npx vitest run --config vitest.browser.config.ts
```

- [ ] **Step 2: Look at it**

Run the app (`./scripts/dev.sh`), play a round in two tabs, switch views, inspect an opponent cooldown, return, and confirm the pentagon does not move and the page does not scroll at 390×844 and 360px.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin ryanckohler/jq-324-move-picker-separate-your-moves-and-opponents-moves-with-tap
gh pr create --fill
```

- [ ] **Step 4: Attach the PR to JQ-324 and leave it In Progress for review.**
