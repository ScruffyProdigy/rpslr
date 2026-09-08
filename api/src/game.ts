/**
 * Pure Rock-Paper-Scissors-Lizard-Robot logic plus the "delay mark" cooldown
 * system. No I/O here so it is trivially testable.
 *
 * Cooldowns: a player may only choose a move with 0 delay marks. After each
 * choice, every move loses one mark (floored at 0) and the chosen move gains 2.
 * The match opens with lizard at 1 mark and robot at 2 (rock/paper/scissors 0).
 *
 * Those numbers are the *default*, not the only possibility. A helpers match hands
 * in a `PlayerRules` per seat instead, and the engine reads every rule from it —
 * what a move costs, which moves it beats, how a draw resolves. `BASE_RULES` is
 * the no-helpers case, so a plain duel is not a special path through this file, it
 * is the identity element of the same one.
 *
 * `PlayerRules` is declared here, not in `helpers/`, because it is this engine's
 * own parameter type. Keeping it here means `game.ts` imports nothing from the
 * card roster — the engine cannot grow a dependency on the cards, only on the
 * shape of the rules it is handed.
 */

export const MOVES = ['rock', 'paper', 'scissors', 'lizard', 'robot'] as const;
export type Move = (typeof MOVES)[number];

/**
 * What each move beats (RPSLR — every move beats exactly two others).
 *
 * Exported because a loadout compiles to a per-player copy of it: Chimera adds
 * `lizard → scissors` for its owner and nobody else. Treat it as read-only; build
 * a new object rather than pushing onto these arrays.
 */
export const BEATS: Record<Move, Move[]> = {
  rock: ['scissors', 'lizard'],
  paper: ['rock', 'robot'],
  scissors: ['paper', 'lizard'],
  lizard: ['robot', 'paper'],
  robot: ['scissors', 'rock'],
};

/** Delay marks each move starts the match with, absent any helpers. */
export const INITIAL_DELAYS: Record<Move, number> = {
  rock: 0,
  paper: 0,
  scissors: 0,
  lizard: 1,
  robot: 2,
};

/** How many delay marks the move you choose gains, absent any helpers. */
export const DELAY_ON_CHOICE = 2;

export function isMove(value: unknown): value is Move {
  return typeof value === 'string' && (MOVES as readonly string[]).includes(value);
}

export type RoundOutcome = 'a' | 'b' | 'draw';

/**
 * Decide a single round between player A's and player B's moves, through A's
 * graph. Defaults to the shared one, so every existing call site is unchanged.
 *
 * With per-player graphs "A won" is no longer the negation of "B won" — a Chimera
 * Lizard against Scissors is a win read from A's side and a loss read from B's —
 * so a caller that needs both sides asks twice, once per graph.
 */
export function decideRound(
  moveA: Move,
  moveB: Move,
  beatsA: Record<Move, readonly Move[]> = BEATS,
): RoundOutcome {
  if (moveA === moveB) return 'draw';
  return beatsA[moveA].includes(moveB) ? 'a' : 'b';
}

export type DelayMap = Record<Move, number>;

/** A round's result from one player's point of view. Not seat-relative. */
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

/** Marks a round adds beyond the chosen-move cost, on either side of the table. */
export interface MarkAdjustment {
  own: Partial<Record<Move, number>>;
  opponent: Partial<Record<Move, number>>;
}

/**
 * What a player's helpers let them see, or hide. The engine does not act on any
 * of it — cooldowns are still computed the same way — but it travels with the
 * rules so the presentation layer has one place to read (JQ-149, JQ-151).
 */
export interface Disclosure {
  /** Poker Face: the opponent is never told this player has locked in. */
  hidesLockIn: boolean;
  /** Old Habits: this player is shown the opponent's most-played move. */
  showsOpponentMostPlayed: boolean;
  /** Watchful: this player is shown the opponent's cooldowns as they will stand. */
  showsOpponentNextCooldowns: boolean;
}

/**
 * Every rule the engine needs from one seat. A loadout compiles to one of these;
 * a plain duel uses `BASE_RULES`.
 */
