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

/**
 * One mark movement, and the card that caused it.
 *
 * `helperId` is what makes the board explicable. A move is on cooldown for one of
 * a dozen reasons in a helpers match, and only three of them are "you played it" —
 * so a mark that arrives without saying where it came from is a mark the board can
 * only guess about, and guessing is how "You played Rock last round" ends up
 * printed over a Quarantine (JQ-151).
 *
 * `amount` is signed: Thief and Flywheel take marks off.
 */
export interface AttributedMark {
  move: Move;
  amount: number;
  /** The helper responsible. A plain string for the same reason `Firing.id` is. */
  helperId: string;
}

/** Marks a round adds beyond the chosen-move cost, on either side of the table. */
export interface MarkAdjustment {
  own: readonly AttributedMark[];
  opponent: readonly AttributedMark[];
}

/** Why a mark landed, for the board's "why is this on cooldown?" line. */
export type MarkCause =
  | { kind: 'opening' }
  | { kind: 'choice' }
  | { kind: 'sacrifice' }
  /** A helper, and whether its owner was this seat or the one across the table. */
  | { kind: 'helper'; helperId: string; mine: boolean };

/**
 * One entry in the ledger: marks landing on one seat's board, and why.
 *
 * Recorded per round so the board can say *when* as well as why, and signed so a
 * removal reads as one. Decay is deliberately absent — it happens to every move
 * every round and explains nothing about a particular one.
 */
export interface MarkEvent {
  /** 0-based, matching `roundIndex` everywhere else in this engine. */
  round: number;
  /** Whose board the mark landed on. */
  side: 'a' | 'b';
  move: Move;
  amount: number;
  cause: MarkCause;
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
 * One ability's cooldown slot, as the engine sees it.
 *
 * Declared here rather than in `helpers/` for the same reason `PlayerRules` is:
 * it is a parameter of this engine, so the dependency keeps running one way. The
 * roster fills these in; the engine only ever reads them.
 */
export interface AbilitySlot {
  /** Marks the ability starts the match on, and so how long before it may fire. */
  opening: number;
  /** Marks firing costs. `null` is "once per match": firing spends it for good. */
  recharge: number | null;
}

/** The ability slots one seat holds, keyed by the helper id that granted them. */
export type AbilitySlots = Record<string, AbilitySlot>;

/**
 * One ability fired in one round.
 *
 * `id` is a plain `string` rather than a roster type on purpose: this engine
 * imports nothing from the cards, so it knows an ability only by the name the
 * rules it was handed answer to.
 */
export interface Firing {
  id: string;
  /** The opponent move this firing names: Quarantine's guess, Rust's and Thief's target. */
  target?: Move;
  /** Thief alone also names one of its owner's moves, to take the mark from. */
  source?: Move;
}

/** What a seat fired this round, as the effects hook sees it. */
export interface FiringContext {
  firings: readonly Firing[];
  own: Move;
  opponent: Move;
  /**
   * The opponent's marks as they stand *entering* the round, before the decrement.
   *
   * Rust needs it: "a move they currently have live" is what the firing player was
   * looking at when they named it, not what survives the end of the round.
   */
  opponentDelays: DelayMap;
  /** This seat's own marks entering the round. Thief takes from these. */
  ownDelays: DelayMap;
}

/** What a seat's firings do to the round, beyond what its moves do. */
export interface FiringEffect {
  /** Freeze: the opponent's marks do not come off at the end of this round. */
  freezesOpponentDecay: boolean;
  /** Marks the firings add, on either side of the table. */
  marks: MarkAdjustment;
}

export const NO_FIRING_EFFECT: FiringEffect = {
  freezesOpponentDecay: false,
  marks: { own: [], opponent: [] },
};

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
  /** Abilities this seat may fire. Empty for a duel, and for an all-passive loadout. */
  abilities: AbilitySlots;
  /** What this seat's abilities do to a round when fired. */
  fireEffects(ctx: FiringContext): FiringEffect;
  /**
   * Sacrifice: fired *before* either seat picks, so it settles the round on its
   * own rather than adjusting one that happened. Kept apart from `fireEffects`
   * because of that timing — it needs none of the round's moves or marks, and it
   * runs before every hook that does.
   */
  declaresDraw(firings: readonly Firing[]): boolean;
  delayOnChoice(ctx: DelayContext): number;
  transformOutcome(raw: PlayerOutcome, ctx: OutcomeContext): PlayerOutcome;
  adjustAfterRound(ctx: OutcomeContext & { outcome: PlayerOutcome }): MarkAdjustment;
}

