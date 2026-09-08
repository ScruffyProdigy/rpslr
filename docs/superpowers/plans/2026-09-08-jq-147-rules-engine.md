# JQ-147 — Loadout-Parameterised Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Read `2026-09-08-jq-146-helpers-mode.md` first — it holds the epic's Global
> Constraints and the lobby contract this ticket's data feeds.

**Goal:** Make RPSLR's rules a function of a two-helper loadout, so `duel-helpers`
can exist, while `duel` keeps producing byte-identical state through the same code.

**Architecture:** `api/src/game.ts` stays pure and stops owning the constants: it
gains a `PlayerRules` parameter. A new `api/src/helpers/` module owns the 22-card
roster and compiles a `Loadout` into `PlayerRules`. `game.ts` never imports the
roster, so the core cannot grow a dependency on the cards. Per-player replay becomes
match-level replay, because helpers let one player's round touch the other's marks.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest.

## Global Constraints

Inherited from the epic plan — every task's requirements include these:

- `duel` produces **byte-identical** `MatchState` to the current build.
- `api/src/game.ts` stays pure: no I/O, no clock, no import from `helpers/roster.ts`.
- Mark costs: Major 2, Minor 1, Trinket 0, on the helper's bound move.
- A loadout is any **two distinct** helpers. No slot rule.
- Only a Major may carry a charge — enforced at the **type level**, so a Minor with
  a charge fails `tsc`, not a runtime assertion.
- The tier ladder is fitted to a two-helper loadout and `DELAY_ON_CHOICE = 2`.
- All 22 helpers. An ability is not spent once per match: it sits on its own slot on
  the cooldown track with **opening marks** and **recharge marks**, both in the same
  delay marks a move uses. "Once per match" is a recharge of never. Firing costs the
  ability's slot, never the move you played. — Ryan's call, 2026-09-08.

---

## File structure

| File | Responsibility |
| --- | --- |
| `api/src/helpers/roster.ts` | The 22 card definitions + lookup. Pure data. The single source of truth for JQ-148's endpoint too. |
| `api/src/helpers/loadout.ts` | `Loadout` type, `parseLoadout`, opening marks incl. the same-move roll. |
| `api/src/helpers/rules.ts` | `PlayerRules`, `rulesFor(loadout, roll)`, `DUEL_RULES`. Where each card's effect actually lives. |
| `api/src/game.ts` | *Modified.* Takes `PlayerRules`; `computeDelays` → `replayMatch`. |
| `api/src/service.ts` | *Modified.* Three `computeDelays` call sites become one match-level replay. |

`helpers/` is a new directory because these three files change together and are
meaningless apart — the repo already does this for `api/src/replayCard/`.

---

## Task 1.1: The roster, with the charge rule in the type system

**Files:**
- Create: `api/src/helpers/roster.ts`
- Test: `api/src/helpers/roster.test.ts`

**Interfaces:**
- Produces: `HelperId`, `Tier`, `Load`, `HelperDef`, `HELPERS`, `getHelper(id)`,
  `MARK_COST`. JQ-148's roster endpoint and JQ-152's telemetry both read these.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/helpers/roster.test.ts
import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST, getHelper } from './roster.js';

