/**
 * Support for JQ-147's byte-identity guarantee.
 *
 * The refactor rewrites the cooldown engine. The only way to prove `duel` did not
 * move is to serialise its behaviour *before* the rewrite and compare after, so
 * everything here is written to produce the same bytes on either side of the
 * change: it drives the public `GameService` API and the exported engine
 * functions, never their internals.
 *
 * Two goldens, because they fail differently:
 *   - `engineTable` is the pure cooldown lattice — every legal move sequence a
 *     duel can reach, mapped to the marks it leaves behind. A pricing or
 *     decrement-order slip shows up here, naming the exact sequence.
 *   - `scriptedDuel` is a whole match through the service, which catches a
 *     wiring slip that the pure layer cannot see.
 */

import { MemoryGameRepository } from '../memoryRepository.js';
import { GameService } from '../service.js';
import {
  INITIAL_DELAYS,
  MOVES,
  availableMoves,
  computeDelays,
  decideRound,
  type Move,
} from '../game.js';

/** Fixed clock, so `serverNow` is not a diff. */
const FIXED_NOW = Date.parse('2026-01-01T00:00:00.000Z');

/** Seeded LCG, so match codes are stable. */
function seededRng(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Every legal move sequence up to `depth` choices, mapped to the delay marks it
 * leaves. Only sequences a player could actually play are walked — a move on
 * cooldown is not reachable, so recording its marks would assert nothing.
 */
export function engineTable(depth = 5): Record<string, Record<Move, number>> {
  const table: Record<string, Record<Move, number>> = {};
  const walk = (played: Move[]): void => {
    if (played.length > 0) table[played.join('>')] = computeDelays(played);
    if (played.length === depth) return;
    for (const move of availableMoves(computeDelays(played))) walk([...played, move]);
  };
  walk([]);
  return table;
}

/** The opening marks and the moves they leave live, as a duel deals them. */
export function openingTable(): { initial: Record<Move, number>; live: Move[] } {
  return { initial: { ...INITIAL_DELAYS }, live: availableMoves(INITIAL_DELAYS) };
}

/** The full outcome grid, so a per-player graph cannot quietly change the shared one. */
export function outcomeGrid(): Record<string, string> {
  const grid: Record<string, string> = {};
  for (const a of MOVES) for (const b of MOVES) grid[`${a}v${b}`] = decideRound(a, b);
  return grid;
}

/**
 * Replace generated ids and codes with stable placeholders, in first-seen order,
 * so the snapshot compares on rules and not on UUIDs.
 */
export function normalise(value: unknown): unknown {
  const seen = new Map<string, string>();
  const swap = (s: string): string => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const withIds = s.replace(uuid, (m) => {
      if (!seen.has(m)) seen.set(m, `<id:${seen.size}>`);
      return seen.get(m)!;
    });
    return withIds.replace(/^RPS-[A-Z0-9-]+$/, '<code>');
  };
  const visit = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v);
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[swap(k)] = visit((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return visit(value);
}

/**
 * A scripted best-of-5 played to a decision, exercising a win, a draw, and a
 * cooldown-forced pick. Returns the normalised final state plus the state after
 * every round, because a mid-match cooldown regression would not show in the
 * final state alone.
 */
export async function scriptedDuel(): Promise<unknown> {
  const service = new GameService(new MemoryGameRepository(), {
    now: () => FIXED_NOW,
    rng: seededRng(),
  });
  const created = await service.createStandaloneMatch({
    name: 'Golden',
    hostName: 'Alice',
    bestOf: 5,
  });
  const code = created.state.match.code;
  const hostId = created.you.playerId;
  const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
  const challengerId = joined.you.playerId;

  // rock/rock draws, then rock is on cooldown for both; paper beats rock;
  // scissors beats paper; lizard opens up once its opening mark decays.
  const script: [Move, Move][] = [
    ['rock', 'rock'],
    ['paper', 'scissors'],
    ['scissors', 'paper'],
    ['rock', 'lizard'],
    ['paper', 'rock'],
  ];

  const perRound: unknown[] = [];
  for (const [a, b] of script) {
    await service.submitMove(code, hostId, a);
    const state = await service.submitMove(code, challengerId, b);
    perRound.push(normalise(state));
    if (state.match.status === 'finished') break;
  }
  return { perRound, final: normalise(await service.getState(code)) };
}

/** Everything the byte-identity test compares, in one object. */
export async function captureGolden(): Promise<unknown> {
  return {
    opening: openingTable(),
    outcomes: outcomeGrid(),
    engineTable: engineTable(),
    duel: await scriptedDuel(),
  };
}
