import { BEATS, MOVES, availableMoves, type DelayMap, type MarkEvent } from '@game/game';
import { getHelper } from '@game/helpers/roster';
import type { Move } from './api';

/**
 * A "what beats what" graph. Ten edges shared by both players, plus whatever a
 * loadout added for one of them — Chimera's `lizard → scissors` is the only one
 * today. Comes off `PlayerRules.beats`, so the board reads the same graph the
 * server scored the round on rather than a second copy of it.
 */
export type BeatsMap = Record<Move, readonly Move[]>;

/** The graph both players share, for every caller with no loadout in hand. */
export const SHARED_BEATS: BeatsMap = BEATS;

/**
 * Presentation helpers for the five moves. Pure -> easy to unit test.
 *
 * The emoji that used to live here are gone: every surface draws the move with
 * <MoveIcon> now, and an unused "fallback" field is one more thing to keep in
 * step with nothing.
 */
export const MOVE_META: Record<Move, { label: string }> = {
  rock: { label: 'Rock' },
  paper: { label: 'Paper' },
  scissors: { label: 'Scissors' },
  lizard: { label: 'Lizard' },
  robot: { label: 'Robot' },
};

export const ALL_MOVES: Move[] = ['rock', 'paper', 'scissors', 'lizard', 'robot'];

/**
 * Outcome is the winning seat key (or 'draw'). Compare against the viewer's
 * seat key to render a verdict.
 */
export function describeOutcome(outcome: string, mySeatKey: string): 'win' | 'loss' | 'draw' {
  if (outcome === 'draw') return 'draw';
  return outcome === mySeatKey ? 'win' : 'loss';
}

/** Round wins required to take the match (e.g. best of 5 → first to 3). */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Rounds a match may run before score alone settles it (mirrors the server's
 * `roundCap`). Draws score for neither player, so without this a match of
 * nothing but draws would never end.
 */
export function roundCap(bestOf: number): number {
  return bestOf * 2;
}

/** Spoken form of a cooldown, e.g. "on cooldown, 2 turns". */
export function cooldownPhrase(turns: number): string {
  return `on cooldown, ${turns} turn${turns === 1 ? '' : 's'}`;
}

/**
 * Winner-over-loser phrasing from the official RPSLR rules copy. Key order is
 * the order the README lists them in, and `beatsOf` relies on it.
 */
const BEAT_VERBS: Partial<Record<Move, Partial<Record<Move, string>>>> = {
  rock: { scissors: 'crushes', lizard: 'crushes' },
  paper: { rock: 'covers', robot: 'disproves' },
  scissors: { paper: 'cuts', lizard: 'decapitates' },
  lizard: { paper: 'eats', robot: 'poisons' },
  robot: { scissors: 'smashes', rock: 'vaporizes' },
};

/**
 * The moves `move` beats, in rules-copy order — the two shared ones first, then
 * anything a helper added.
 *
 * Ordered rather than merely collected, because the caption reads in this order
 * and the graph everyone learned in Phase 2 is the two shared edges. An added
 * edge arrives last, where it reads as an addition rather than as a rewrite.
 */
export function beatsOf(move: Move, beats: BeatsMap = SHARED_BEATS): Move[] {
  const shared = Object.keys(BEAT_VERBS[move] ?? {}) as Move[];
  const granted = beats[move] ?? [];
  return [
    ...shared.filter((m) => granted.includes(m)),
    ...granted.filter((m) => !shared.includes(m)),
  ];
}

/** The edges `beats` has that the shared graph does not — mirrors `isAddedEdge`. */
export function addedEdgesOf(beats: BeatsMap): Array<{ from: Move; to: Move }> {
  return ALL_MOVES.flatMap((from) =>
    (beats[from] ?? [])
      .filter((to) => !SHARED_BEATS[from].includes(to))
      .map((to) => ({ from, to })),
  );
}