export interface PlayerRules {
  initialDelays: DelayMap;
  /** Where a same-move collision displaced the cheaper helper's marks. */
  rolledMove: Move | null;
  beats: Record<Move, readonly Move[]>;
  disclosure: Disclosure;
  delayOnChoice(ctx: DelayContext): number;
  transformOutcome(raw: PlayerOutcome, ctx: OutcomeContext): PlayerOutcome;
  adjustAfterRound(ctx: OutcomeContext & { outcome: PlayerOutcome }): MarkAdjustment;
}

export const NO_DISCLOSURE: Disclosure = {
  hidesLockIn: false,
  showsOpponentMostPlayed: false,
  showsOpponentNextCooldowns: false,
};

const NO_ADJUSTMENT: MarkAdjustment = { own: {}, opponent: {} };

/**
 * The rules a seat plays by with no helpers at all — which is to say, the rules
 * this game had before loadouts existed. `duel` runs on exactly this.
 */
export const BASE_RULES: PlayerRules = {
  initialDelays: { ...INITIAL_DELAYS },
  rolledMove: null,
  beats: BEATS,
  disclosure: NO_DISCLOSURE,
  delayOnChoice: () => DELAY_ON_CHOICE,
  transformOutcome: (raw) => raw,
  adjustAfterRound: () => NO_ADJUSTMENT,
};

/**
 * Replay a player's chosen moves (in order) to get their current delay marks.
 * Pass the moves the player has made in *resolved* rounds to get the state they
 * enter the next round with.
 *
 * Only correct where no helper can reach across the table, i.e. a plain duel. A
 * helpers match must use `replayMatch`, which sees both seats.
 */
export function computeDelays(moves: Move[]): DelayMap {
  const delays: DelayMap = { ...INITIAL_DELAYS };
  for (const move of moves) {
    for (const m of MOVES) delays[m] = Math.max(0, delays[m] - 1);
    delays[move] += DELAY_ON_CHOICE;
  }
  return delays;
}

export interface PlayedRound {
  a: Move;
  b: Move;
}

/**
 * Replay a whole match to both players' current marks.
 *
 * Per-seat replay is not enough once helpers exist: Grudge, Echo Chamber and
 * Small Mercy all let one player's round change the *other* player's marks, so
 * the two sequences are coupled and have to be walked together. Still pure — it
 * takes the rules, it does not go looking for them.
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
    const { outcomeA, outcomeB } = resolveRound(round, rulesA, rulesB, {
      roundIndex,
      lossesA,
      lossesB,
    });

    for (const m of MOVES) {
      a[m] = Math.max(0, a[m] - 1);
      b[m] = Math.max(0, b[m] - 1);
    }
    a[round.a] += rulesA.delayOnChoice({ move: round.a, outcome: outcomeA, roundIndex });
    b[round.b] += rulesB.delayOnChoice({ move: round.b, outcome: outcomeB, roundIndex });

    const ctxA = { own: round.a, opponent: round.b, roundIndex, lossesSoFar: lossesA };
    const ctxB = { own: round.b, opponent: round.a, roundIndex, lossesSoFar: lossesB };
    const adjA = rulesA.adjustAfterRound({ ...ctxA, outcome: outcomeA });
    const adjB = rulesB.adjustAfterRound({ ...ctxB, outcome: outcomeB });
    for (const [m, n] of Object.entries(adjA.own)) a[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjA.opponent)) b[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjB.own)) b[m as Move] += n ?? 0;
    for (const [m, n] of Object.entries(adjB.opponent)) a[m as Move] += n ?? 0;

    if (outcomeA === 'loss') lossesA += 1;
    if (outcomeB === 'loss') lossesB += 1;
  });

  return { a, b };
}

/** True when `beats` grants an edge the shared graph does not, i.e. a helper added it. */
function isAddedEdge(beats: Record<Move, readonly Move[]>, from: Move, to: Move): boolean {
  return beats[from].includes(to) && !BEATS[from].includes(to);
}

