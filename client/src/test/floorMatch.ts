/**
 * The one match that reaches the cooldown floor, as data.
 *
 * `commentary.test.ts` asserts the board this produces — round 5 pinned to a
 * single playable move, round 6 with a mark on all five — and
 * `ReplayPage.test.tsx` asserts that the page can play that same board through
 * without throwing. They had a copy each, and a comment in one claiming to be
 * "the same script as" the other. They were not: the loadouts and the firings
 * had drifted apart while both comments still said they matched (JQ-256).
 *
 * So the script lives here once. It is data rather than a built fixture because
 * the two readers need different shapes of it — a `Replay` and a `MatchState` —
 * and only the script itself is the thing that must not diverge.
 *
 * ## Why this script reaches the floor
 *
 * Rebuilt by JQ-209, which repriced the two cards that used to produce it. Rust
 * added two marks a firing on a three-mark recharge, and Freeze recharged at
 * all; between them they could bury a board twice in six rounds, which is the
 * ~26pp each turned out to be worth. Neither can now, so the floor is reached
 * the way the game intends instead: by accumulation.
 *
 * Ana carries Echo Chamber, so every drawn round costs her an extra mark of her
 * own. Ben's Quarantine names her pick in rounds 1 and 5 and lands both, adding
 * two more each time. Five drawn rounds mean she pays for a pick every round
 * with nothing coming back. By round 5 she is down to a single playable move,
 * and by round 6 every one of the five carries a mark and the floor is the only
 * thing giving her a hand at all.
 *
 * Six rounds, not seven, since JQ-214: `roundCap` is `bestOf * 2`, so a
 * best-of-3 cannot reach a seventh. The match therefore ends *at* the cap on
 * Ana's 1-0 rather than on the win threshold — which is the point of putting
 * five draws in front of it, and means this fixture covers a capped finish as
 * well as the floor. A seventh round would describe a match the server can no
 * longer produce, and this fixture's whole claim is that it describes one it
 * can.
 *
 * Scripted rather than mutated: every move in it is one `availableMoves` would
 * have allowed, so it is a board the server can actually arrive at.
 */

import type { AbilityFiring } from '@game/types';
import type { Loadout } from '@game/helpers/loadout';
import type { Move, RoundResult, Seat } from '../api';

/** The match-level facts the floor script needs, for either reader's builder. */
export const FLOOR_MATCH = {
  bestOf: 3,
  currentRound: 6,
  gameMode: 'duel-helpers',
  winnerSeatKey: 'a',
} as const;

const LOADOUTS: Record<string, Loadout> = {
  a: ['bookend', 'watchful'],
  b: ['echo-chamber', 'quarantine'],
};

function floorSeat(position: number, seatKey: string, playerId: string, name: string): Seat {
  return {
    id: `seat-${seatKey}`,
    matchId: 'm1',
    seatKey,
    teamKey: null,
    role: null,
    position,
    reservedForLobbyUser: null,
    player: { id: playerId, name, lobbyUserId: null, score: 0, profile: null, expiryStrikes: 0 },
    lobbyProfile: null,
    delays: {},
    loadout: LOADOUTS[seatKey]!,
    loadoutRoll: null,
  };
}

/** Fresh seats each call — a caller that spreads over one must not mutate the next. */
export const floorSeats = (): Seat[] => [
  floorSeat(0, 'a', 'pa', 'Ana'),
  floorSeat(1, 'b', 'pb', 'Ben'),
];

/** Five mirrored draws, then the round the cap ends on. */
const SCRIPT: [Move, Move, string][] = [
  ['rock', 'rock', 'draw'],
  ['paper', 'paper', 'draw'],
  ['scissors', 'scissors', 'draw'],
  ['lizard', 'lizard', 'draw'],
  ['robot', 'robot', 'draw'],
  ['paper', 'rock', 'a'],
];

export const floorRounds = (): RoundResult[] =>
  SCRIPT.map(([a, b, outcome], i) => ({
    round: i + 1,
    outcome,
    moves: { pa: a, pb: b },
    autoPicked: [],
  }));

/**
 * Quarantine names the move Ana is about to play and lands both times — a hit is
 * two marks, and its three-mark recharge puts it in rounds 1 and 5.
 */
export const FLOOR_FIRINGS: AbilityFiring[] = [
  { round: 1, seatKey: 'b', helperId: 'quarantine', target: 'rock', source: null },
  { round: 5, seatKey: 'b', helperId: 'quarantine', target: 'robot', source: null },
];