/**
 * Preview caption for a move, e.g. "Rock crushes Scissors & Lizard" or
 * "Robot smashes Scissors & vaporizes Rock". A verb shared by targets is said
 * once, which is what makes Rock one clause rather than two.
 *
 * A Chimera owner previewing Lizard gets all three: "Lizard eats Paper, poisons
 * Robot & beats Scissors". The added edge takes the fallback verb rather than one
 * of its own, deliberately — `api/src/replayCard/moveVerbs.ts` phrases the same
 * pair the same way, and a card that said something else about the round the
 * board had just narrated would be worse than a plain word (JQ-151).
 */
export function describeBeatsOf(move: Move, beats: BeatsMap = SHARED_BEATS): string {
  const name = MOVE_META[move].label;
  // Consecutive targets sharing a verb collapse into one clause, in order, so
  // "crushes Scissors & Lizard" survives and nothing else is re-grouped.
  const clauses: string[] = [];
  let run: { verb: string; targets: Move[] } | null = null;
  for (const target of beatsOf(move, beats)) {
    const verb = beatVerb(move, target);
    if (run && run.verb === verb) run.targets.push(target);
    else {
      if (run) clauses.push(clauseFor(run));
      run = { verb, targets: [target] };
    }
  }
  if (run) clauses.push(clauseFor(run));
  return `${name} ${joinClauses(clauses)}`;
}

function clauseFor({ verb, targets }: { verb: string; targets: Move[] }): string {
  return `${verb} ${joinClauses(targets.map((t) => MOVE_META[t].label))}`;
}

/** "a", "a & b", "a, b & c" — the last join is always "&". */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

/**
 * The beats graph as text.
 *
 * The board draws the pentagon into an `aria-hidden` SVG, so this is the whole
 * graph for anyone who cannot see it: five lines carry all ten edges, and one
 * closing line names the attacks the opponent cannot make this round — the
 * faded arrows a sighted player reads straight off the board.
 */
export function describeBeatsGraph(
  oppDelays: Record<string, number>,
  /** The other player's name, when there is no "you" to be opposite. */
  oppName?: string,
  /** The two graphs, when a loadout has bent one of them. */
  graphs: { mine?: BeatsMap; theirs?: BeatsMap } = {},
): {
  edges: string[];
  /** The per-player edges, said out loud — empty in a duel. */
  added: string[];
  opponent: string;
} {
  // The ten shared edges, always, and always in the same words: they are what
  // Phase 2 taught, and a conditional graph must not make the shared part read
  // differently depending on who is holding what.
  const edges = ALL_MOVES.map((m) => describeBeatsOf(m));
  const them = oppName?.trim() || 'The opponent';
  // An extra edge is named as an extra rather than folded into the five lines
  // above, and both sides are named — the opponent has to be able to hear the
  // rule they are playing against, not just the one they hold (JQ-151).
  const added = [
    ...addedEdgesOf(graphs.mine ?? SHARED_BEATS).map(
      ({ from, to }) =>
        `Your ${MOVE_META[from].label} also beats ${MOVE_META[to].label} this match`,
    ),
    ...addedEdgesOf(graphs.theirs ?? SHARED_BEATS).map(
      ({ from, to }) =>
        `${them === 'The opponent' ? 'Their' : `${them}'s`} ${MOVE_META[from].label} also beats ${
          MOVE_META[to].label
        } this match`,
    ),
  ];
  // Not "carries marks" — "cannot be played". The floor means a fully-marked
  // opponent still has their least-marked moves, and saying otherwise hands
  // the player a false all-clear (JQ-215).
  const off = ALL_MOVES.filter((m) => !isPlayable(m, oppDelays)).map((m) => MOVE_META[m].label);
  if (off.length === 0) {
    return {
      edges,
      added,
      opponent: `${them} can play every move this round, so every arrow is live.`,
    };
  }
  const list =
    off.length === 1 ? off[0] : `${off.slice(0, -1).join(', ')} or ${off[off.length - 1]}`;
  return {
    edges,
    added,
    opponent: `${them} can't play ${list} this round, so those attacks are drawn faded.`,
  };
}

/**
 * What can beat `move` this round. `all` is the two moves that beat it; `live`
 * drops the ones the opponent has on cooldown, so `safe` means the move cannot
 * lose. This is the same read a familiar player makes off the pentagon — a node
 * with no solid incoming arrows — so the picker draws arrows from it.
 */
