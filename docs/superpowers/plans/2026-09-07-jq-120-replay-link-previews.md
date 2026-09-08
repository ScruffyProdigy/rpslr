# JQ-120 Replay Link-Preview Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A replay URL pasted into iMessage, Discord, Slack, WhatsApp or X renders a card with both players, their avatars and the final score, instead of a bare grey link.

**Architecture:** The API takes over `GET /replay/:ref` for humans and crawlers alike. It builds a pure `CardModel` from the match state, injects `og:`/`twitter:` meta into the client's own `index.html` (fetched from the client service, ETag-revalidated), and serves a 1200×630 PNG rendered from one SVG template by resvg, cached in process. Nothing about the SPA changes for a human visitor.

**Tech Stack:** Node 20, Express 4, TypeScript (NodeNext ESM — imports carry `.js`), vitest + supertest, `@resvg/resvg-js` 2.6.2.

**Spec:** `docs/superpowers/specs/2026-09-07-jq-120-replay-link-previews-design.md`

## Global Constraints

- Canvas is exactly **1200×630**. All content sits inside the centre **630×630** square: x ∈ [285, 915].
- Rendered PNG must be **≤ 300 KB** (WhatsApp's limit).
- `/replay/:ref` must answer in **under 1 second** and must **never** return an error status. Unknown ref, unfinished match, dead database, unreachable client: all return 200 with the generic card.
- The five moves are `rock, paper, scissors, lizard, robot` — this game replaced Spock. Never write "spock".
- Seat keys are the strings `'1'` and `'2'`. `RoundResult.outcome` is a winning seat key or `'draw'`. `RoundResult.moves` is keyed by **player id**, not seat key.
- Colour tokens, copied from `client/src/styles.css`: `--you` `#6c8cff`, `--opp` `#f5a524`, `--trophy` `#f5c518`, `--text` `#e6e8ee`, `--muted` `#9aa1b1`, `--surface-1` `#0f1117`, `--surface-4` `#1a1d27`, `--line-2` `#333a4c`.
- Every new API module lives in `api/src/replayCard/` and knows nothing about Express.
- All imports use the `.js` extension, matching the rest of `api/src`.
- Run tests from `api/` with `npm test`. Never run the two package test suites concurrently against the same ports.
- Work happens in the worktree `.claude/worktrees/jq-120-link-previews` on branch `ryanckohler/jq-120-link-preview-cards-open-graph-twitter-for-replay-urls`. Never edit the primary clone.

---

### Task 1: The card model

Pure translation of a match into everything the card and the meta tags need to say. No I/O, no SVG, no Express.

**Files:**
- Create: `api/src/replayCard/cardModel.ts`
- Test: `api/src/replayCard/cardModel.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `Seat`, `RoundResult` from `../types.js`; `MOVES`, `type Move` from `../game.js`.
- Produces:

```ts
export type CardKind = 'match' | 'generic';

export interface CardPlayer {
  seatKey: string;
  name: string;
  score: number;
  /** Left seat wears --you, right seat wears --opp, as on the board. */
  role: 'you' | 'opp';
  avatarUrl: string | null;
  /** Filled in later by the avatar fetcher; null until then. */
  avatarDataUri: string | null;
  initial: string;
  winner: boolean;
}

export interface CardModel {
  kind: CardKind;
  ref: string;
  /** Drawn on the image. */
  headline: string;
  /** og:title */
  ogTitle: string;
  /** og:description */
  ogDescription: string;
  /** Empty for kind 'generic'; exactly two entries, winner first, for 'match'. */
  players: CardPlayer[];
  /** false for generic and unfinished — those must not be cached by a platform. */
  cacheable: boolean;
}

export function buildCardModel(
  state: MatchState | null,
  opts: { ref: string; by?: string | null },
): CardModel;

export function genericCardModel(ref: string): CardModel;
```

- [ ] **Step 1: Write the failing tests**

Create `api/src/replayCard/cardModel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCardModel, genericCardModel } from './cardModel.js';
import type { MatchState } from '../types.js';

/** A finished best-of-5: Ana (seat 1) 3, Ben (seat 2) 1, four rounds played. */
function finishedState(overrides: Partial<MatchState['match']> = {}): MatchState {
  return {
    match: {
      id: 'm1',
      code: 'RPS-ABCD',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      lobbyServiceToken: null,
      lobbyPlayerProfiles: {},
      name: 'Duel',
      gameMode: 'duel',
      status: 'finished',
      bestOf: 5,
      currentRound: 5,
      phase: null,
      phaseStartedAt: null,
      phaseDeadline: null,
      endReason: 'played',
      winnerSeatKey: '1',
      createdAt: '2026-09-07T00:00:00.000Z',
      ...overrides,
    },
    seats: [
      {
        id: 's1', matchId: 'm1', seatKey: '1', teamKey: null, role: null, position: 0,
        reservedForLobbyUser: null,
        lobbyProfile: { displayName: 'Ana', avatarUrl: 'https://lobby.test/ana.png' },
        player: { id: 'p1', name: 'Ana', lobbyUserId: 'u1', score: 3, profile: null, expiryStrikes: 0 },
        delays: {},
      },
      {
        id: 's2', matchId: 'm1', seatKey: '2', teamKey: null, role: null, position: 1,
        reservedForLobbyUser: null,
        lobbyProfile: { displayName: 'Ben', avatarUrl: null },
        player: { id: 'p2', name: 'Ben', lobbyUserId: 'u2', score: 1, profile: null, expiryStrikes: 0 },
        delays: {},
      },
    ],
    results: [
      { round: 1, outcome: '1', moves: { p1: 'rock', p2: 'scissors' }, autoPicked: [] },
      { round: 2, outcome: '2', moves: { p1: 'lizard', p2: 'rock' }, autoPicked: [] },
      { round: 3, outcome: 'draw', moves: { p1: 'paper', p2: 'paper' }, autoPicked: [] },
      { round: 4, outcome: '1', moves: { p1: 'robot', p2: 'rock' }, autoPicked: [] },
    ],
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: '1',
    serverNow: '2026-09-07T00:10:00.000Z',
  };
}