export const NO_DISCLOSURE: Disclosure = {
  hidesLockIn: false,
  showsOpponentMostPlayed: false,
  showsOpponentNextCooldowns: false,
};

const NO_ADJUSTMENT: MarkAdjustment = { own: [], opponent: [] };

/** The one cause with nothing to parameterise: you played the move. */
const CHOICE: MarkCause = { kind: 'choice' };

/**
 * The rules a seat plays by with no helpers at all — which is to say, the rules
 * this game had before loadouts existed. `duel` runs on exactly this.
 */
export const BASE_RULES: PlayerRules = {
  initialDelays: { ...INITIAL_DELAYS },
  rolledMove: null,
  beats: BEATS,
  disclosure: NO_DISCLOSURE,
  abilities: {},
  fireEffects: () => NO_FIRING_EFFECT,
  declaresDraw: () => false,
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
  /**
   * What each seat fired this round.
   *
   * The one thing here a replay cannot derive: every other input to the marks
   * follows from the moves, but firing is a *choice*, so it has to arrive with
   * the round or be lost. Absent on every duel round.
   */
  firedA?: readonly Firing[];
  firedB?: readonly Firing[];
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
): { a: DelayMap; b: DelayMap; events: MarkEvent[] } {
  const a: DelayMap = { ...rulesA.initialDelays };
  const b: DelayMap = { ...rulesB.initialDelays };
  let lossesA = 0;
  let lossesB = 0;
  // Every mark that lands, and what put it there. Built alongside the arithmetic
  // rather than derived from it afterwards: the same +2 on Rock means "you played
  // it", "they Quarantined it" or "Rust deepened it" depending only on which line
  // below added it, and that is knowable here and nowhere else.
  const events: MarkEvent[] = [];
  /** Opening marks explain a cooldown nobody has touched yet, so they are round -1. */
  for (const side of ['a', 'b'] as const) {
    const rules = side === 'a' ? rulesA : rulesB;
    for (const m of MOVES) {
      if (rules.initialDelays[m] > 0) {
        events.push({
          round: -1,
          side,
          move: m,
          amount: rules.initialDelays[m],
          cause: { kind: 'opening' },
        });
      }
    }
  }

  rounds.forEach((round, roundIndex) => {
    const { outcomeA, outcomeB } = resolveRound(round, rulesA, rulesB, {
      roundIndex,
      lossesA,
      lossesB,
    });

    // Firings are read before anything else in the round moves: Freeze acts on the
    // decrement below, so it has to be known before it happens.
    const firedA = rulesA.fireEffects({
      firings: round.firedA ?? [],
      own: round.a,
      opponent: round.b,
      opponentDelays: { ...b },
      ownDelays: { ...a },
    });
    const firedB = rulesB.fireEffects({
      firings: round.firedB ?? [],
      own: round.b,
      opponent: round.a,
      opponentDelays: { ...a },
      ownDelays: { ...b },
    });

    for (const m of MOVES) {
      if (!firedB.freezesOpponentDecay) a[m] = Math.max(0, a[m] - 1);
      if (!firedA.freezesOpponentDecay) b[m] = Math.max(0, b[m] - 1);
    }
    // Sacrifice clears its owner's board when it is *fired*, which is before either
    // seat picks — so the move they go on to play still takes its normal cost, and
    // they enter the next round with four moves live rather than five. Clearing at
    // the end of the round instead would hand back the tempo too, making a Major
    // that costs nothing to fire and yields the strongest board in the game.
    const wiped = (side: 'a' | 'b', marks: DelayMap) => {
      for (const m of MOVES) {
        if (marks[m] > 0) {
          events.push({
            round: roundIndex,
            side,
            move: m,
            amount: -marks[m],
            cause: { kind: 'sacrifice' },
          });
        }
        marks[m] = 0;
      }
    };
    if (rulesA.declaresDraw(round.firedA ?? [])) wiped('a', a);
    if (rulesB.declaresDraw(round.firedB ?? [])) wiped('b', b);

    const costA = rulesA.delayOnChoice({ move: round.a, outcome: outcomeA, roundIndex });
    const costB = rulesB.delayOnChoice({ move: round.b, outcome: outcomeB, roundIndex });
    a[round.a] += costA;
    b[round.b] += costB;
    events.push({ round: roundIndex, side: 'a', move: round.a, amount: costA, cause: CHOICE });
    events.push({ round: roundIndex, side: 'b', move: round.b, amount: costB, cause: CHOICE });

    const ctxA = { own: round.a, opponent: round.b, roundIndex, lossesSoFar: lossesA };
    const ctxB = { own: round.b, opponent: round.a, roundIndex, lossesSoFar: lossesB };
    const adjA = rulesA.adjustAfterRound({ ...ctxA, outcome: outcomeA });
    const adjB = rulesB.adjustAfterRound({ ...ctxB, outcome: outcomeB });
    // Floored, unlike the passive adjustments used to be: Thief is the first effect
    // that subtracts, and a mark it names entering the round may already have
    // decremented away by the time the adjustment lands. `floor` says which of the
    // two rules applies, and the ledger records what was actually asked for either
    // way — a mark the floor swallowed still explains why nothing moved.
    const apply = (
      marks: DelayMap,
      side: 'a' | 'b',
      entries: readonly AttributedMark[],
      /** Whose cards these are, from the point of view of the seat they land on. */
      mine: boolean,
      floor: boolean,
    ) => {
      for (const { move, amount, helperId } of entries) {
        marks[move] = floor ? Math.max(0, marks[move] + amount) : marks[move] + amount;
        events.push({
          round: roundIndex,
          side,
          move,
          amount,
          cause: { kind: 'helper', helperId, mine },
        });
      }
    };
    apply(a, 'a', adjA.own, true, false);
    apply(b, 'b', adjA.opponent, false, false);
    apply(b, 'b', adjB.own, true, false);
    apply(a, 'a', adjB.opponent, false, false);
    apply(a, 'a', firedA.marks.own, true, true);
    apply(b, 'b', firedA.marks.opponent, false, true);
    apply(b, 'b', firedB.marks.own, true, true);
    apply(a, 'a', firedB.marks.opponent, false, true);

    if (outcomeA === 'loss') lossesA += 1;
    if (outcomeB === 'loss') lossesB += 1;
  });

  return { a, b, events };
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
  // A sacrificed round is a draw before either seat picks, so there is no result
  // for `transformOutcome` to read: Sharp Practice cannot turn it into a win, and
  // Good Old Rock has no loss to spare.
  if (rulesA.declaresDraw(round.firedA ?? []) || rulesB.declaresDraw(round.firedB ?? [])) {
    return { seat: 'draw', outcomeA: 'draw', outcomeB: 'draw' };
  }

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

/**
 * The most rounds a match may run before it is settled on score alone.
 *
 * Draws score nothing, so the win threshold alone bounds nothing: two players
 * mirroring each other draw forever, and helpers mode pays them to (Sacrifice
 * wants round 4+, Oracle wants the stakes high, Copycat discounts the draw).
 * Twice the nominal length leaves room for a genuinely long fight — a best-of-5
 * gets 5 rounds of slack over its 5 decisive ones — while still terminating.
 */
export function roundCap(bestOf: number): number {
  return bestOf * 2;
}

/**
 * Whether the match is over, and how, after `roundsPlayed` completed rounds.
 *
 * The threshold is checked first, so nothing about a normal match changes. Only
 * a match that reaches the cap undecided is settled by comparison, and only one
 * that reaches it level is a `draw` — the single case with no winning seat.
 */
export function matchOutcome(
  scoreA: number,
  scoreB: number,
  bestOf: number,
  roundsPlayed: number,
): RoundOutcome | null {
  const decided = matchWinner(scoreA, scoreB, winsNeeded(bestOf));
  if (decided) return decided;
  if (roundsPlayed < roundCap(bestOf)) return null;
  if (scoreA === scoreB) return 'draw';
  return scoreA > scoreB ? 'a' : 'b';
}