export function threatsTo(
  move: Move,
  oppDelays: Record<string, number>,
  /**
   * The opponent's graph, when a loadout has bent it. Theirs and not yours: this
   * asks what can beat *you*, and Chimera's owner is the one whose Lizard does
   * it. Reading your own graph here would tell a Chimera holder their Scissors
   * was safe from a Lizard it is not safe from (JQ-151).
   */
  oppBeats: BeatsMap = SHARED_BEATS,
): { all: Move[]; live: Move[]; safe: boolean } {
  const all = ALL_MOVES.filter((m) => beatsOf(m, oppBeats).includes(move));
  const live = all.filter((m) => isPlayable(m, oppDelays));
  return { all, live, safe: live.length === 0 };
}

/** The pentagon edge a round was won on, and whose win it was. */
export interface WinningEdge {
  from: Move;
  to: Move;
  role: 'you' | 'opp';
  /** True when a helper granted this edge, so the graph lights the curve it drew. */
  added: boolean;
}

/**
 * The single arrow that decided a round, so the reveal can light it on the
 * graph. The edge belongs to the graph — `from` always beats `to` — and only
 * `role` depends on who played it. A mirror match has no edge.
 */
export function winningEdgeOf(
  myMove: Move,
  oppMove: Move,
  graphs: { mine?: BeatsMap; theirs?: BeatsMap } = {},
): WinningEdge | null {
  const mine = graphs.mine ?? SHARED_BEATS;
  const theirs = graphs.theirs ?? SHARED_BEATS;
  if (myMove === oppMove) return null;
  // Same order as the engine's `seatWinner`, and for the same reason: an added
  // edge outranks a shared one, so a Chimera Lizard against Scissors lights the
  // curve rather than the arrow pointing the other way. Reading each side through
  // only its own graph would light both.
  const added = (beats: BeatsMap, from: Move, to: Move) =>
    beats[from].includes(to) && !SHARED_BEATS[from].includes(to);
  if (added(mine, myMove, oppMove)) return { from: myMove, to: oppMove, role: 'you', added: true };
  if (added(theirs, oppMove, myMove)) return { from: oppMove, to: myMove, role: 'opp', added: true };
  if (SHARED_BEATS[myMove].includes(oppMove)) {
    return { from: myMove, to: oppMove, role: 'you', added: false };
  }
  if (SHARED_BEATS[oppMove].includes(myMove)) {
    return { from: oppMove, to: myMove, role: 'opp', added: false };
  }
  return null;
}

/**
 * Why one of your moves is unavailable. Read off your own last two picks rather
 * than inferred from the mark count, so it stays true whatever a loadout charges
 * for a pick. `recent` is most-recent-first.
 *
 * The opening is the one cause that has to be *checked* rather than assumed. It
 * used to be the fallback — in a duel, a move you have not just played and cannot
 * play is Lizard or Robot still coming free. Helpers give it rivals: Rust,
 * Quarantine, Grudge and Freeze all put marks on moves their owner never touched,
 * and a loadout that binds neither Lizard nor Robot has no opening lock to blame
 * in the first place. So the opening is named only where the opening marks could
 * still be there — `openingDelays[move]` of them, one coming off per round played
 * — and otherwise the honest answer is that the move is down, without a story
 * about why (JQ-207).
 */
export function cooldownCause(move: Move, recent: Move[], openingDelays: DelayMap): string {
  const name = MOVE_META[move].label;
  if (recent[0] === move) return `You played ${name} last round`;
  if (recent[1] === move) return `You played ${name} two rounds ago`;
  if (openingDelays[move] > recent.length) return `${name} starts the match on cooldown`;
  return `${name} is on cooldown`;
}

/**
 * Why one of your moves is down, in a match where it may not be your fault.
 *
 * `cooldownCause` above reads your own last two picks, which is the whole story in
 * `duel` and a lie in `duel-helpers`: Quarantine, Tripwire and Rust put marks on
 * moves you never touched, Thief moves one across the table, and Feint puts this
 * round's cost somewhere you did not play. "You played Rock last round" printed
 * over any of those is confidently wrong, which is worse than saying nothing.
 *
 * So this reads the ledger the engine writes instead — the last thing that *added*
 * marks to this move on your board, and the card that did it. Removals are skipped:
 * Flywheel taking a mark off is not why the move is still down. With no ledger, or
 * none touching this move, it falls back to the duel wording, which is what a duel
 * still gets (JQ-151).
 */