describe('buildCardModel', () => {
  it('states the result neutrally when nobody is named', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1' });
    expect(model.kind).toBe('match');
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
    expect(model.headline).toBe('Ana vs Ben · 3–1');
    expect(model.cacheable).toBe(true);
  });

  it('puts the winner first and marks them, whichever seat they took', () => {
    const state = finishedState({ winnerSeatKey: '2' });
    state.matchWinnerSeatKey = '2';
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.players.map((p) => p.name)).toEqual(['Ben', 'Ana']);
    expect(model.players[0].winner).toBe(true);
    expect(model.players[0].role).toBe('you');
    expect(model.players[1].role).toBe('opp');
  });

  it('celebrates when the sharer is the winner', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: '1' });
    expect(model.ogTitle).toBe('Ana wins 3–1!');
    expect(model.headline).toBe('Ana wins 3–1');
  });

  it('stays neutral when the sharer lost — a forwarded loss is not a scoreboard', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: '2' });
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
  });

  it('ignores a ?by= that names no seat in the match', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: 'nonsense' });
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
  });

  it('describes the match round by round, winner move first', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1' });
    expect(model.ogDescription).toBe(
      '1 Rock over Scissors · 2 Rock over Lizard · 3 draw · 4 Robot over Rock',
    );
  });

  it('says a forfeit happened instead of inventing rounds', () => {
    const model = buildCardModel(finishedState({ endReason: 'forfeit-disconnect' }), { ref: 'ext-1' });
    expect(model.ogDescription).toBe('Ana won on forfeit after 4 rounds');
  });

  it('reads a drawn match as a draw', () => {
    const state = finishedState({ winnerSeatKey: null });
    state.matchWinnerSeatKey = 'draw';
    state.seats[0].player!.score = 2;
    state.seats[1].player!.score = 2;
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.ogTitle).toBe('Ana and Ben drew 2–2 in RPSLR');
    expect(model.headline).toBe('Ana vs Ben · 2–2');
    expect(model.players.every((p) => !p.winner)).toBe(true);
  });

  it('falls back to the generic card for an unfinished match', () => {
    const model = buildCardModel(finishedState({ status: 'playing' }), { ref: 'ext-1' });
    expect(model.kind).toBe('generic');
    expect(model.cacheable).toBe(false);
    expect(model.ogTitle).toBe('RPSLR on JoinQuest');
  });

  it('falls back to the generic card when there is no state at all', () => {
    const model = buildCardModel(null, { ref: 'missing' });
    expect(model).toEqual(genericCardModel('missing'));
  });

  it('takes the initial from the display name, and copes with one that has none', () => {
    const state = finishedState();
    state.seats[1].player!.name = '🙂';
    state.seats[1].lobbyProfile = { displayName: '🙂' };
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.players[0].initial).toBe('A');
    expect(model.players[1].initial).toBe('');
  });

  it('truncates a long description on a separator', () => {
    const state = finishedState();
    state.results = Array.from({ length: 40 }, (_, i) => ({
      round: i + 1,
      outcome: '1' as const,
      moves: { p1: 'rock' as const, p2: 'scissors' as const },
      autoPicked: [],
    }));
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.ogDescription.length).toBeLessThanOrEqual(200);
    expect(model.ogDescription.endsWith('…')).toBe(true);
    expect(model.ogDescription).not.toMatch(/ · …$/);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd api && npm test -- cardModel`
Expected: FAIL — `Cannot find module './cardModel.js'`.

- [ ] **Step 3: Implement the model**

Create `api/src/replayCard/cardModel.ts`:

```ts
/**
 * Everything the card says, worked out once from the match and handed to the
 * SVG and the meta tags alike. Pure: no fetching, no rendering, no Express.
 */
import type { Move } from '../game.js';
import type { MatchState, RoundResult, Seat } from '../types.js';

export type CardKind = 'match' | 'generic';

export interface CardPlayer {
  seatKey: string;
  name: string;
  score: number;
  role: 'you' | 'opp';
  avatarUrl: string | null;
  avatarDataUri: string | null;
  initial: string;
  winner: boolean;
}

export interface CardModel {
  kind: CardKind;
  ref: string;
  headline: string;
  ogTitle: string;
  ogDescription: string;
  players: CardPlayer[];
  cacheable: boolean;
}

const MAX_DESCRIPTION = 200;
const SEPARATOR = ' · ';
/** En dash: a score is a range, not a subtraction. */
const DASH = '–';

export function genericCardModel(ref: string): CardModel {
  return {
    kind: 'generic',
    ref,
    headline: 'RPSLR on JoinQuest',
    ogTitle: 'RPSLR on JoinQuest',
    ogDescription: 'Rock, paper, scissors, lizard, robot — every move goes on cooldown after you play it.',
    players: [],
    cacheable: false,
  };
}

export function buildCardModel(
  state: MatchState | null,
  opts: { ref: string; by?: string | null },
): CardModel {
  if (!state || state.match.status !== 'finished') return genericCardModel(opts.ref);

  const seats = [...state.seats].sort((a, b) => a.position - b.position);
  if (seats.length !== 2 || seats.some((s) => !s.player)) return genericCardModel(opts.ref);

  const winnerSeatKey = state.matchWinnerSeatKey ?? state.match.winnerSeatKey;
  const decided = winnerSeatKey !== null && winnerSeatKey !== 'draw';

  // Winner first, so the eye lands on the name the title leads with. A draw
  // keeps seat order, because there is no one to lead with.
  const ordered = decided
    ? [...seats].sort((a, b) => Number(b.seatKey === winnerSeatKey) - Number(a.seatKey === winnerSeatKey))
    : seats;

  const players: CardPlayer[] = ordered.map((seat, index) => ({
    seatKey: seat.seatKey,
    name: displayName(seat),
    score: seat.player?.score ?? 0,
    role: index === 0 ? 'you' : 'opp',
    avatarUrl: seat.lobbyProfile?.avatarUrl?.trim() || seat.player?.profile?.avatarUrl?.trim() || null,
    avatarDataUri: null,
    initial: initialOf(displayName(seat)),
    winner: decided && seat.seatKey === winnerSeatKey,
  }));

  const [first, second] = players;
  const score = `${first.score}${DASH}${second.score}`;
  // ?by= names the sharer, not the winner. A sharer who lost gets the neutral
  // card: a link forwarded after a loss should not announce the loss.
  const celebrate = decided && opts.by != null && opts.by === winnerSeatKey;

  return {
    kind: 'match',
    ref: opts.ref,
    headline: !decided
      ? `${first.name} vs ${second.name} · ${score}`
      : celebrate
        ? `${first.name} wins ${score}`
        : `${first.name} vs ${second.name} · ${score}`,
    ogTitle: !decided
      ? `${first.name} and ${second.name} drew ${score} in RPSLR`
      : celebrate
        ? `${first.name} wins ${score}!`
        : `${first.name} beat ${second.name} ${score} in RPSLR`,
    ogDescription: describeRounds(state, ordered, first.name, decided),
    players,
    cacheable: true,
  };
}

function displayName(seat: Seat): string {
  return (
    seat.lobbyProfile?.displayName?.trim() ||
    seat.player?.profile?.displayName?.trim() ||
    seat.player?.name?.trim() ||
    'Challenger'
  );
}

/** Empty when the name opens with something that has no letter form. */
function initialOf(name: string): string {
  const first = name.trim()[0] ?? '';
  const upper = first.toUpperCase();
  return /\p{Letter}|\p{Number}/u.test(upper) ? upper : '';
}

function describeRounds(
  state: MatchState,
  seats: Seat[],
  winnerName: string,
  decided: boolean,
): string {
  if (state.match.endReason && state.match.endReason !== 'played') {
    const rounds = state.results.length;
    const who = decided ? winnerName : 'Nobody';
    return `${who} won on forfeit after ${rounds} round${rounds === 1 ? '' : 's'}`;
  }

  const parts = state.results.map((result) => describeRound(result, seats));
  return truncate(parts.join(SEPARATOR));
}

function describeRound(result: RoundResult, seats: Seat[]): string {
  if (result.outcome === 'draw') return `${result.round} draw`;
  const winner = seats.find((s) => s.seatKey === result.outcome);
  const loser = seats.find((s) => s.seatKey !== result.outcome);
  const winnerMove = moveOf(result, winner);
  const loserMove = moveOf(result, loser);
  if (!winnerMove || !loserMove) return `${result.round} decided`;
  return `${result.round} ${label(winnerMove)} over ${label(loserMove)}`;
}

function moveOf(result: RoundResult, seat: Seat | undefined): Move | undefined {
  const playerId = seat?.player?.id;
  return playerId ? result.moves[playerId] : undefined;
}

function label(move: Move): string {
  return move[0].toUpperCase() + move.slice(1);
}

/** Cuts on a separator so the line never ends mid-round. */
function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text;
  const room = MAX_DESCRIPTION - 1;
  const cut = text.lastIndexOf(SEPARATOR, room);
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, room).trimEnd();
  return `${head}…`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd api && npm test -- cardModel`
Expected: PASS, 12 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd api && npm run lint
git add api/src/replayCard/cardModel.ts api/src/replayCard/cardModel.test.ts
git commit -m "Work out what a finished match has to say about itself"
```

---

### Task 2: Layout and the safe square

The acceptance criterion "content survives a square crop" becomes a data structure a test can check, rather than something you squint at.

**Files:**
- Create: `api/src/replayCard/cardLayout.ts`
- Test: `api/src/replayCard/cardLayout.test.ts`

**Interfaces:**
- Consumes: `CardModel` from `./cardModel.js`.
- Produces:

```ts
export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const SAFE_X = 285;
export const SAFE_SIZE = 630;

export interface Box { x: number; y: number; width: number; height: number }

export interface CardLayout {
  safe: Box;
  headline: Box;
  score: Box;
  avatars: Box[];
  names: Box[];
  wordmark: Box;
}

export function cardLayout(model: CardModel): CardLayout;
export function contentBoxes(layout: CardLayout): Box[];
export function isInside(outer: Box, inner: Box): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `api/src/replayCard/cardLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCardModel, genericCardModel } from './cardModel.js';
import { CARD_HEIGHT, CARD_WIDTH, SAFE_SIZE, SAFE_X, cardLayout, contentBoxes, isInside } from './cardLayout.js';

const generic = genericCardModel('ref');