describe('helper roster', () => {
  it('holds all 22 helpers at the design doc tier counts', () => {
    expect(HELPERS).toHaveLength(22);
    const byTier = (t: string) => HELPERS.filter((h) => h.tier === t).length;
    expect(byTier('Major')).toBe(9);
    expect(byTier('Minor')).toBe(8);
    expect(byTier('Trinket')).toBe(5);
  });

  it('prices tiers as the ladder requires', () => {
    expect(MARK_COST).toEqual({ Major: 2, Minor: 1, Trinket: 0 });
  });

  it('binds every Major and Minor to a move, and no Trinket', () => {
    for (const h of HELPERS) {
      if (h.tier === 'Trinket') expect(h.boundMove).toBeNull();
      else expect(h.boundMove).not.toBeNull();
    }
  });

  it('gives only Majors a non-passive load', () => {
    for (const h of HELPERS) {
      if (h.tier !== 'Major') expect(h.load).toBe('passive');
    }
  });

  it('looks a helper up by id', () => {
    expect(getHelper('ferrus')?.name).toBe('Ferrus');
    expect(getHelper('nonesuch')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/helpers/roster.test.ts`
Expected: FAIL — cannot find module `./roster.js`.

- [ ] **Step 3: Write the roster**

The type-level charge rule is the load-bearing part: `load` is narrowed to
`'passive'` for anything that is not a Major, so giving a Minor a charge is a `tsc`
error rather than something a runtime check has to catch.

```ts
// api/src/helpers/roster.ts
import type { Move } from '../game.js';

export type Tier = 'Major' | 'Minor' | 'Trinket';
export type Load = 'passive' | 'charge' | 'per-round';

/** Marks a helper places on its bound move at the start of the match. */
export const MARK_COST: Record<Tier, number> = { Major: 2, Minor: 1, Trinket: 0 };

/**
 * Only a Major may carry a charge, and only a bound tier has a move. Both rules
 * live in the type so a miswritten card fails the build rather than a test.
 */
export interface HelperDef<T extends Tier = Tier> {
  id: string;
  name: string;
  tier: T;
  boundMove: T extends 'Trinket' ? null : Move;
  load: T extends 'Major' ? Load : 'passive';
  /** Player-facing copy; also the `blurb` in the queue-options roster. */
  blurb: string;
}

const MAJORS: HelperDef<'Major'>[] = [
  { id: 'good-old-rock', name: 'Good Old Rock', tier: 'Major', boundMove: 'rock',
    load: 'passive', blurb: 'When you play Rock, a loss becomes a draw.' },
  { id: 'chimera', name: 'Chimera', tier: 'Major', boundMove: 'lizard',
    load: 'passive', blurb: 'Your Lizard also beats Scissors, all match.' },
  { id: 'ferrus', name: 'Ferrus', tier: 'Major', boundMove: 'robot',
    load: 'passive', blurb: 'Your Robot takes 1 mark instead of 2.' },
  { id: 'quarantine', name: 'Quarantine', tier: 'Major', boundMove: 'scissors',
    load: 'per-round', blurb: 'Name a move each round. If they play it, it takes 4 marks.' },
  { id: 'oracle', name: 'Oracle', tier: 'Major', boundMove: 'paper',
    load: 'charge', blurb: 'Once per match, learn one live move they did not play, then re-pick.' },
  // The four below are gated on the epic plan's Task 1.0 resize sign-off.
  { id: 'sacrifice', name: 'Sacrifice', tier: 'Major', boundMove: 'rock',
    load: 'charge', blurb: 'Once per match, declare the round a draw and clear all your marks.' },
  { id: 'rust', name: 'Rust', tier: 'Major', boundMove: 'scissors',
    load: 'charge', blurb: 'Once per match, add 2 marks to a move they have live.' },
  { id: 'thief', name: 'Thief', tier: 'Major', boundMove: 'lizard',
    load: 'charge', blurb: 'Once per match, move one mark from one of your moves onto one of theirs.' },
  { id: 'freeze', name: 'Freeze', tier: 'Major', boundMove: 'robot',
    load: 'charge', blurb: "Once per match, their marks don't decrement this round." },
];

const MINORS: HelperDef<'Minor'>[] = [
  { id: 'second-wind', name: 'Second Wind', tier: 'Minor', boundMove: 'rock',
    load: 'passive', blurb: 'The first round you lose is a draw instead.' },
  { id: 'echo-chamber', name: 'Echo Chamber', tier: 'Minor', boundMove: 'paper',
    load: 'passive', blurb: "On a drawn round, their move takes an extra mark and yours doesn't." },
  { id: 'sharp-practice', name: 'Sharp Practice', tier: 'Minor', boundMove: 'scissors',
    load: 'passive', blurb: 'A Scissors mirror is a win for you, not a draw.' },
  { id: 'grudge', name: 'Grudge', tier: 'Minor', boundMove: 'scissors',
    load: 'passive', blurb: 'The move that beat you last round takes an extra mark for them.' },
  { id: 'tempered', name: 'Tempered', tier: 'Minor', boundMove: 'lizard',
    load: 'passive', blurb: 'Your winning move takes 3 marks; your losing move takes 1.' },
  { id: 'featherweight', name: 'Featherweight', tier: 'Minor', boundMove: 'lizard',
    load: 'passive', blurb: 'Your Lizard takes 1 mark instead of 2.' },
  { id: 'poker-face', name: 'Poker Face', tier: 'Minor', boundMove: 'robot',
    load: 'passive', blurb: 'The opponent is never told you have locked in.' },
  { id: 'blind-spot', name: 'Blind Spot', tier: 'Minor', boundMove: 'robot',
    load: 'passive', blurb: 'One of your moves has its cooldown hidden from them all match.' },
];

const TRINKETS: HelperDef<'Trinket'>[] = [
  { id: 'small-mercy', name: 'Small Mercy', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'The first round you lose, the move that beat you takes an extra mark.' },
  { id: 'copycat', name: 'Copycat', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'On a drawn round, your move takes 1 mark instead of 2.' },
  { id: 'bookend', name: 'Bookend', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'Your first move of the match takes 1 mark instead of 2.' },
  { id: 'old-habits', name: 'Old Habits', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'You are shown which move the opponent has played most this match.' },
  { id: 'watchful', name: 'Watchful', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: "You are shown the opponent's cooldowns as they will stand next round." },
];

export const HELPERS: HelperDef[] = [...MAJORS, ...MINORS, ...TRINKETS];

export type HelperId = string;

export function getHelper(id: HelperId): HelperDef | undefined {
  return HELPERS.find((h) => h.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/helpers/roster.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/helpers/roster.ts api/src/helpers/roster.test.ts
git commit -m "JQ-147: name the twenty-two, and let the compiler hold the charge rule"
```

---

## Task 1.2: Parsing a loadout

**Files:**
- Create: `api/src/helpers/loadout.ts`
- Test: `api/src/helpers/loadout.test.ts`

**Interfaces:**
- Consumes: `HelperId`, `getHelper` from Task 1.1.
- Produces: `Loadout` (a `readonly [HelperId, HelperId]`), and
  `parseLoadout(raw: unknown): Loadout | string`. JQ-148's provision validation
  calls `parseLoadout` and turns a returned string into a `400`.

The `T | string` return is the repo's established parse convention — see
`parseLobbyProvision` in `api/src/provision.ts:44`. Follow it rather than throwing.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/helpers/loadout.test.ts
import { describe, expect, it } from 'vitest';
import { parseLoadout } from './loadout.js';

describe('parseLoadout', () => {
  it('accepts any two distinct helpers, in any tier combination', () => {
    expect(parseLoadout(['ferrus', 'chimera'])).toEqual(['ferrus', 'chimera']);
    expect(parseLoadout(['copycat', 'watchful'])).toEqual(['copycat', 'watchful']);
    expect(parseLoadout(['oracle', 'good-old-rock'])).toEqual(['oracle', 'good-old-rock']);
  });

  it('rejects the same helper twice rather than coercing it', () => {
    expect(parseLoadout(['ferrus', 'ferrus'])).toBe('a loadout needs two different helpers');
  });

  it('rejects the wrong number of helpers', () => {
    expect(parseLoadout(['ferrus'])).toBe('a loadout needs exactly 2 helpers');
    expect(parseLoadout(['ferrus', 'chimera', 'copycat'])).toBe('a loadout needs exactly 2 helpers');
  });

  it('rejects an unknown helper by name', () => {
    expect(parseLoadout(['ferrus', 'nonesuch'])).toBe('unknown helper: nonesuch');
  });

  it('rejects a non-array', () => {
    expect(parseLoadout(undefined)).toBe('a loadout needs exactly 2 helpers');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/helpers/loadout.test.ts`
Expected: FAIL — cannot find module `./loadout.js`.

- [ ] **Step 3: Write the parser**

```ts
// api/src/helpers/loadout.ts
import { getHelper, type HelperId } from './roster.js';

/** Any two distinct helpers. No slot rule — the tier ladder does the balancing. */
export type Loadout = readonly [HelperId, HelperId];

export function parseLoadout(raw: unknown): Loadout | string {
  if (!Array.isArray(raw) || raw.length !== 2) return 'a loadout needs exactly 2 helpers';
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) return 'a loadout needs exactly 2 helpers';
    const id = value.trim();
    if (!getHelper(id)) return `unknown helper: ${id}`;
    ids.push(id);
  }
  if (ids[0] === ids[1]) return 'a loadout needs two different helpers';
  return [ids[0], ids[1]] as const;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/helpers/loadout.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/helpers/loadout.ts api/src/helpers/loadout.test.ts
git commit -m "JQ-147: two helpers, and they have to be two"
```

---

## Task 1.3: Opening marks, and the same-move roll

**Files:**
- Modify: `api/src/helpers/loadout.ts`
- Test: `api/src/helpers/loadout.test.ts`

**Interfaces:**
- Produces: `openingMarks(loadout, pick): { delays: DelayMap; rolledMove: Move | null }`
  where `pick: (candidates: Move[]) => Move` is injected so the roll is testable and
  `game.ts` stays clock-free and RNG-free. `rolledMove` is stored in match state and
  disclosed only at reveal — JQ-149 renders it.

The rule from the design doc: two bound helpers on the same move would stack marks
there and hand over a four-live opening for free, breaking the ramp in the direction
that pays. So **the cheaper helper's marks land on a uniformly random move drawn
from those not already blocked, ties to the second helper picked.** The number of
blocked moves therefore always equals the number of bound helpers.

- [ ] **Step 1: Write the failing test**

```ts
// append to api/src/helpers/loadout.test.ts
import { openingMarks } from './loadout.js';
import type { Move } from '../game.js';

const first = (c: Move[]) => c[0];

describe('openingMarks', () => {
  it('reproduces the duel opening for Ferrus + Featherweight', () => {
    const { delays, rolledMove } = openingMarks(['ferrus', 'featherweight'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 1, robot: 2 });
    expect(rolledMove).toBeNull();
  });

  it('leaves four live for a Major + Trinket', () => {
    const { delays } = openingMarks(['ferrus', 'copycat'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 2 });
  });

  it('leaves all five live for two Trinkets', () => {
    const { delays } = openingMarks(['copycat', 'watchful'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 });
  });

  it('blocks two moves at 2 marks each for two Majors', () => {
    const { delays } = openingMarks(['ferrus', 'chimera'], first);
    expect(delays).toEqual({ rock: 0, paper: 0, scissors: 0, lizard: 2, robot: 2 });
  });

  it('rolls the cheaper helper elsewhere when both bind the same move', () => {
    // good-old-rock (Major, rock, 2) + second-wind (Minor, rock, 1).
    // The Minor is cheaper, so its 1 mark rolls onto a move that is not rock.
    const { delays, rolledMove } = openingMarks(['good-old-rock', 'second-wind'], first);
    expect(delays.rock).toBe(2);
    expect(rolledMove).not.toBeNull();
    expect(rolledMove).not.toBe('rock');
    expect(delays[rolledMove as Move]).toBe(1);
    expect(Object.values(delays).filter((n) => n > 0)).toHaveLength(2);
  });

  it('gives the roll to the second helper picked when the tiers tie', () => {
    // grudge and sharp-practice are both Minors bound to scissors.
    const { delays, rolledMove } = openingMarks(['grudge', 'sharp-practice'], first);
    expect(delays.scissors).toBe(1);
    expect(rolledMove).not.toBe('scissors');
    expect(delays[rolledMove as Move]).toBe(1);
  });

  it('never rolls onto an already-blocked move', () => {
    const candidatesSeen: Move[][] = [];
    openingMarks(['good-old-rock', 'second-wind'], (c) => {
      candidatesSeen.push(c);
      return c[0];
    });
    expect(candidatesSeen[0]).not.toContain('rock');
    expect(candidatesSeen[0]).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/helpers/loadout.test.ts`
Expected: FAIL — `openingMarks` is not exported.

- [ ] **Step 3: Implement `openingMarks`**

```ts
// append to api/src/helpers/loadout.ts
import { MOVES, type DelayMap, type Move } from '../game.js';
import { MARK_COST, getHelper } from './roster.js';

/** Chooses where a displaced mark lands. Injected so this module stays pure. */
export type MovePicker = (candidates: Move[]) => Move;

export interface Opening {
  delays: DelayMap;
  /** Where the cheaper helper's marks were displaced to, or null if no collision. */
  rolledMove: Move | null;
}

const EMPTY: DelayMap = { rock: 0, paper: 0, scissors: 0, lizard: 0, robot: 0 };

export function openingMarks(loadout: Loadout, pick: MovePicker): Opening {
  const delays: DelayMap = { ...EMPTY };
  const defs = loadout.map((id) => getHelper(id)!);
  const bound = defs.filter((d) => d.boundMove !== null);

  const collide =
    bound.length === 2 && bound[0].boundMove === bound[1].boundMove;

  if (!collide) {
    for (const d of bound) delays[d.boundMove as Move] += MARK_COST[d.tier];
    return { delays, rolledMove: null };
  }

  // Cheaper helper is displaced; a tie goes to the second helper picked.
  const [a, b] = bound;
  const stays = MARK_COST[a.tier] > MARK_COST[b.tier] ? a : b === b ? a : a;
  const keeper = MARK_COST[a.tier] >= MARK_COST[b.tier] ? a : b;
  const displaced = keeper === a ? b : a;
  void stays;

  delays[keeper.boundMove as Move] += MARK_COST[keeper.tier];
  const candidates = MOVES.filter((m) => delays[m] === 0);
  const rolledMove = pick(candidates);
  delays[rolledMove] += MARK_COST[displaced.tier];
  return { delays, rolledMove };
}
```

Note on the tie rule: `MARK_COST[a] >= MARK_COST[b]` makes `a` — the **first**
helper — the keeper on a tie, so `b`, the second picked, is the one displaced.
That is the design doc's "ties go to the second helper picked". Delete the `stays`
/`void stays` lines when writing this for real; they are shown only to make the
keeper/displaced distinction explicit while reading.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/helpers/loadout.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/helpers/loadout.ts api/src/helpers/loadout.test.ts
git commit -m "JQ-147: when two helpers want the same move, the cheaper one moves out"
```

---

## Task 1.4: `PlayerRules`, and `duel` as the null loadout

**Files:**
- Create: `api/src/helpers/rules.ts`
- Test: `api/src/helpers/rules.test.ts`

**Interfaces:**
- Consumes: `Loadout`, `openingMarks` (1.3); `Move`, `DelayMap`, `RoundOutcome`,
  `BEATS` (1.5 exports `BEATS`).
- Produces: `PlayerRules`, `rulesFor(loadout | null, roll)`, `DUEL_RULES`. Tasks
  1.5–1.7, JQ-150 and JQ-151 all consume `PlayerRules`.

`DUEL_RULES` is the whole back-compatibility strategy: `duel` is not a special case
in the engine, it is `rulesFor(null, null)`. If `duel` ever diverges from "no
helpers", it will be because someone changed `rulesFor`, and the byte-identical test
in 1.7 will say so.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/helpers/rules.test.ts
import { describe, expect, it } from 'vitest';
import { DUEL_RULES, rulesFor } from './rules.js';
import { INITIAL_DELAYS } from '../game.js';

describe('rulesFor', () => {
  it('reproduces duel exactly for a null loadout', () => {
    expect(DUEL_RULES.initialDelays).toEqual(INITIAL_DELAYS);
    expect(DUEL_RULES.delayOnChoice({ move: 'rock', outcome: 'a', roundIndex: 0 })).toBe(2);
    expect(DUEL_RULES.delayOnChoice({ move: 'robot', outcome: 'b', roundIndex: 4 })).toBe(2);
    expect(DUEL_RULES.beats.lizard).toEqual(['robot', 'paper']);
  });

  it('Ferrus makes Robot cost 1, and touches nothing else', () => {
    const r = rulesFor(['ferrus', 'copycat'], null);
    expect(r.delayOnChoice({ move: 'robot', outcome: 'a', roundIndex: 2 })).toBe(1);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'a', roundIndex: 2 })).toBe(2);
  });

  it('Chimera adds one edge for its owner only', () => {
    const r = rulesFor(['chimera', 'copycat'], null);
    expect(r.beats.lizard).toEqual(['robot', 'paper', 'scissors']);
    expect(DUEL_RULES.beats.lizard).toEqual(['robot', 'paper']);
  });

  it('Tempered charges 3 for a win and 1 for a loss', () => {
    const r = rulesFor(['tempered', 'copycat'], null);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 1 })).toBe(3);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'loss', roundIndex: 1 })).toBe(1);
  });

  it('Copycat makes a drawn round cost 1', () => {
    const r = rulesFor(['copycat', 'watchful'], null);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'draw', roundIndex: 1 })).toBe(1);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 1 })).toBe(2);
  });

  it('Bookend discounts only the first move of the match', () => {
    const r = rulesFor(['bookend', 'watchful'], null);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 0 })).toBe(1);
    expect(r.delayOnChoice({ move: 'rock', outcome: 'win', roundIndex: 1 })).toBe(2);
  });

  it('Good Old Rock turns a Rock loss into a draw, and leaves other losses alone', () => {
    const r = rulesFor(['good-old-rock', 'copycat'], null);
    expect(r.transformOutcome('loss', { own: 'rock', opponent: 'paper', roundIndex: 0, lossesSoFar: 0 })).toBe('draw');
    expect(r.transformOutcome('loss', { own: 'paper', opponent: 'scissors', roundIndex: 0, lossesSoFar: 0 })).toBe('loss');
  });

  it('Sharp Practice wins the Scissors mirror', () => {
    const r = rulesFor(['sharp-practice', 'copycat'], null);
    expect(r.transformOutcome('draw', { own: 'scissors', opponent: 'scissors', roundIndex: 0, lossesSoFar: 0 })).toBe('win');
    expect(r.transformOutcome('draw', { own: 'rock', opponent: 'rock', roundIndex: 0, lossesSoFar: 0 })).toBe('draw');
  });

  it('Second Wind saves only the first loss', () => {
    const r = rulesFor(['second-wind', 'copycat'], null);
    expect(r.transformOutcome('loss', { own: 'paper', opponent: 'scissors', roundIndex: 1, lossesSoFar: 0 })).toBe('draw');
    expect(r.transformOutcome('loss', { own: 'paper', opponent: 'scissors', roundIndex: 3, lossesSoFar: 1 })).toBe('loss');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/helpers/rules.test.ts`
Expected: FAIL — cannot find module `./rules.js`.

- [ ] **Step 3: Write `rules.ts`**

`RoundOutcome` in `game.ts` is seat-relative (`'a' | 'b' | 'draw'`). Rules are
per-player, so they use a player-relative outcome instead — mixing the two is the
likeliest bug in this ticket, so they get different type names.

```ts
// api/src/helpers/rules.ts
import { BEATS, INITIAL_DELAYS, MOVES, type DelayMap, type Move } from '../game.js';
import { openingMarks, type Loadout, type MovePicker } from './loadout.js';

/** Outcome from one player's point of view. Not `RoundOutcome`, which is seat-relative. */
export type PlayerOutcome = 'win' | 'loss' | 'draw';

export interface DelayContext {
  move: Move;
  outcome: PlayerOutcome;
  /** 0-based round index within the match. */
  roundIndex: number;
}

export interface OutcomeContext {
  own: Move;
  opponent: Move;
  roundIndex: number;
  /** Losses this player has already taken, before this round. */
  lossesSoFar: number;
}

/** Extra marks a round applies beyond the chosen-move cost. */
export interface MarkAdjustment {
  own: Partial<Record<Move, number>>;
  opponent: Partial<Record<Move, number>>;
}

export interface PlayerRules {
  initialDelays: DelayMap;
  /** Where a same-move collision displaced the cheaper helper's marks. */
  rolledMove: Move | null;
  beats: Record<Move, Move[]>;
  delayOnChoice(ctx: DelayContext): number;
  transformOutcome(raw: PlayerOutcome, ctx: OutcomeContext): PlayerOutcome;
  adjustAfterRound(ctx: OutcomeContext & { outcome: PlayerOutcome }): MarkAdjustment;
}

const NO_ADJUSTMENT: MarkAdjustment = { own: {}, opponent: {} };

export const DUEL_RULES: PlayerRules = {
  initialDelays: { ...INITIAL_DELAYS },
  rolledMove: null,
  beats: BEATS,
  delayOnChoice: () => 2,
  transformOutcome: (raw) => raw,
  adjustAfterRound: () => NO_ADJUSTMENT,
};

export function rulesFor(loadout: Loadout | null, pick: MovePicker | null): PlayerRules {
  if (!loadout) return DUEL_RULES;
  const has = (id: string) => loadout.includes(id);
  const { delays, rolledMove } = openingMarks(loadout, pick ?? ((c) => c[0]));

  const beats: Record<Move, Move[]> = Object.fromEntries(
    MOVES.map((m) => [m, [...BEATS[m]]]),
  ) as Record<Move, Move[]>;
  if (has('chimera')) beats.lizard = [...beats.lizard, 'scissors'];

  return {
    initialDelays: delays,
    rolledMove,
    beats,

    delayOnChoice({ move, outcome, roundIndex }) {
      if (has('bookend') && roundIndex === 0) return 1;
      if (has('ferrus') && move === 'robot') return 1;
      if (has('featherweight') && move === 'lizard') return 1;
      if (has('copycat') && outcome === 'draw') return 1;
      if (has('tempered') && outcome === 'win') return 3;
      if (has('tempered') && outcome === 'loss') return 1;
      return 2;
    },

    transformOutcome(raw, ctx) {
      if (has('sharp-practice') && raw === 'draw'
        && ctx.own === 'scissors' && ctx.opponent === 'scissors') return 'win';
      if (has('good-old-rock') && raw === 'loss' && ctx.own === 'rock') return 'draw';
      if (has('second-wind') && raw === 'loss' && ctx.lossesSoFar === 0) return 'draw';
      return raw;
    },

    adjustAfterRound(ctx) {
      const adj: MarkAdjustment = { own: {}, opponent: {} };
      if (has('echo-chamber') && ctx.outcome === 'draw') {
        adj.opponent[ctx.opponent] = (adj.opponent[ctx.opponent] ?? 0) + 1;
      }
      if (has('grudge') && ctx.outcome === 'loss') {
        adj.opponent[ctx.opponent] = (adj.opponent[ctx.opponent] ?? 0) + 1;
      }
      if (has('small-mercy') && ctx.outcome === 'loss' && ctx.lossesSoFar === 0) {
        adj.opponent[ctx.opponent] = (adj.opponent[ctx.opponent] ?? 0) + 1;
      }
      return adj;
    },
  };
}
```

Ordering inside `delayOnChoice` matters and is not arbitrary: Bookend is checked
first because "your first move of the match" should win over a per-move discount
rather than stacking with it, and Copycat before Tempered because a drawn round is
neither a win nor a loss. Echo Chamber's "and yours doesn't" is handled by the draw
branch of `delayOnChoice`, not here.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/helpers/rules.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/helpers/rules.ts api/src/helpers/rules.test.ts
git commit -m "JQ-147: a loadout is a set of rules, and no loadout is the rules we have"
```

---

## Task 1.5: `game.ts` takes rules instead of owning constants

**Files:**
- Modify: `api/src/game.ts`
- Modify: `api/src/game.test.ts`

**Interfaces:**
- Produces: `BEATS` (now exported — `rules.ts` and `moveVerbs.ts` need it),
  `decideRound(moveA, moveB, beatsA?)`, and `replayMatch`.

`decideRound` gains an optional per-player `beats` table so Chimera works, defaulting
to the shared one so every existing call site is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// append to api/src/game.test.ts
import { BEATS, decideRound, replayMatch } from './game.js';
import { DUEL_RULES, rulesFor } from './helpers/rules.js';

describe('decideRound with a per-player graph', () => {
  it('is unchanged when no table is passed', () => {
    expect(decideRound('rock', 'scissors')).toBe('a');
    expect(decideRound('scissors', 'rock')).toBe('b');
    expect(decideRound('rock', 'rock')).toBe('draw');
  });

  it("lets A's Chimera Lizard beat Scissors without changing B's graph", () => {
    const chimera = rulesFor(['chimera', 'copycat'], null);
    expect(decideRound('lizard', 'scissors', chimera.beats)).toBe('a');
    expect(decideRound('lizard', 'scissors')).toBe('b');
  });
});

describe('replayMatch', () => {
  it('reproduces the duel cooldown sequence', () => {
    const rounds = [
      { a: 'rock' as const, b: 'paper' as const },
      { a: 'scissors' as const, b: 'lizard' as const },
    ];
    const { a } = replayMatch(rounds, DUEL_RULES, DUEL_RULES);
    // rock played round 1 (2 marks, one decrement), scissors played round 2 (2).
    expect(a).toEqual({ rock: 1, paper: 0, scissors: 2, lizard: 0, robot: 0 });
  });

  it("lets one player's helper touch the other's marks", () => {
    // A holds Grudge: the move that beat A last round takes an extra mark for B.
    const grudge = rulesFor(['grudge', 'copycat'], null);
    const rounds = [{ a: 'paper' as const, b: 'scissors' as const }];
    const { b } = replayMatch(rounds, grudge, DUEL_RULES);
    expect(b.scissors).toBe(3); // 2 for playing it, +1 from Grudge
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run src/game.test.ts`
Expected: FAIL — `BEATS` and `replayMatch` are not exported.

- [ ] **Step 3: Modify `game.ts`**

Export `BEATS`; give `decideRound` an optional table; add `replayMatch` and keep
`computeDelays` as a duel-only wrapper so nothing else breaks in this commit.

```ts
// api/src/game.ts — change the BEATS declaration
export const BEATS: Record<Move, Move[]> = {
  rock: ['scissors', 'lizard'],
  paper: ['rock', 'robot'],
  scissors: ['paper', 'lizard'],
  lizard: ['robot', 'paper'],
  robot: ['scissors', 'rock'],
};

// replace decideRound
export function decideRound(
  moveA: Move,
  moveB: Move,
  beatsA: Record<Move, Move[]> = BEATS,
): RoundOutcome {
  if (moveA === moveB) return 'draw';
  return beatsA[moveA].includes(moveB) ? 'a' : 'b';
}

// add — note the import stays type-only so game.ts keeps no runtime dependency
// on the roster, only on the shape of the rules it is handed.
import type { PlayerOutcome, PlayerRules } from './helpers/rules.js';

export interface PlayedRound {
  a: Move;
  b: Move;
}

function flip(o: PlayerOutcome): PlayerOutcome {
  return o === 'win' ? 'loss' : o === 'loss' ? 'win' : 'draw';
}

/**
 * Replay a whole match to both players' current marks.
 *
 * Per-player replay is no longer possible: Grudge, Echo Chamber, Small Mercy,
 * Quarantine, Rust, Thief and Freeze all let one player's round change the
 * other's marks, so the two sequences are coupled. Still pure — it takes the
 * rules, it does not go looking for them.
 */
export function replayMatch(
  rounds: PlayedRound[],
  rulesA: PlayerRules,
  rulesB: PlayerRules,
): { a: DelayMap; b: DelayMap } {
  const a: DelayMap = { ...rulesA.initialDelays };
  const b: DelayMap = { ...rulesB.initialDelays };
  let lossesA = 0;
  let lossesB = 0;

  rounds.forEach((round, roundIndex) => {
    const seat = decideRound(round.a, round.b, rulesA.beats);
    const seatForB = decideRound(round.b, round.a, rulesB.beats);
    const rawA: PlayerOutcome = seat === 'a' ? 'win' : seat === 'b' ? 'loss' : 'draw';
    const rawB: PlayerOutcome = seatForB === 'a' ? 'win' : seatForB === 'b' ? 'loss' : flip(rawA);

    const ctxA = { own: round.a, opponent: round.b, roundIndex, lossesSoFar: lossesA };
    const ctxB = { own: round.b, opponent: round.a, roundIndex, lossesSoFar: lossesB };
    const outA = rulesA.transformOutcome(rawA, ctxA);
    const outB = rulesB.transformOutcome(rawB, ctxB);

    for (const m of MOVES) {
      a[m] = Math.max(0, a[m] - 1);
      b[m] = Math.max(0, b[m] - 1);
    }
    a[round.a] += rulesA.delayOnChoice({ move: round.a, outcome: outA, roundIndex });
    b[round.b] += rulesB.delayOnChoice({ move: round.b, outcome: outB, roundIndex });

    const adjA = rulesA.adjustAfterRound({ ...ctxA, outcome: outA });
    const adjB = rulesB.adjustAfterRound({ ...ctxB, outcome: outB });
    for (const [m, n] of Object.entries(adjA.own)) a[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjA.opponent)) b[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjB.own)) b[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjB.opponent)) a[m as Move] += n ?? 0;

    if (outA === 'loss') lossesA += 1;
    if (outB === 'loss') lossesB += 1;
  });

  return { a, b };
}
```

**Note on the two `decideRound` calls.** Each player's outcome is read through their
*own* graph, because Chimera means the graph is no longer shared and "A won" is no
longer the negation of "B won" — a Chimera Lizard against Scissors is a win for A
and a loss for B, but a non-Chimera comparison would disagree. `flip` covers only
the mirror case, where both graphs agree by construction.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run src/game.test.ts`
Expected: PASS — the existing `game.test.ts` cases and the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add api/src/game.ts api/src/game.test.ts
git commit -m "JQ-147: the rules arrive as an argument, and a round can reach across the table"
```

---

## Task 1.6: The cooldown abilities and Quarantine

**No longer gated.** The resize this used to wait on is gone; the shape below is
settled even though the per-card numbers are not, and the numbers are only data.

**Files:**
- Modify: `api/src/helpers/roster.ts`, `api/src/helpers/rules.ts`
- Modify: `api/src/game.ts` — `PlayerRules` gains ability state
- Modify: `api/src/service.ts`, and the round-result shape
- Test: `api/src/helpers/rules.test.ts`, `api/src/helpers/abilities.test.ts`

**Interfaces:**
- Consumes: everything in 1.1–1.5.
- Produces: `AbilityState`, `abilityMarks(loadout, firings)`, and a `fired` field on
  the round record. JQ-149's picker and JQ-151's pentagon both read the first.

### What changes, and the one thing that is not free

`Load` stops being a bare string. An ability carries its two numbers, and the
type-level rule — only a Major may have one — survives unchanged:

```ts
export type Load =
  | { kind: 'passive' }
  | { kind: 'per-round' }
  /** `recharge: null` is "once per match"; there is no separate charge kind. */
  | { kind: 'ability'; opening: number; recharge: number | null };
```

The ability's marks decrement once per round with everything else, so they replay
from the round list exactly as a move's do — **except for one thing.** Firing is a
*choice*, not a consequence of the moves played, so it is not derivable and has to be
recorded. `replayMatch` stays pure only if the decision arrives with the round:

```ts
export interface PlayedRound {
  a: Move;
  b: Move;
  /** Ability ids each seat fired this round. Empty for every duel round. */
  firedA?: HelperId[];
  firedB?: HelperId[];
}
```

That is the schema line this task costs, and it belongs in JQ-148's migration
alongside the loadout columns rather than in a migration of its own.

### Order

1. **`Load` gains the two numbers.** Roster only; `rules.ts` untouched. The
   `duel` byte-identity fixture must not move — nothing about a duel reads `Load`.
2. **`abilityMarks`** — pure, in `helpers/`: given a loadout and the firings so far,
   what each ability's marks stand at. Mirrors `computeDelays` and is tested the
   same way, including that an ability with `recharge: null` never returns.
3. **`PlayerRules` gains `abilities`** — available/marks per ability, plus the hook
   each effect needs. `BASE_RULES` gets an empty map, so `duel` is still the
   identity element and the fixture still holds.
4. **The four effects**, one commit each, each a pure state transition tested on its
   own: Rust, Thief, Freeze, Sacrifice.
5. **Quarantine** — per-round, so it takes a named move per round rather than a
   firing. Same `PlayedRound` extension, different field.
6. **Service wiring and the round record.**

Oracle stays out of this task: its mid-round reveal sub-phase is JQ-150. Its marks
(3 opening, 2 recharge) still come from `roster.ts` here, so JQ-150 inherits the
cooldown rather than inventing one.

### What a failure here looks like

The ladder test in 1.7 covers opening marks on *moves*. Abilities need the
equivalent: for all 231 loadouts, every ability is either available on the round its
opening marks say or never, and no sequence of firings drives any mark below zero.

---

## Task 1.7: The 231-loadout shape test, and `duel` byte-identity

**Files:**
- Create: `api/src/helpers/ladder.test.ts`
- Modify: `api/src/service.ts:281,352,511`
- Modify: `api/src/service.test.ts`

**Interfaces:**
- Consumes: everything above.

This is the acceptance criterion that keeps the tier ladder honest. It is also the
one that catches a mispriced card, which the design doc calls the single biggest
risk in free-form drafting.

- [ ] **Step 1: Write the failing shape test**

```ts
// api/src/helpers/ladder.test.ts
import { describe, expect, it } from 'vitest';
import { HELPERS, MARK_COST } from './roster.js';
import { openingMarks } from './loadout.js';
import { availableMoves } from '../game.js';

const PAIRS = HELPERS.flatMap((a, i) => HELPERS.slice(i + 1).map((b) => [a, b] as const));

describe('the tier ladder holds for every legal loadout', () => {
  it('has 231 loadouts', () => {
    expect(PAIRS).toHaveLength(231);
  });

  it('blocks exactly one move per bound helper, whatever they are bound to', () => {
    for (const [a, b] of PAIRS) {
      const boundCount = [a, b].filter((h) => h.boundMove !== null).length;
      const { delays } = openingMarks([a.id, b.id], (c) => c[0]);
      const blocked = Object.values(delays).filter((n) => n > 0).length;
      expect(blocked, `${a.id} + ${b.id}`).toBe(boundCount);
    }
  });

  it('spends exactly the loadout price in marks', () => {
    for (const [a, b] of PAIRS) {
      const price = MARK_COST[a.tier] + MARK_COST[b.tier];
      const { delays } = openingMarks([a.id, b.id], (c) => c[0]);
      const spent = Object.values(delays).reduce((n, m) => n + m, 0);
      expect(spent, `${a.id} + ${b.id}`).toBe(price);
    }
  });

  it('opens with the live-move count the shape table predicts', () => {
    // Design doc, "The tier ladder does the balancing": live moves entering round 1.
    const expected: Record<string, number> = {
      'Major+Major': 3, 'Major+Minor': 3, 'Major+Trinket': 4,
      'Minor+Minor': 3, 'Minor+Trinket': 4, 'Trinket+Trinket': 5,
    };
    for (const [a, b] of PAIRS) {
      const order = ['Major', 'Minor', 'Trinket'];
      const shape = [a.tier, b.tier]
        .sort((x, y) => order.indexOf(x) - order.indexOf(y))
        .join('+');
      const { delays } = openingMarks([a.id, b.id], (c) => c[0]);
      expect(availableMoves(delays).length, `${a.id} + ${b.id} (${shape})`)
        .toBe(expected[shape]);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd api && npx vitest run src/helpers/ladder.test.ts`
Expected: PASS if 1.1–1.3 are right. A failure here names the exact pairing, which
is the point — it is a pricing bug, not a test bug, and it should be taken to Ryan
rather than fixed by loosening the assertion.

- [ ] **Step 3: Point `service.ts` at `replayMatch`**

`service.ts` calls `computeDelays(playerMoveSequence(results, playerId))` per seat at
three places — lines 281, 352 and 511. Each becomes one match-level call:

```ts
// api/src/service.ts — replace each per-seat computeDelays call
const rounds = playedRounds(results, seatA.player?.id, seatB.player?.id);
const { a, b } = replayMatch(rounds, rulesForSeat(seatA), rulesForSeat(seatB));
```

`rulesForSeat` returns `DUEL_RULES` when the seat carries no loadout, which is every
`duel` seat, so `duel` walks the same path with the same numbers.

- [ ] **Step 4: Prove `duel` is byte-identical**

```ts
// api/src/service.test.ts
it('produces byte-identical duel state through the rules engine', async () => {
  const state = await playScriptedDuel();  // existing helper in this file
  expect(JSON.stringify(state)).toBe(JSON.stringify(EXPECTED_DUEL_SNAPSHOT));
});
```

Capture `EXPECTED_DUEL_SNAPSHOT` from `main` **before** starting this ticket —
`git stash` the branch, run the scripted duel, serialise, commit the fixture. A
snapshot generated after the refactor proves nothing.

- [ ] **Step 5: Run the whole suite**

Run: `cd api && npm test`
Expected: PASS, including every pre-existing `duel` test unchanged.

- [ ] **Step 6: Commit**

```bash
git add api/src/helpers/ladder.test.ts api/src/service.ts api/src/service.test.ts
git commit -m "JQ-147: check all 231 loadouts price out, and that duel did not move"
```

---

## Self-review

**Spec coverage against JQ-147's acceptance criteria.** `Loadout` type, any two
distinct → 1.2. `INITIAL_DELAYS` as a function of loadout → 1.3. Trinket costs 0 →
1.3. Same-move legal with a random roll, ties to the second → 1.3. Roll is
server-side and stored → 1.3 returns `rolledMove`; storing it is JQ-148's migration.
`DELAY_ON_CHOICE` per-move → 1.4. `BEATS` per-player → 1.4, 1.5. Per-player draw
handling → 1.4. `computeDelays` takes the loadout and replays purely → 1.5
(`replayMatch`). Charge only on a Major, as a build error → 1.1's type. All 231
loadouts match the shape table → 1.7. Duplicate helper rejected → 1.2 (the `400`
itself is JQ-148). `duel` tests pass unchanged and state is byte-identical → 1.7.
Unit tests per passive helper → 1.4; per cooldown ability → 1.6, now planned.

**Placeholders.** None. 1.6 was the one deferral, on the grounds that its signatures
depended on effects nobody had signed off. The cooldown model settles the shape
without settling the numbers — the numbers are data in `roster.ts`, not signatures —
so 1.6 now carries a real plan and the deferral is closed.

**Type consistency.** `PlayerOutcome` (player-relative) is deliberately distinct
from `game.ts`'s `RoundOutcome` (seat-relative); `replayMatch` converts between them
in one place. `MovePicker`, `Opening`, `MarkAdjustment`, `DelayContext` and
`OutcomeContext` are used with the same shapes in 1.3, 1.4 and 1.5.