export function cooldownReason(
  move: Move,
  recent: Move[],
  openingDelays: DelayMap,
  /** This seat's own mark events, oldest first. Empty in a duel. */
  ledger: readonly MarkEvent[] = [],
): string {
  const name = MOVE_META[move].label;
  const last = [...ledger].reverse().find((e) => e.move === move && e.amount > 0);
  if (!last) return cooldownCause(move, recent, openingDelays);
  switch (last.cause.kind) {
    case 'choice':
      // The ledger knows which round, so this no longer depends on `recent`
      // holding exactly the last two picks.
      return cooldownCause(move, recent, openingDelays);
    case 'opening':
      return `${name} starts the match on cooldown`;
    case 'helper': {
      const helper = getHelper(last.cause.helperId);
      const card = helper?.name ?? 'A helper';
      const marks = `${last.amount} mark${last.amount === 1 ? '' : 's'}`;
      // Named on both sides, but the opponent's is the one that had no way of
      // being guessed: it is the only cause the player did not choose and cannot
      // read off the history strip.
      return last.cause.mine
        ? `Your ${card} put ${marks} on ${name}`
        : `Their ${card} put ${marks} on ${name}`;
    }
    default:
      return `${name} is on cooldown`;
  }
}

/**
 * When the move comes back, or how far down it is when that cannot be promised.
 *
 * Marks come off one a round, so "back in 2 turns" is a safe thing to say — until
 * Freeze, which stops the decrement for a round and makes the promise wrong the
 * moment it lands. Loadouts are public, so whether that is even possible is
 * knowable: against an opponent holding Freeze the sentence stops counting turns
 * and states the marks instead, which is true either way (JQ-151).
 */
export function backInPhrase(turns: number, oppCanFreeze = false): string {
  if (oppCanFreeze) return `${turns} mark${turns === 1 ? '' : 's'} to clear`;
  return `back in ${turns} turn${turns === 1 ? '' : 's'}`;
}

/** Whether anything in this loadout can stop marks coming off. */
export function holdsFreeze(loadout: readonly string[] | null): boolean {
  return (loadout ?? []).includes('freeze');
}

/** Spoken form of an opponent cooldown, for the preview caption. */
export function opponentCooldownPhrase(move: Move, turns: number): string {
  return `Opponent can't play ${MOVE_META[move].label} for ${turns} turn${turns === 1 ? '' : 's'}`;
}

/**
 * The verb one move does to another, e.g. `robot` over `rock` is "vaporizes".
 * "beats" for a pair with no edge between them, so callers can always build a
 * sentence. Exported because the replay commentary names an attack that never
 * happened — the move a cooldown kept off the board — and there is no winner
 * and loser to hand to `describeBeat` for one of those.
 */
export function beatVerb(winner: Move, loser: Move): string {
  return BEAT_VERBS[winner]?.[loser] ?? 'beats';
}

/** e.g. "Paper disproves Robot" */
export function describeBeat(winner: Move, loser: Move): string {
  return `${MOVE_META[winner].label} ${beatVerb(winner, loser)} ${MOVE_META[loser].label}`;
}

/** Narration for a resolved round's two picks. */
export function describeRoundMatchup(myMove: Move, oppMove: Move): string {
  if (myMove === oppMove) {
    return `${MOVE_META[myMove].label} vs ${MOVE_META[oppMove].label} — same pick, no winner`;
  }
  const iWin = BEAT_VERBS[myMove]?.[oppMove] != null;
  return describeBeat(iWin ? myMove : oppMove, iWin ? oppMove : myMove);
}

export function opponentMoveFromResult(
  moves: Record<string, Move>,
  myPlayerId: string,
): { myMove?: Move; oppMove?: Move } {
  const myMove = moves[myPlayerId];
  const oppId = Object.keys(moves).find((id) => id !== myPlayerId);
  const oppMove = oppId ? moves[oppId] : undefined;
  return { myMove, oppMove };
}

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