describe('cardLayout', () => {
  it('describes the centre square a square crop keeps', () => {
    const { safe } = cardLayout(generic);
    expect(safe).toEqual({ x: SAFE_X, y: 0, width: SAFE_SIZE, height: SAFE_SIZE });
    expect(SAFE_X * 2 + SAFE_SIZE).toBe(CARD_WIDTH);
    expect(SAFE_SIZE).toBe(CARD_HEIGHT);
  });

  it('keeps every piece of content inside the safe square — a match card', () => {
    const model = { ...generic, kind: 'match' as const, players: twoPlayers() };
    const layout = cardLayout(model);
    for (const box of contentBoxes(layout)) {
      expect(isInside(layout.safe, box), JSON.stringify(box)).toBe(true);
    }
  });

  it('keeps every piece of content inside the safe square — the generic card', () => {
    const layout = cardLayout(generic);
    for (const box of contentBoxes(layout)) {
      expect(isInside(layout.safe, box), JSON.stringify(box)).toBe(true);
    }
  });

  it('gives a match card two avatars and two names, and the generic card none', () => {
    expect(cardLayout({ ...generic, kind: 'match', players: twoPlayers() }).avatars).toHaveLength(2);
    expect(cardLayout(generic).avatars).toHaveLength(0);
    expect(cardLayout(generic).names).toHaveLength(0);
  });

  it('spaces the two avatars symmetrically about the centre', () => {
    const layout = cardLayout({ ...generic, kind: 'match', players: twoPlayers() });
    const [left, right] = layout.avatars;
    const centre = CARD_WIDTH / 2;
    expect(centre - (left.x + left.width)).toBe(right.x - centre);
  });
});

function twoPlayers() {
  return [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you' as const, avatarUrl: null, avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp' as const, avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ];
}
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd api && npm test -- cardLayout`
Expected: FAIL — `Cannot find module './cardLayout.js'`.

- [ ] **Step 3: Implement the layout**

Create `api/src/replayCard/cardLayout.ts`:

```ts
/**
 * Where everything sits on the 1200×630 canvas.
 *
 * WhatsApp, LinkedIn and iMessage's compact form crop the card to its centre
 * square, so every piece of content lives inside x ∈ [285, 915] and the wings
 * carry background only. Keeping the geometry here — as boxes, away from the
 * SVG string — is what lets a test assert that rule instead of a human noticing
 * it went wrong on someone's phone.
 */
import type { CardModel } from './cardModel.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const SAFE_SIZE = 630;
export const SAFE_X = (CARD_WIDTH - SAFE_SIZE) / 2;

export interface Box { x: number; y: number; width: number; height: number }

export interface CardLayout {
  safe: Box;
  headline: Box;
  score: Box;
  avatars: Box[];
  names: Box[];
  wordmark: Box;
}

const AVATAR = 160;
const AVATAR_GAP = 96;
const NAME_WIDTH = 220;
const CENTRE = CARD_WIDTH / 2;

export function cardLayout(model: CardModel): CardLayout {
  const safe: Box = { x: SAFE_X, y: 0, width: SAFE_SIZE, height: SAFE_SIZE };
  const hasPlayers = model.kind === 'match' && model.players.length === 2;

  const headline: Box = { x: SAFE_X + 20, y: 84, width: SAFE_SIZE - 40, height: 62 };
  const score: Box = { x: CENTRE - 90, y: 236, width: 180, height: 92 };
  const wordmark: Box = { x: SAFE_X + 20, y: 520, width: SAFE_SIZE - 40, height: 48 };

  if (!hasPlayers) {
    return { safe, headline, score: { ...score, y: 260 }, avatars: [], names: [], wordmark };
  }

  const avatarY = 200;
  const left: Box = { x: CENTRE - AVATAR_GAP / 2 - AVATAR, y: avatarY, width: AVATAR, height: AVATAR };
  const right: Box = { x: CENTRE + AVATAR_GAP / 2, y: avatarY, width: AVATAR, height: AVATAR };
  const nameY = avatarY + AVATAR + 24;

  return {
    safe,
    headline,
    score: { x: CENTRE - AVATAR_GAP / 2, y: avatarY + 46, width: AVATAR_GAP, height: 68 },
    avatars: [left, right],
    names: [
      { x: left.x + left.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 44 },
      { x: right.x + right.width / 2 - NAME_WIDTH / 2, y: nameY, width: NAME_WIDTH, height: 44 },
    ],
    wordmark,
  };
}

export function contentBoxes(layout: CardLayout): Box[] {
  return [layout.headline, layout.score, ...layout.avatars, ...layout.names, layout.wordmark];
}

export function isInside(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd api && npm test -- cardLayout`
Expected: PASS, 5 tests. If a box fails `isInside`, move the box — never widen the safe square.

- [ ] **Step 5: Lint and commit**

```bash
cd api && npm run lint
git add api/src/replayCard/cardLayout.ts api/src/replayCard/cardLayout.test.ts
git commit -m "Put the card's content where a square crop cannot reach it"
```

---

### Task 3: The SVG template

**Files:**
- Create: `api/src/replayCard/tokens.ts`, `api/src/replayCard/cardSvg.ts`
- Test: `api/src/replayCard/cardSvg.test.ts`

**Interfaces:**
- Consumes: `CardModel` from `./cardModel.js`; `cardLayout`, `CARD_WIDTH`, `CARD_HEIGHT` from `./cardLayout.js`.
- Produces:

```ts
// tokens.ts — the game's colours, copied from client/src/styles.css.
export const TOKENS: {
  you: string; opp: string; trophy: string; text: string; muted: string;
  surface1: string; surface4: string; line2: string;
};
export const FONT_DISPLAY = 'Archivo';
export const FONT_BODY = 'Atkinson Hyperlegible';

// cardSvg.ts
export function cardSvg(model: CardModel): string;
export function escapeXml(value: string): string;
```

- [ ] **Step 1: Write the failing tests**

Create `api/src/replayCard/cardSvg.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cardSvg, escapeXml } from './cardSvg.js';
import { genericCardModel, type CardModel } from './cardModel.js';
import { TOKENS } from './tokens.js';

const match: CardModel = {
  kind: 'match',
  ref: 'ext-1',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors',
  cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: 'data:image/png;base64,AAA', initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
};

describe('cardSvg', () => {
  it('declares the exact card size', () => {
    const svg = cardSvg(match);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain('viewBox="0 0 1200 630"');
  });

  it('dresses each seat in the colour it wore on the board', () => {
    const svg = cardSvg(match);
    expect(svg).toContain(TOKENS.you);
    expect(svg).toContain(TOKENS.opp);
  });

  it('rings the winner in gold and leaves the loser unringed', () => {
    expect(cardSvg(match).match(new RegExp(TOKENS.trophy, 'g'))?.length).toBe(1);
  });

  it('embeds an avatar it was given and draws an initial where it was not', () => {
    const svg = cardSvg(match);
    expect(svg).toContain('data:image/png;base64,AAA');
    expect(svg).toContain('>B</text>');
  });

  it('escapes a name that is trying to be markup', () => {
    const hostile = { ...match, headline: '<script>x</script>', players: [{ ...match.players[0], name: 'A&B' }, match.players[1]] };
    const svg = cardSvg(hostile);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('A&amp;B');
  });

  it('renders the generic card without players', () => {
    const svg = cardSvg(genericCardModel('missing'));
    expect(svg).toContain('RPSLR on JoinQuest');
    expect(svg).not.toContain('<image');
  });
});