/**
 * Who wins a round when the two sides no longer share one graph.
 *
 * Reading each side through only its own graph does not work: Chimera gives A the
 * edge `lizard → scissors` while B's untouched graph still has `scissors → lizard`,
 * so both would read a win, and each would then be charged the marks of a win they
 * did not both get. A round has one winner, so one rule settles the conflict — **an
 * edge a helper added beats an edge that was always there.** That is what "your
 * Lizard *also* beats Scissors" has to mean for it to be worth holding.
 *
 * No two added edges can both apply to one round: both players' moves are fixed,
 * so at most one direction of a pair is in play.
 */
export function seatWinner(
  round: PlayedRound,
  rulesA: PlayerRules,
  rulesB: PlayerRules,
): RoundOutcome {
  if (round.a === round.b) return 'draw';
  if (isAddedEdge(rulesA.beats, round.a, round.b)) return 'a';
  if (isAddedEdge(rulesB.beats, round.b, round.a)) return 'b';
  return decideRound(round.a, round.b);
}

/**
 * The one authoritative result of a round, plus how each player ends up reading it.
 *
 * The split matters. `seat` is the round's single winner and is what scoring uses.
 * The two `outcome`s are what each *player* experienced after their own helpers
 * had their say, and they are allowed to disagree with `seat` and with each other:
 * Good Old Rock turns A's loss into a draw without taking B's win away, and if both
 * players hold Sharp Practice a Scissors mirror is a win for each of them. Cooldown
 * marks follow the player's own outcome, because that is what their cards priced.
 */
export function resolveRound(
  round: PlayedRound,
  rulesA: PlayerRules,
  rulesB: PlayerRules,
  at: { roundIndex: number; lossesA: number; lossesB: number },
): { seat: RoundOutcome; outcomeA: PlayerOutcome; outcomeB: PlayerOutcome } {
  const seat = seatWinner(round, rulesA, rulesB);
  const rawA: PlayerOutcome = seat === 'a' ? 'win' : seat === 'b' ? 'loss' : 'draw';
  const rawB: PlayerOutcome = seat === 'b' ? 'win' : seat === 'a' ? 'loss' : 'draw';

  return {
    seat,
    outcomeA: rulesA.transformOutcome(rawA, {
      own: round.a,
      opponent: round.b,
      roundIndex: at.roundIndex,
      lossesSoFar: at.lossesA,
    }),
    outcomeB: rulesB.transformOutcome(rawB, {
      own: round.b,
      opponent: round.a,
      roundIndex: at.roundIndex,
      lossesSoFar: at.lossesB,
    }),
  };
}

/**
 * Moves currently selectable — and never an empty list.
 *
 * Normally that is the moves on 0 marks. Helpers can drive every move above 0:
 * Quarantine deepens what you played, Rust blocks what is left, Freeze stops the
 * decrement that would have freed something. A player with nothing to play cannot
 * submit, waits out the timer, and takes an expiry strike for a state they had no
 * way to escape — and strikes forfeit the match. So there is a floor of one: when
 * nothing is clear, the least-marked moves are playable.
 *
 * Unreachable in `duel`, where at most two moves carry marks, so the floor cannot
 * change what a duel does. The byte-identity fixture holds it to that.
 */
export function availableMoves(delays: DelayMap): Move[] {
  const clear = MOVES.filter((m) => delays[m] === 0);
  if (clear.length > 0) return clear;
  const fewest = Math.min(...MOVES.map((m) => delays[m]));
  return MOVES.filter((m) => delays[m] === fewest);
}

/**
 * Given a target number of round wins (best-of derived), determine whether the
 * match is over and who won. Draw rounds do not count toward either score.
 */
export function matchWinner(
  scoreA: number,
  scoreB: number,
  winsNeeded: number,
): RoundOutcome | null {
  if (scoreA >= winsNeeded) return 'a';
  if (scoreB >= winsNeeded) return 'b';
  return null;
}

/** best-of N (e.g. 5) means first to floor(N/2)+1 wins (3). */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}