describe('escapeXml', () => {
  it('escapes the five characters that break XML', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd api && npm test -- cardSvg`
Expected: FAIL — `Cannot find module './cardSvg.js'`.

- [ ] **Step 3: Write the tokens**

Create `api/src/replayCard/tokens.ts`:

```ts
/**
 * The game's colours, copied — deliberately — from client/src/styles.css.
 *
 * The API cannot import across the package boundary, and a card that quietly
 * drifts from the board it depicts is worse than a copy someone has to keep in
 * step. If you change a role colour in the client, change it here too.
 */
export const TOKENS = {
  you: '#6c8cff',
  opp: '#f5a524',
  trophy: '#f5c518',
  text: '#e6e8ee',
  muted: '#9aa1b1',
  surface1: '#0f1117',
  surface4: '#1a1d27',
  line2: '#333a4c',
} as const;

export const FONT_DISPLAY = 'Archivo';
export const FONT_BODY = 'Atkinson Hyperlegible';
```

- [ ] **Step 4: Write the SVG**

Create `api/src/replayCard/cardSvg.ts`:

```ts
/**
 * One template, drawn from the layout boxes. Everything outside the centre
 * square is background: a gradient and a soft glow, both safe to crop away.
 */
import type { CardModel, CardPlayer } from './cardModel.js';
import { CARD_HEIGHT, CARD_WIDTH, cardLayout, type Box, type CardLayout } from './cardLayout.js';
import { FONT_BODY, FONT_DISPLAY, TOKENS } from './tokens.js';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function cardSvg(model: CardModel): string {
  const layout = cardLayout(model);
  const body =
    model.kind === 'match' && model.players.length === 2
      ? matchBody(model, layout)
      : genericBody(model, layout);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${TOKENS.surface4}"/>
      <stop offset="1" stop-color="${TOKENS.surface1}"/>
    </linearGradient>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#ground)"/>
  ${body}
</svg>`;
}

function matchBody(model: CardModel, layout: CardLayout): string {
  const [first, second] = model.players;
  return [
    text(layout.headline, escapeXml(model.headline), { size: 46, weight: 700, font: FONT_DISPLAY, fill: TOKENS.text }),
    avatar(first, layout.avatars[0], 0),
    avatar(second, layout.avatars[1], 1),
    text(layout.score, escapeXml(`${first.score}–${second.score}`), { size: 54, weight: 700, font: FONT_DISPLAY, fill: TOKENS.text }),
    text(layout.names[0], escapeXml(first.name), { size: 30, weight: 700, font: FONT_BODY, fill: colourOf(first) }),
    text(layout.names[1], escapeXml(second.name), { size: 30, weight: 700, font: FONT_BODY, fill: colourOf(second) }),
    text(layout.wordmark, 'RPSLR on JoinQuest', { size: 26, weight: 400, font: FONT_BODY, fill: TOKENS.muted }),
  ].join('\n  ');
}

function genericBody(model: CardModel, layout: CardLayout): string {
  return [
    text(layout.headline, escapeXml(model.headline), { size: 52, weight: 700, font: FONT_DISPLAY, fill: TOKENS.text }),
    text(layout.score, 'RPSLR', { size: 40, weight: 700, font: FONT_DISPLAY, fill: TOKENS.you }),
    text(layout.wordmark, 'joinquest.cc', { size: 26, weight: 400, font: FONT_BODY, fill: TOKENS.muted }),
  ].join('\n  ');
}

function colourOf(player: CardPlayer): string {
  return player.role === 'you' ? TOKENS.you : TOKENS.opp;
}

/** A disc: the avatar if we have one, the initial if we do not, gold ring if they won. */
function avatar(player: CardPlayer, box: Box, index: number): string {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = box.width / 2;
  const ring = player.winner ? TOKENS.trophy : colourOf(player);
  const clipId = `avatar-clip-${index}`;

  const inner = player.avatarDataUri
    ? `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="${r - 6}"/></clipPath>
  <image href="${escapeXml(player.avatarDataUri)}" x="${cx - r + 6}" y="${cy - r + 6}" width="${(r - 6) * 2}" height="${(r - 6) * 2}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${cx}" y="${cy + 22}" text-anchor="middle" font-family="${FONT_DISPLAY}" font-size="64" font-weight="700" fill="${colourOf(player)}">${escapeXml(player.initial)}</text>`;

  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${TOKENS.surface4}" stroke="${ring}" stroke-width="${player.winner ? 8 : 4}"/>
  ${inner}`;
}

function text(
  box: Box,
  content: string,
  opts: { size: number; weight: number; font: string; fill: string },
): string {
  const cx = box.x + box.width / 2;
  const baseline = box.y + box.height * 0.75;
  return `<text x="${cx}" y="${baseline}" text-anchor="middle" font-family="${opts.font}" font-size="${opts.size}" font-weight="${opts.weight}" fill="${opts.fill}">${content}</text>`;
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd api && npm test -- cardSvg`
Expected: PASS, 7 tests.

- [ ] **Step 6: Lint and commit**

```bash
cd api && npm run lint
git add api/src/replayCard/tokens.ts api/src/replayCard/cardSvg.ts api/src/replayCard/cardSvg.test.ts
git commit -m "Draw the card the game would have drawn"
```

---

### Task 4: Fonts and the rasteriser

The one task with a real unknown in it: resvg cannot read the client's `.woff2`, so the same two families have to reach the API as TTF.

**Files:**
- Create: `api/assets/fonts/` (TTFs + `OFL.txt`), `api/src/replayCard/cardImage.ts`, `api/scripts/cardPreview.ts`
- Modify: `api/package.json` (dependency + two scripts), `api/Dockerfile` (copy the assets into the runtime image), `api/.dockerignore` (do not exclude assets)
- Test: `api/src/replayCard/cardImage.test.ts`

**Interfaces:**
- Consumes: `cardSvg` from `./cardSvg.js`.
- Produces:

```ts
export const MAX_CARD_BYTES = 300_000;
export function renderCardPng(svg: string): Buffer;
/** Reads the PNG IHDR chunk. Exported so tests can assert real pixel dimensions. */
export function pngSize(png: Buffer): { width: number; height: number };
```

- [ ] **Step 1: Add the dependency**

```bash
cd api && npm install @resvg/resvg-js@2.6.2
```

Verify the prebuilt binary for this machine installed rather than a compile: `ls node_modules/@resvg | grep resvg-js-` should list a platform package (`resvg-js-darwin-arm64` on the Mac, `resvg-js-linux-x64-musl` in the alpine image).

- [ ] **Step 2: Get the fonts, in this order — stop at the first that works**

1. Decompress the fonts the client already ships, which keeps one source of truth:

```bash
cd api && mkdir -p assets/fonts && npx --yes wawoff2 decompress \
  ../client/public/fonts/atkinson-400-latin.woff2 assets/fonts/Atkinson-Regular.ttf
```

Repeat for `atkinson-700-latin.woff2` → `Atkinson-Bold.ttf` and `archivo-var-latin.woff2` → `Archivo-Variable.ttf`.

2. If `wawoff2` is unavailable, or if Step 5's weight assertion fails because resvg ignores the variable axis, fetch static instances instead:

```bash
cd api/assets/fonts && curl -fLO https://raw.githubusercontent.com/googlefonts/archivo/main/fonts/ttf/Archivo-Bold.ttf
curl -fLO https://raw.githubusercontent.com/googlefonts/archivo/main/fonts/ttf/Archivo-Regular.ttf
```

Either way, copy the upstream `OFL.txt` beside them — both families are OFL and the licence travels with the files.

- [ ] **Step 3: Write the failing tests**

Create `api/src/replayCard/cardImage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_CARD_BYTES, pngSize, renderCardPng } from './cardImage.js';
import { cardSvg } from './cardSvg.js';
import { genericCardModel, type CardModel } from './cardModel.js';

/** A 1×1 red PNG, standing in for a Lobby avatar. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const match: CardModel = {
  kind: 'match',
  ref: 'ext-1',
  headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR',
  ogDescription: '1 Rock over Scissors',
  cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: null, avatarDataUri: PIXEL, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: PIXEL, initial: 'B', winner: false },
  ],
};

describe('renderCardPng', () => {
  it('renders exactly 1200×630', () => {
    expect(pngSize(renderCardPng(cardSvg(match)))).toEqual({ width: 1200, height: 630 });
  });

  it('stays under WhatsApp\'s 300 KB limit with two avatars embedded', () => {
    expect(renderCardPng(cardSvg(match)).byteLength).toBeLessThanOrEqual(MAX_CARD_BYTES);
  });

  it('renders the generic card too', () => {
    expect(pngSize(renderCardPng(cardSvg(genericCardModel('missing'))))).toEqual({ width: 1200, height: 630 });
  });

  it('actually draws the text — a bold headline differs from a light one', () => {
    const bold = renderCardPng(cardSvg(match));
    const light = renderCardPng(cardSvg(match).replace(/font-weight="700"/g, 'font-weight="400"'));
    expect(bold.equals(light)).toBe(false);
  });
});
```

- [ ] **Step 4: Implement the rasteriser**

Create `api/src/replayCard/cardImage.ts`:

```ts
/**
 * SVG in, PNG out. Fonts are loaded once at module init: resvg cannot read the
 * .woff2 files the client ships, so the same two families live here as TTF.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { CARD_WIDTH } from './cardLayout.js';

export const MAX_CARD_BYTES = 300_000;

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');

const fontBuffers: Buffer[] = readdirSync(FONT_DIR)
  .filter((name) => name.endsWith('.ttf'))
  .map((name) => readFileSync(join(FONT_DIR, name)));

if (fontBuffers.length === 0) {
  // Failing here beats shipping a card silently set in whatever the renderer
  // falls back to.
  throw new Error(`no TTF fonts found in ${FONT_DIR}`);
}

export function renderCardPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: CARD_WIDTH },
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Atkinson Hyperlegible' },
  });
  return resvg.render().asPng();
}

/** PNG's IHDR: 8-byte signature, 4-byte length, 4-byte type, then w and h. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd api && npm test -- cardImage`
Expected: PASS, 4 tests. If the weight test fails, the variable TTF is being flattened — go back to Step 2 option 2 and use static instances.

- [ ] **Step 6: Add the preview script**

Create `api/scripts/cardPreview.ts`:

```ts
/**
 * Writes a card to disk so a human can look at it. A card that passes every
 * assertion can still look wrong.
 */
import { writeFileSync } from 'node:fs';
import { genericCardModel } from '../src/replayCard/cardModel.js';
import { cardSvg } from '../src/replayCard/cardSvg.js';
import { renderCardPng } from '../src/replayCard/cardImage.js';

const out = process.argv[2] ?? 'card-preview.png';
writeFileSync(out, renderCardPng(cardSvg(genericCardModel('preview'))));
console.log(`wrote ${out}`);
```

Add to `api/package.json` scripts:

```json
"card:preview": "tsx scripts/cardPreview.ts"
```

- [ ] **Step 7: Make the fonts reach the runtime image**

In `api/Dockerfile`, after the `COPY migrations ./migrations` line:

```dockerfile
# Card fonts — resvg loads these at startup; without them /replay has no type.
COPY assets ./assets
```

Check `api/.dockerignore` does not exclude `assets`.

- [ ] **Step 8: Run the whole suite, then commit**

```bash
cd api && npm test && npm run lint
git add api/package.json api/package-lock.json api/assets api/scripts api/Dockerfile api/.dockerignore api/src/replayCard/cardImage.ts api/src/replayCard/cardImage.test.ts
git commit -m "Turn the card into pixels a chat app will accept"
```

---

### Task 5: Avatars, fetched without letting them stall the card

**Files:**
- Create: `api/src/replayCard/avatars.ts`
- Test: `api/src/replayCard/avatars.test.ts`

**Interfaces:**
- Consumes: `CardModel` from `./cardModel.js`.
- Produces:

```ts
export const AVATAR_TIMEOUT_MS = 400;
export const AVATAR_MAX_BYTES = 200_000;

export interface AvatarOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAvatarDataUri(url: string | null, opts?: AvatarOptions): Promise<string | null>;
/** Returns a new model with avatarDataUri filled in where a fetch succeeded. */
export async function withAvatars(model: CardModel, opts?: AvatarOptions): Promise<CardModel>;
```

- [ ] **Step 1: Write the failing tests**

Create `api/src/replayCard/avatars.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchAvatarDataUri, withAvatars } from './avatars.js';
import type { CardModel } from './cardModel.js';

function pngResponse(bytes = 32, type = 'image/png') {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });
}

const model: CardModel = {
  kind: 'match', ref: 'r', headline: 'h', ogTitle: 't', ogDescription: 'd', cacheable: true,
  players: [
    { seatKey: '1', name: 'Ana', score: 3, role: 'you', avatarUrl: 'https://lobby.test/ana.png', avatarDataUri: null, initial: 'A', winner: true },
    { seatKey: '2', name: 'Ben', score: 1, role: 'opp', avatarUrl: null, avatarDataUri: null, initial: 'B', winner: false },
  ],
};

describe('fetchAvatarDataUri', () => {
  it('returns a data URI carrying the served content type', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse(3, 'image/jpeg'));
    const uri = await fetchAvatarDataUri('https://lobby.test/a.jpg', { fetchImpl: fetchImpl as never });
    expect(uri?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('returns null for no URL at all', async () => {
    expect(await fetchAvatarDataUri(null)).toBeNull();
  });

  it('refuses a response that is not an image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await fetchAvatarDataUri('https://lobby.test/a', { fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('refuses a file over the byte cap', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse(1024));
    expect(await fetchAvatarDataUri('https://lobby.test/a.png', { maxBytes: 512, fetchImpl: fetchImpl as never })).toBeNull();
  });

  it('gives up on a slow host rather than holding the card', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    const started = Date.now();
    expect(await fetchAvatarDataUri('https://slow.test/a.png', { timeoutMs: 30, fetchImpl: fetchImpl as never })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('returns null rather than throwing when the host is dead', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    expect(await fetchAvatarDataUri('https://dead.test/a.png', { fetchImpl: fetchImpl as never })).toBeNull();
  });
});

describe('withAvatars', () => {
  it('fills in the players that have a URL and leaves the rest alone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse());
    const filled = await withAvatars(model, { fetchImpl: fetchImpl as never });
    expect(filled.players[0].avatarDataUri).toContain('base64,');
    expect(filled.players[1].avatarDataUri).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the model it was given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(pngResponse());
    await withAvatars(model, { fetchImpl: fetchImpl as never });
    expect(model.players[0].avatarDataUri).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd api && npm test -- avatars`
Expected: FAIL — `Cannot find module './avatars.js'`.

- [ ] **Step 3: Implement the fetcher**

Create `api/src/replayCard/avatars.ts`:

```ts
/**
 * Lobby avatars, inlined into the card.
 *
 * Every failure here is ordinary — a starter icon that never resolved, a slow
 * host, a link that rotted — and none of them may cost us the card. The disc
 * falls back to the player's initial, exactly as PlayerAvatar does on the board.
 */
import type { CardModel } from './cardModel.js';

export const AVATAR_TIMEOUT_MS = 400;
export const AVATAR_MAX_BYTES = 200_000;

export interface AvatarOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchAvatarDataUri(
  url: string | null,
  opts: AvatarOptions = {},
): Promise<string | null> {
  if (!url) return null;
  const {
    timeoutMs = AVATAR_TIMEOUT_MS,
    maxBytes = AVATAR_MAX_BYTES,
    fetchImpl = fetch,
  } = opts;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) return null;
    return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function withAvatars(model: CardModel, opts: AvatarOptions = {}): Promise<CardModel> {
  const players = await Promise.all(
    model.players.map(async (player) => ({
      ...player,
      avatarDataUri: await fetchAvatarDataUri(player.avatarUrl, opts),
    })),
  );
  return { ...model, players };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd api && npm test -- avatars`
Expected: PASS, 8 tests.

- [ ] **Step 5: Lint and commit**

```bash
cd api && npm run lint
git add api/src/replayCard/avatars.ts api/src/replayCard/avatars.test.ts
git commit -m "Borrow the players' faces, but never wait long for them"
```

---

### Task 6: The meta tags and the client's own shell

**Files:**
- Create: `api/src/replayCard/cache.ts`, `api/src/replayCard/clientTemplate.ts`, `api/src/replayCard/metaHtml.ts`
- Test: `api/src/replayCard/clientTemplate.test.ts`, `api/src/replayCard/metaHtml.test.ts`

**Interfaces:**
- Consumes: `CardModel` from `./cardModel.js`.
- Produces:

```ts
// cache.ts
export class TtlCache<T> {
  constructor(ttlMs: number, max?: number);
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  clear(): void;
}

// clientTemplate.ts
export const FALLBACK_SHELL: string;
export interface ShellOptions { fetchImpl?: typeof fetch; ttlMs?: number; timeoutMs?: number }
export async function getClientShell(origin: string, opts?: ShellOptions): Promise<string>;
export function resetShellCache(): void;

// metaHtml.ts
export interface MetaContext { model: CardModel; pageUrl: string; imageUrl: string }
export function renderMetaTags(ctx: MetaContext): string;
export function injectMeta(shell: string, ctx: MetaContext): string;
```

- [ ] **Step 1: Write the failing tests for the shell**

Create `api/src/replayCard/clientTemplate.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_SHELL, getClientShell, resetShellCache } from './clientTemplate.js';

const HTML = '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

function htmlResponse(body = HTML, etag = 'W/"abc"') {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html', etag } });
}

describe('getClientShell', () => {
  beforeEach(() => resetShellCache());

  it('fetches index.html from the client origin', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never })).toBe(HTML);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://client/index.html');
  });

  it('serves the cached copy inside the TTL without asking again', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(htmlResponse());
    await getClientShell('http://client', { fetchImpl: fetchImpl as never });
    await getClientShell('http://client', { fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('revalidates with If-None-Match once the TTL lapses, and keeps the body on 304', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 });
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 })).toBe(HTML);
    expect((fetchImpl.mock.calls[1][1] as RequestInit).headers).toMatchObject({ 'if-none-match': 'W/"abc"' });
  });

  it('picks up a redeployed bundle rather than holding the old one', async () => {
    const next = HTML.replace('/assets/x.js', '/assets/y.js');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse(next, 'W/"def"'));
    await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 });
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never, ttlMs: 0 })).toContain('/assets/y.js');
  });

  it('falls back to a built-in shell when the client cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await getClientShell('http://client', { fetchImpl: fetchImpl as never })).toBe(FALLBACK_SHELL);
  });
});
```

- [ ] **Step 2: Write the failing tests for the meta tags**

Create `api/src/replayCard/metaHtml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { injectMeta, renderMetaTags } from './metaHtml.js';
import { genericCardModel, type CardModel } from './cardModel.js';

const model: CardModel = {
  kind: 'match', ref: 'ext-1', headline: 'Ana vs Ben · 3–1',
  ogTitle: 'Ana beat Ben 3–1 in RPSLR', ogDescription: '1 Rock over Scissors', cacheable: true,
  players: [],
};

const ctx = {
  model,
  pageUrl: 'https://rpsls-duel.win/replay/ext-1',
  imageUrl: 'https://rpsls-duel.win/api/v1/replay/ext-1/card.png',
};

describe('renderMetaTags', () => {
  it('carries every tag a crawler reads', () => {
    const tags = renderMetaTags(ctx);
    expect(tags).toContain('<meta property="og:title" content="Ana beat Ben 3–1 in RPSLR">');
    expect(tags).toContain('<meta property="og:description" content="1 Rock over Scissors">');
    expect(tags).toContain(`<meta property="og:image" content="${ctx.imageUrl}">`);
    expect(tags).toContain('<meta property="og:image:width" content="1200">');
    expect(tags).toContain('<meta property="og:image:height" content="630">');
    expect(tags).toContain(`<meta property="og:url" content="${ctx.pageUrl}">`);
    expect(tags).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(tags).toContain(`<meta name="twitter:image" content="${ctx.imageUrl}">`);
  });

  it('escapes a title trying to close the attribute', () => {
    const hostile = { ...ctx, model: { ...model, ogTitle: '"><script>alert(1)</script>' } };
    const tags = renderMetaTags(hostile);
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('injectMeta', () => {
  const shell = '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

  it('keeps the SPA the client shipped', () => {
    const html = injectMeta(shell, ctx);
    expect(html).toContain('<script src="/assets/x.js"></script>');
    expect(html).toContain('og:title');
    expect(html.indexOf('og:title')).toBeLessThan(html.indexOf('</head>'));
  });

  it('replaces meta the shell already had rather than doubling it', () => {
    const withOld = shell.replace('</head>', '<meta property="og:title" content="old"></head>');
    const html = injectMeta(withOld, ctx);
    expect(html.match(/og:title/g)).toHaveLength(1);
    expect(html).not.toContain('content="old"');
  });

  it('still produces a document when the shell has no head to inject into', () => {
    const html = injectMeta('<html><body>hi</body></html>', ctx);
    expect(html).toContain('og:title');
  });

  it('works for the generic card', () => {
    expect(injectMeta(shell, { ...ctx, model: genericCardModel('missing') })).toContain('RPSLR on JoinQuest');
  });
});
```

- [ ] **Step 3: Run both test files and watch them fail**

Run: `cd api && npm test -- clientTemplate metaHtml`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the cache**

Create `api/src/replayCard/cache.ts`:

```ts
/** A map that forgets. Small enough that a dependency would cost more than it saves. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 200,
  ) {}

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.max) {
      // Oldest insertion first — Map preserves insertion order.
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 5: Implement the shell fetcher**

Create `api/src/replayCard/clientTemplate.ts`:

```ts
/**
 * The client's own index.html, so a replay link opens the real SPA rather than
 * a shell that only crawlers were meant to see.
 *
 * It is cached, but never blindly: index.html is the only file that names which
 * hashed bundle to load, and those are immutable for a year. Holding a stale
 * copy is how a deploy becomes invisible to the browsers it was for, so the
 * cached copy is revalidated with If-None-Match rather than simply reused.
 */
const SHELL_TTL_MS = 60_000;
const SHELL_TIMEOUT_MS = 500;

export const FALLBACK_SHELL = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RPSLR on JoinQuest</title></head>
  <body><p>Loading the replay…</p><script>location.reload()</script></body>
</html>`;

export interface ShellOptions {
  fetchImpl?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
}

let cached: { html: string; etag: string | null; fetchedAt: number } | null = null;

export function resetShellCache(): void {
  cached = null;
}

export async function getClientShell(origin: string, opts: ShellOptions = {}): Promise<string> {
  const { fetchImpl = fetch, ttlMs = SHELL_TTL_MS, timeoutMs = SHELL_TIMEOUT_MS } = opts;
  if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.html;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    const res = await fetchImpl(`${origin.replace(/\/$/, '')}/index.html`, {
      signal: controller.signal,
      headers,
    });

    if (res.status === 304 && cached) {
      cached = { ...cached, fetchedAt: Date.now() };
      return cached.html;
    }
    if (!res.ok) return cached?.html ?? FALLBACK_SHELL;

    const html = await res.text();
    cached = { html, etag: res.headers.get('etag'), fetchedAt: Date.now() };
    return html;
  } catch {
    return cached?.html ?? FALLBACK_SHELL;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 6: Implement the meta injection**

Create `api/src/replayCard/metaHtml.ts`:

```ts
/** The tags a crawler reads, put where it will look for them. */
import { CARD_HEIGHT, CARD_WIDTH } from './cardLayout.js';
import type { CardModel } from './cardModel.js';

export interface MetaContext {
  model: CardModel;
  pageUrl: string;
  imageUrl: string;
}

const OG_PATTERN = /\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>/gi;

export function renderMetaTags(ctx: MetaContext): string {
  const { model, pageUrl, imageUrl } = ctx;
  return [
    tag('property', 'og:type', 'website'),
    tag('property', 'og:site_name', 'JoinQuest'),
    tag('property', 'og:title', model.ogTitle),
    tag('property', 'og:description', model.ogDescription),
    tag('property', 'og:image', imageUrl),
    tag('property', 'og:image:width', String(CARD_WIDTH)),
    tag('property', 'og:image:height', String(CARD_HEIGHT)),
    tag('property', 'og:image:alt', model.headline),
    tag('property', 'og:url', pageUrl),
    tag('name', 'twitter:card', 'summary_large_image'),
    tag('name', 'twitter:title', model.ogTitle),
    tag('name', 'twitter:description', model.ogDescription),
    tag('name', 'twitter:image', imageUrl),
  ].join('\n    ');
}

export function injectMeta(shell: string, ctx: MetaContext): string {
  const tags = renderMetaTags(ctx);
  const stripped = shell.replace(OG_PATTERN, '');
  if (stripped.includes('</head>')) {
    return stripped.replace('</head>', `    ${tags}\n  </head>`);
  }
  // A shell with no head is not one we wrote, but it still has to work.
  return `${tags}\n${stripped}`;
}

function tag(kind: 'property' | 'name', key: string, value: string): string {
  return `<meta ${kind}="${key}" content="${escapeAttribute(value)}">`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `cd api && npm test -- clientTemplate metaHtml`
Expected: PASS, 10 tests.

- [ ] **Step 8: Lint and commit**

```bash
cd api && npm run lint
git add api/src/replayCard/cache.ts api/src/replayCard/clientTemplate.ts api/src/replayCard/metaHtml.ts api/src/replayCard/clientTemplate.test.ts api/src/replayCard/metaHtml.test.ts
git commit -m "Say in the head what the page has always said in the body"
```

---

### Task 7: The two routes

**Files:**
- Create: `api/src/replayCard/routes.ts`
- Modify: `api/src/config.ts` (add `clientOrigin`), `api/src/app.ts` (mount the routes)
- Test: `api/src/replayCard/routes.test.ts`, `api/src/config.test.ts` (one added case)

**Interfaces:**
- Consumes: everything from Tasks 1–6; `GameService` from `../service.js`; `AppConfig` from `../config.js`.
- Produces:

```ts
export interface ReplayCardDeps {
  service: Pick<GameService, 'getState'>;
  config: Pick<AppConfig, 'playUrl' | 'clientOrigin'>;
  fetchImpl?: typeof fetch;
}
export function registerReplayCardRoutes(app: Express, deps: ReplayCardDeps): void;
```

`AppConfig` gains `clientOrigin: string`, read from `GAME_CLIENT_ORIGIN` and defaulting to `playUrl`.

- [ ] **Step 1: Write the failing route tests**

Create `api/src/replayCard/routes.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryGameRepository } from '../memoryRepository.js';
import { GameService } from '../service.js';
import { resetShellCache } from './clientTemplate.js';

const SHELL = '<!doctype html><html><head><title>RPSLR</title></head><body><script src="/assets/x.js"></script></body></html>';

function buildApp(fetchImpl?: typeof fetch) {
  resetShellCache();
  const config = loadConfig({
    GAME_APP_ENV: 'local',
    REQUIRE_LOBBY_AUTH: 'false',
    GAME_PLAY_URL: 'https://rpsls-duel.win',
  } as NodeJS.ProcessEnv);
  const service = new GameService(new MemoryGameRepository());
  const app = createApp(service, config, undefined, { fetchImpl });
  return { app, service };
}

const shellFetch = vi.fn(async () =>
  new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;

/** Plays a standalone best-of-3 to a finish and returns its room code. */
async function finishedMatch(service: GameService): Promise<string> {
  const created = await service.createStandaloneMatch({ hostName: 'Ana', bestOf: 3 });
  const code = created.state.match.code;
  const joined = await service.claimSeat(code, { seatKey: '2', name: 'Ben' });
  await service.submitMove(code, created.you.playerId, 'rock');
  await service.submitMove(code, joined.you.playerId, 'scissors');
  await service.submitMove(code, created.you.playerId, 'paper');
  await service.submitMove(code, joined.you.playerId, 'rock');
  return code;
}

describe('GET /replay/:ref', () => {
  it('serves the SPA with the match in its head', async () => {
    const { app, service } = buildApp(shellFetch);
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<script src="/assets/x.js"></script>');
    expect(res.text).toContain('og:title" content="Ana beat Ben 2–0 in RPSLR"');
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/replay/${code}"`);
    expect(res.text).toContain(`og:image" content="https://rpsls-duel.win/api/v1/replay/${code}/card.png"`);
    expect(res.text).toContain('twitter:card" content="summary_large_image"');
  });

  it('carries ?by= through to the image URL so the two cards cache apart', async () => {
    const { app, service } = buildApp(shellFetch);
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}?by=1`);
    expect(res.text).toContain('og:title" content="Ana wins 2–0!"');
    expect(res.text).toContain(`card.png?by=1`);
    expect(res.text).toContain(`og:url" content="https://rpsls-duel.win/replay/${code}?by=1"`);
  });

  it('answers a ref that does not exist with the generic card, not an error', async () => {
    const { app } = buildApp(shellFetch);
    const res = await request(app).get('/replay/does-not-exist');
    expect(res.status).toBe(200);
    expect(res.text).toContain('RPSLR on JoinQuest');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('answers even when the client service is unreachable', async () => {
    const dead = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const { app, service } = buildApp(dead);
    const code = await finishedMatch(service);
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
  });

  it('answers within a second even when the avatar host never replies', async () => {
    const stalling = vi.fn((url: string, init?: RequestInit) =>
      url.endsWith('/index.html')
        ? Promise.resolve(new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html' } }))
        : new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    const { app, service } = buildApp(stalling);
    const code = await finishedMatch(service);
    const started = Date.now();
    const res = await request(app).get(`/replay/${code}`);
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('GET /api/v1/replay/:ref/card.png', () => {
  it('renders a PNG of the right size, within the byte limit', async () => {
    const { app, service } = buildApp(shellFetch);
    const code = await finishedMatch(service);
    const res = await request(app).get(`/api/v1/replay/${code}/card.png`).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.body.readUInt32BE(16)).toBe(1200);
    expect(res.body.readUInt32BE(20)).toBe(630);
    expect(res.body.byteLength).toBeLessThanOrEqual(300_000);
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('gives an unknown ref a generic card that platforms must not cache', async () => {
    const { app } = buildApp(shellFetch);
    const res = await request(app).get('/api/v1/replay/nope/card.png').responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
```

- [ ] **Step 2: Add the config value and its test**

In `api/src/config.ts`, add to `AppConfig`:

```ts
  /** Where the API fetches the SPA shell from (GAME_CLIENT_ORIGIN). */
  clientOrigin: string;
```

and in the returned object, after `playUrl`:

```ts
    clientOrigin: (env.GAME_CLIENT_ORIGIN ?? '').trim() || playUrl,
```

Add to `api/src/config.test.ts`:

```ts
  it('falls back to the play URL when no client origin is configured', () => {
    const config = loadConfig({ GAME_PLAY_URL: 'https://rpsls-duel.win' } as NodeJS.ProcessEnv);
    expect(config.clientOrigin).toBe('https://rpsls-duel.win');
  });

  it('prefers an explicit client origin, so k8s can point at the in-cluster service', () => {
    const config = loadConfig({
      GAME_PLAY_URL: 'https://rpsls-duel.win',
      GAME_CLIENT_ORIGIN: 'http://rps-game-client',
    } as NodeJS.ProcessEnv);
    expect(config.clientOrigin).toBe('http://rps-game-client');
  });
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd api && npm test -- routes config`
Expected: FAIL — `registerReplayCardRoutes` does not exist and `createApp` takes no fourth argument.

- [ ] **Step 4: Implement the routes**

Create `api/src/replayCard/routes.ts`:

```ts
/**
 * The two public surfaces of a shared replay link.
 *
 * Neither may fail. A crawler caches by URL and most never come back, so a 500
 * served once is a dead card for good — every path below ends in a card.
 */
import type { Express, Request, Response } from 'express';
import type { AppConfig } from '../config.js';
import type { GameService } from '../service.js';
import { withAvatars } from './avatars.js';
import { TtlCache } from './cache.js';
import { renderCardPng } from './cardImage.js';
import { buildCardModel, genericCardModel, type CardModel } from './cardModel.js';
import { cardSvg } from './cardSvg.js';
import { FALLBACK_SHELL, getClientShell } from './clientTemplate.js';
import { injectMeta } from './metaHtml.js';

export interface ReplayCardDeps {
  service: Pick<GameService, 'getState'>;
  config: Pick<AppConfig, 'playUrl' | 'clientOrigin'>;
  fetchImpl?: typeof fetch;
}

const MODEL_TTL_MS = 10 * 60_000;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const HTML_CACHE = 'public, max-age=300';
const NO_STORE = 'no-store, no-cache, must-revalidate';

export function registerReplayCardRoutes(app: Express, deps: ReplayCardDeps): void {
  const models = new TtlCache<CardModel>(MODEL_TTL_MS);
  const images = new TtlCache<Buffer>(MODEL_TTL_MS);
  const origin = deps.config.playUrl.replace(/\/$/, '');

  app.get('/replay/:ref', async (req: Request, res: Response) => {
    const ref = req.params.ref;
    const by = seatParam(req);
    const query = by ? `?by=${encodeURIComponent(by)}` : '';
    let model = genericCardModel(ref);
    let shell = FALLBACK_SHELL;

    // Anything at all can go wrong here; the answer is a card either way.
    try {
      model = await modelFor(ref, by);
      shell = await getClientShell(deps.config.clientOrigin, { fetchImpl: deps.fetchImpl });
    } catch {
      model = genericCardModel(ref);
    }

    res
      .type('text/html')
      .set('Cache-Control', model.cacheable ? HTML_CACHE : NO_STORE)
      .send(
        injectMeta(shell, {
          model,
          pageUrl: `${origin}/replay/${encodeURIComponent(ref)}${query}`,
          imageUrl: `${origin}/api/v1/replay/${encodeURIComponent(ref)}/card.png${query}`,
        }),
      );
  });

  app.get('/api/v1/replay/:ref/card.png', async (req: Request, res: Response) => {
    const ref = req.params.ref;
    const by = seatParam(req);
    const key = cacheKey(ref, by);

    let png = images.get(key);
    // A cached PNG is only ever a cacheable one, so a hit is immutable by
    // construction; a miss has to ask the model it just built.
    let cacheable = png !== undefined;

    if (!png) {
      try {
        const model = await withAvatars(await modelFor(ref, by), { fetchImpl: deps.fetchImpl });
        png = renderCardPng(cardSvg(model));
        cacheable = model.cacheable;
        if (cacheable) images.set(key, png);
      } catch {
        png = renderCardPng(cardSvg(genericCardModel(ref)));
        cacheable = false;
      }
    }

    res
      .type('image/png')
      .set('Cache-Control', cacheable ? IMMUTABLE : NO_STORE)
      .send(png);
  });

  async function modelFor(ref: string, by: string | null): Promise<CardModel> {
    const key = cacheKey(ref, by);
    const cached = models.get(key);
    if (cached) return cached;
    try {
      const state = await deps.service.getState(ref);
      const model = buildCardModel(state, { ref, by });
      if (model.cacheable) models.set(key, model);
      return model;
    } catch {
      // Unknown ref, unreachable database — the card is the same either way.
      return genericCardModel(ref);
    }
  }
}

function cacheKey(ref: string, by: string | null): string {
  return by ? `${ref}?by=${by}` : ref;
}

/** A seat key is a short opaque string; anything else is not one. */
function seatParam(req: Request): string | null {
  const raw = req.query.by;
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value && value.length <= 64 ? value : null;
}
```

- [ ] **Step 5: Mount the routes**

In `api/src/app.ts`, extend the signature and register:

```ts
export function createApp(
  service: GameService,
  config: AppConfig,
  tokenVerifier?: TokenVerifier,
  opts: { fetchImpl?: typeof fetch } = {},
): Express {
```

and immediately before `app.use('/api/v1', api);`:

```ts
  // Replay link previews (JQ-120). Registered before the error middleware:
  // these routes answer with a card rather than an error, always.
  registerReplayCardRoutes(app, { service, config, fetchImpl: opts.fetchImpl });
```

with `import { registerReplayCardRoutes } from './replayCard/routes.js';` at the top.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `cd api && npm test`
Expected: PASS — the whole API suite, including the seven new route cases.

- [ ] **Step 7: Look at the card**

```bash
cd api && npm run card:preview -- /tmp/card.png
```

Open `/tmp/card.png`. Check: both names legible, the winner's ring gold, nothing clipped, and the centre square holds everything.

- [ ] **Step 8: Lint and commit**

```bash
cd api && npm run lint
git add api/src/app.ts api/src/config.ts api/src/config.test.ts api/src/replayCard/routes.ts api/src/replayCard/routes.test.ts
git commit -m "Answer a replay link with a card, whatever else has gone wrong"
```

---

### Task 8: The client hands over the sharer's seat

**Files:**
- Modify: `client/src/lib/replayLink.ts`, `client/src/App.tsx:564-565`
- Test: `client/src/lib/replayLink.test.ts`

**Interfaces:**
- Produces: `buildReplayUrl(ref: string, origin?: string, opts?: { by?: string | null }): string`

The existing two-argument calls keep working; `App.tsx` passes the local player's seat key.

- [ ] **Step 1: Write the failing tests**

Add to `client/src/lib/replayLink.test.ts`:

```ts
  it('appends the sharer\'s seat so their card reads as a win', () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win', { by: '1' })).toBe(
      'https://rpsls-duel.win/replay/ext-1?by=1',
    );
  });

  it('leaves the link neutral when no seat is given', () => {
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win')).toBe('https://rpsls-duel.win/replay/ext-1');
    expect(buildReplayUrl('ext-1', 'https://rpsls-duel.win', { by: null })).toBe(
      'https://rpsls-duel.win/replay/ext-1',
    );
  });

  it('escapes a seat key that would otherwise change the query', () => {
    expect(buildReplayUrl('ext-1', 'https://x.test', { by: 'a&b=c' })).toBe(
      'https://x.test/replay/ext-1?by=a%26b%3Dc',
    );
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `cd client && npm test -- replayLink`
Expected: FAIL — the third argument is ignored.

- [ ] **Step 3: Implement**

In `client/src/lib/replayLink.ts`, replace `buildReplayUrl` with:

```ts
/**
 * Absolute, because the whole point is to paste it somewhere else.
 *
 * `by` names the person sharing, not the winner: the API reads it to decide
 * whether the link-preview card celebrates or stays neutral, and the two spellings
 * are separate URLs so the platforms' caches never collide.
 */
export function buildReplayUrl(
  ref: string,
  origin: string = typeof window !== 'undefined' ? window.location.origin : '',
  opts: { by?: string | null } = {},
): string {
  const base = `${origin.replace(/\/$/, '')}/replay/${encodeURIComponent(ref)}`;
  const by = opts.by?.trim();
  return by ? `${base}?by=${encodeURIComponent(by)}` : base;
}
```

- [ ] **Step 4: Pass the seat at the call site**

In `client/src/App.tsx:565`, replace:

```tsx
  const replayUrl = shareRef ? buildReplayUrl(shareRef) : null;
```

with:

```tsx
  const replayUrl = shareRef ? buildReplayUrl(shareRef, undefined, { by: mySeatKey }) : null;
```

`mySeatKey` is already in scope — it is the component state set from `result.you.seatKey` at `App.tsx:215` and used at `533` to pick `mySeat`. Reuse it; do not introduce a second binding. It is `null` until the seat is claimed, which `buildReplayUrl` accepts and reads as neutral.

- [ ] **Step 5: Run the client suite**

Run: `cd client && npm test`
Expected: PASS, including the existing `replayLink` and `App` tests.

- [ ] **Step 6: Lint and commit**

```bash
cd client && npm run lint
git add client/src/lib/replayLink.ts client/src/lib/replayLink.test.ts client/src/App.tsx
git commit -m "Let the person sharing a replay share it as their own"
```

---

### Task 9: Routing, config and docs

**Files:**
- Modify: `k8s/base/ingress.yaml`, `k8s/base/api.yaml` (memory limit), `k8s/env/local.yaml`, `k8s/env/staging.yaml`, `k8s/env/production.yaml`, `.env.example`, `docs/development.md`

- [ ] **Step 1: Route /replay to the API at the ingress**

In `k8s/base/ingress.yaml`, add above the `/` path (ingress-nginx matches the longest prefix, but keeping it above the catch-all keeps the intent readable):

```yaml
          # Replay links are served by the API so a crawler gets og: meta in the
          # head; the API returns the client's own index.html around them, so a
          # human still lands on the SPA (JQ-120).
          - path: /replay
            pathType: Prefix
            backend:
              service:
                name: rps-game-api
                port:
                  number: 3001
```

- [ ] **Step 2: Point the API at the client service**

Add to the `rps-game-api-config` ConfigMap in each of `k8s/env/local.yaml`, `k8s/env/staging.yaml` and `k8s/env/production.yaml`:

```yaml
  # Where /replay fetches the SPA shell from. In-cluster service, not the public
  # host — no hairpin through the ingress.
  GAME_CLIENT_ORIGIN: "http://rps-game-client"
```

- [ ] **Step 3: Give the API room for the renderer**

In `k8s/base/api.yaml`, raise the memory limit from `192Mi` to `256Mi`: resvg holds a 1200×630 RGBA buffer (~3 MB) plus the font buffers and the cached cards.

- [ ] **Step 4: Document the new environment variable**

In `.env.example`, under the Game API block:

```bash
# Where the API fetches the SPA shell for /replay link previews. Defaults to
# GAME_PLAY_URL; in Kubernetes it is the in-cluster client service.
# GAME_CLIENT_ORIGIN=http://localhost:5174
```

- [ ] **Step 5: Note the local-dev difference**

In `docs/development.md`, add to the section describing the dev servers:

```markdown
### Replay link previews

In production the ingress routes `/replay/*` to the API, which serves the
`og:`/`twitter:` meta tags and the SPA in one response. In local dev there is no
ingress: vite serves `/replay/:id` to your browser as it always has, and the
card is checked against the API directly —

    curl -s localhost:3001/replay/RPS-ABCD | grep og:
    open http://localhost:3001/api/v1/replay/RPS-ABCD/card.png

`npm run card:preview -- /tmp/card.png` in `api/` renders a card with no match
at all, which is the quickest way to look at a design change.
```

- [ ] **Step 6: Verify both suites and the manifests**

```bash
cd api && npm test && npm run lint
cd ../client && npm test && npm run lint
kubectl apply --dry-run=client -k k8s/base >/dev/null && echo "manifests parse"
```

If `kubectl` is not installed, skip the last line and say so in the PR.

- [ ] **Step 7: Commit**

```bash
git add k8s .env.example docs/development.md
git commit -m "Send replay links to the server that has something to say about them"
```

---

## Verification before the PR

- [ ] `cd api && npm test` — every suite green.
- [ ] `cd client && npm test` — every suite green.
- [ ] `cd api && npm run lint && cd ../client && npm run lint`.
- [ ] `npm run card:preview -- /tmp/card.png` and look at the result.
- [ ] `git status --short` is empty in the worktree, and the primary clone is untouched.
- [ ] The PR body names the one acceptance criterion this branch cannot close: verification in iMessage, Discord, WhatsApp, Slack, the X card validator and the Facebook sharing debugger, which needs a staging deploy and a phone.
