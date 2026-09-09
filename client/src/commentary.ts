import type { Move } from './api';
import {
  ALL_MOVES,
  MOVE_META,
  beatVerb,
  beatsOf,
  describeBeat,
  isPlayable,
  threatsTo,
  winsNeeded,
} from './moves';
import { INITIAL_DELAYS } from '@game/game';
import { type DelayMap, type Replay, type ReplayFrame, type ReplaySide } from './replay';
import { roundEdge, roundValue } from './roundValue';

/**
 * What a replay says out loud.
 *
 * A watcher who has never played RPSLR gets the board, the pentagon and a
 * reveal card — all of which assume the rules. This module is the other half:
 * a sentence per round saying what happened, a note when the cooldown state
 * made a pick interesting, and the rules themselves the first time each one
 * actually decides something on screen.
 *
 * Every function here is pure and takes only what `buildReplay` already
 * derived, so the copy can be rewritten in a Content pass without touching a
 * component — which it will be: these strings are a first draft.
 *
 * Tone is neutral and explanatory rather than sportscaster (JQ-121's open
 * question). A watcher reading this is being taught, not entertained, and the
 * game's own vocabulary — "covers", "vaporizes", "on cooldown" — is the thing
 * they are meant to leave with.
 */

/** The clause break the game's copy uses everywhere else. */
const EM = '—';

/** En dash in a scoreline, matching the one the header already draws. */
const EN = '–';

function label(move: Move): string {
  return MOVE_META[move].label;
}

/**
 * The scoreline after a round, from the point of view of nobody.
 *
 * A match that ended without anyone reaching the target — a forfeit, an
 * abandoned match — leaves a leader rather than a winner, so reaching the
 * target is what "wins the match" is keyed on, not being the last frame.
 */
function scoreLine(frame: ReplayFrame, replay: Replay): string {
  const { a, b } = { a: frame.a.score, b: frame.b.score };
  if (a === b) return a === 0 ? 'No score yet.' : `Level at ${a}${EN}${b}.`;
  const aLeads = a > b;
  const name = aLeads ? replay.a.identity.name : replay.b.identity.name;
  const [hi, lo] = aLeads ? [a, b] : [b, a];
  if (hi >= winsNeeded(replay.bestOf)) return `${name} wins the match ${hi}${EN}${lo}.`;
  return `${name} leads ${hi}${EN}${lo}.`;
}

/**
 * One round as a sentence: what each player played, which edge of the
 * pentagon settled it, and where that leaves the match.
 */
export function narrateRound(frame: ReplayFrame, replay: Replay): string {
  const nameA = replay.a.identity.name;
  const nameB = replay.b.identity.name;
  const score = scoreLine(frame, replay);

  // Only a move can draw with itself, so a drawn round is always a mirror —
  // and reads better said once than as two identical halves.
  if (frame.outcome === 'draw') {
    return `Both play ${label(frame.a.move)} ${EM} no winner. ${score}`;
  }

  const aWon = frame.outcome === frame.a.seatKey;
  const [winner, loser] = aWon ? [frame.a.move, frame.b.move] : [frame.b.move, frame.a.move];
  return (
    `${nameA} plays ${label(frame.a.move)}, ${nameB} plays ${label(frame.b.move)} ` +
    `${EM} ${describeBeat(winner, loser)}. ${score}`
  );
}

export type CalloutKind =
  | 'opening'
  | 'safe-pick'
  | 'safe-mirror-locked'
  | 'punish'
  | 'safe-unplayed'
  | 'safe-out-of-reach'
  | 'trap'
  | 'round-edge'
  | 'tempo-gap'
  | 'tempo-return'
  | 'tempo-punish-spent'
  | 'cooldown'
  | 'match-point';

export interface Callout {
  /** Stable across copy changes, so components and tests key on it. */
  kind: CalloutKind;
  text: string;
}

/**
 * The mirror of a safe pick: a move with nothing left to beat.
 *
 * A move beats exactly two others and the opponent always rests exactly two,
 * so when those are the same pair the pick cannot win. The opponent still
 * holds the move itself, which is why a draw is on the table and losing is the
 * only other way out.
 */
function trapText(mover: string, blocked: string, move: Move): string {
  const [x, y] = beatsOf(move);
  return (
    `${label(move)} only beats ${label(x)} and ${label(y)}, and ${blocked} had both ` +
    `on cooldown ${EM} the best ${mover} could get from it was a draw.`
  );
}

/**
 * The cooldown rule keeps both sides at exactly three playable moves every
 * round of every match — the opening locks and the -1/+2 rule work out that
 * way with no exceptions. It is the fact the whole strategy layer rests on,
 * and none of the notes below would mean anything without it.
 */
function liveMoves(delays: DelayMap): Move[] {
  return ALL_MOVES.filter((m) => delays[m] === 0);
}

/**
 * The safe move, and what it is actually worth.
 *
 * A move is safe when both moves that beat it are resting for the opponent.
 * The opponent always rests exactly two, and no two moves share an attacking
 * pair, so a side never has more than one safe move — `safeMoves[0]` is the
 * whole of it.
 *
 * What it is worth is the part that is easy to get wrong, and the reason this
 * returns more than a move. A safe move cannot lose, but the opponent can see
 * it too, and their answer is to play the same move back for the draw — so the
 * safe move on its own is worth nothing at all. It is worth something only
 * when its owner also holds one of the two moves that beat it, which are
 * exactly the two the opponent is resting. Then the mirror can be punished,
 * the opponent cannot safely play it, and the round is worth a third of a win
 * to the safe side — the largest edge this game ever offers. Solved over every
 * position the game can reach: see `roundValue.test.ts`.
 *
 * `threatsTo` does the work twice over. Against the opponent's cooldowns it
 * says which move is safe; against this player's own it says which of that
 * move's attackers are still in hand, which is the punish.
 */
interface SafeRead {
  move: Move;
  /** In hand this round, rather than resting. */
  reachable: boolean;
  /** Live moves that beat `move` — the answer to the opponent's mirror. */
  punish: Move[];
}

function safeRead(side: ReplaySide): SafeRead | null {
  const move = side.safeMoves[0];
  if (move === undefined) return null;
  return {
    move,
    reachable: side.delaysBefore[move] === 0,
    punish: threatsTo(move, side.delaysBefore).live,
  };
}

/** "Rock crushes Lizard and Scissors decapitates it" — why a move is safe. */
function whySafe(move: Move, oppDelays: DelayMap): string {
  const [x, y] = threatsTo(move, oppDelays).all;
  return `${describeBeat(x, move)} and ${label(y)} ${beatVerb(y, move)} it`;
}

/**
 * What both players are holding going into the next round.
 *
 * None of this is a guess. A pick costs its owner that move for two rounds, so
 * the moment this round's picks land, both hands for the next round are fixed
 * — and each side holds exactly three playable moves there, same as every
 * other round. "What will I be holding next round" is small and exactly
 * computable, which is the whole reason a tempo note can be stated as fact.
 *
 * Read off the boards `buildReplay` already reconstructed rather than advanced
 * here: what a pick costs is the loadout's business, not this file's, and a
 * second opinion about it would be a second rules engine (JQ-207).
 *
 * One round, and no further. Two rounds would need a search over what gets
 * played in between, and a replay says what was true, not what might have been.
 */
export interface Lookahead {
  /** The round these hands are held into. */
  round: number;
  a: DelayMap;
  b: DelayMap;
  /** What that round is worth to A under best play — `roundValue`, projected. */
  value: number;
}

export function lookahead(frame: ReplayFrame): Lookahead {
  const { delaysAfter: a } = frame.a;
  const { delaysAfter: b } = frame.b;
  return {
    round: frame.round + 1,
    a,
    b,
    value: roundValue(liveMoves(a), liveMoves(b)),
  };
}

/**
 * The one move the opponent can play next round that this player holds no
 * answer to, or null when they can answer everything.
 *
 * There is never more than one. A move is unanswerable exactly when both moves
 * that beat it are resting, every side rests exactly two, and no two moves
 * share an attacking pair — so at most one move in the whole set qualifies,
 * and it only counts if the opponent can actually play it.
 */
function unanswerable(mine: DelayMap, theirs: DelayMap): Move | null {
  return liveMoves(theirs).find((m) => threatsTo(m, mine).safe) ?? null;
}

/** What the round did for the side that played it, as a verb phrase. */
function outcomePhrase(frame: ReplayFrame, side: ReplaySide): string {
  if (frame.outcome === 'draw') return 'draws the round';
  return frame.outcome === side.seatKey ? 'takes the round' : 'loses the round';
}

/**
 * The round a move played this round can be played again.
 *
 * Counted from the marks the move actually came out of the round holding, not
 * from a fixed price: Tempered, Featherweight, Copycat and Bookend all change
 * what a pick costs its owner, and the two players can pay differently for the
 * same move in the same round. Said as a round number rather than a duration —
 * a round number can be checked against the strip, where "out for 2 rounds"
 * has to be counted.
 *
 * A projection, and only ever one round deep in practice: a later Rust or
 * Quarantine could still put the move back down. It says when the move is next
 * free if nothing else touches it, which is what a watcher reads off the board.
 */
function returnsInRound(round: number, side: ReplaySide): number {
  return round + side.delaysAfter[side.move] + 1;
}

/**
 * How many strategy notes a round is allowed before they bury the board. The
 * cooldown line and match point are not counted against it — they are the
 * round's bookkeeping and always survive.
 */
const MAX_INSIGHTS = 2;

/**
 * The strategy notes a round supports — never a guess, always something the
 * frame can be checked against.
 *
 * These all read the round's outcome, so the page must hold them back until
 * the reveal card has landed; see `ReplayCommentary`.
 */
export function calloutsFor(frame: ReplayFrame, replay: Replay): Callout[] {
  const nameA = replay.a.identity.name;
  const nameB = replay.b.identity.name;
  // A lookahead into a round the match never reached would name a round nobody
  // can check it against, so the last frame of a replay gets no tempo notes.
  const lastRound = replay.frames[replay.frames.length - 1]?.round ?? frame.round;
  const hasNextRound = frame.round < lastRound;
  const ahead = lookahead(frame);
  const sides = [
    {
      side: frame.a,
      opp: frame.b,
      oppDelays: frame.b.delaysBefore,
      mine: ahead.a,
      theirs: ahead.b,
      // The projected round's value always reads from A; B's share of it is
      // the same number the other way round.
      value: ahead.value,
      mover: nameA,
      blocked: nameB,
    },
    {
      side: frame.b,
      opp: frame.a,
      oppDelays: frame.a.delaysBefore,
      mine: ahead.b,
      theirs: ahead.a,
      value: -ahead.value,
      mover: nameB,
      blocked: nameA,
    },
  ];

  // Tiered rather than one list: the note about how a round was won beats the
  // note about what it costs next round, which in turn beats the note about
  // what was merely available — whichever player each belongs to.
  const played: Callout[] = [];
  const tempo: Callout[] = [];
  const missed: Callout[] = [];
  const traps: Callout[] = [];

  for (const { side, opp, oppDelays, mine, theirs, value, mover, blocked } of sides) {
    const read = safeRead(side);
    if (read) {
      const { move: safe, reachable, punish } = read;
      const safeName = label(safe);
      if (!reachable) {
        missed.push({
          kind: 'safe-out-of-reach',
          text: `${safeName} was the one move ${blocked} had no answer to, and it was resting for ${mover}.`,
        });
      } else if (side.move === safe && punish.length > 0) {
        played.push({
          kind: 'safe-pick',
          text:
            `${whySafe(safe, oppDelays)}, but ${blocked} had both resting ${EM} nothing ` +
            `could beat ${mover}'s ${safeName}. The only answer left was ${safeName} back ` +
            `for the draw, and ${mover} still held ${label(punish[0])}, which beats that: ` +
            `the strongest edge this game offers.`,
        });
      } else if (side.move === safe) {
        played.push({
          kind: 'safe-mirror-locked',
          text:
            `Nothing ${blocked} could play beat ${mover}'s ${safeName} ${EM} but ${safeName} ` +
            `back draws it, and ${mover} had nothing that beats ${safeName}. Played right, ` +
            `this round was a draw either way.`,
        });
      } else if (punish.includes(side.move)) {
        played.push({
          kind: 'punish',
          text:
            `${safeName} was the one move ${blocked} could not beat, so ${safeName} is what ` +
            `they had to expect ${EM} and ${mover} played ${label(side.move)}, which beats it.`,
        });
      } else {
        missed.push({
          kind: 'safe-unplayed',
          text:
            `Nothing ${blocked} could play beat ${safeName}, and ${mover} had it in hand ` +
            `${EM} the pick was ${label(side.move)}.`,
        });
      }
    }

    // "Nothing they could play beat it" — so it has to be playability, not
    // marks. Under the floor a fully-marked opponent still holds their
    // least-marked moves, and this line would otherwise state as fact
    // something the round disproves (JQ-215).
    if (beatsOf(side.move).every((m) => !isPlayable(m, oppDelays))) {
      traps.push({ kind: 'trap', text: trapText(mover, blocked, side.move) });
    }

    // Tempo: what this pick costs in the round after this one. Everything
    // below is read off the projected hands and the projected round's value,
    // never guessed at.
    //
    // The gate is `value`, not merely "the opponent will hold something I
    // cannot beat". That second thing is true of about half of all rounds,
    // because half of all positions leave somebody a safe move — and a safe
    // move on its own is worth nothing at all, since the mirror draws it. It
    // is worth something only when its owner also holds one of the two moves
    // that beat it, and asking the solver whether the projected round actually
    // favours them is the honest way to tell those two apart. So the note
    // fires on the rounds where the gap costs something and stays quiet on the
    // rounds where it is scenery.
    const gap = hasNextRound && value < 0 ? unanswerable(mine, theirs) : null;
    if (gap && opp.delaysBefore[gap] > 0 && theirs[gap] === 0) {
      // The opponent's clock is what changed: a move they could not play comes
      // back, and this player will be holding nothing that answers it.
      tempo.push({
        kind: 'tempo-return',
        text:
          `${blocked}'s ${label(gap)} is back in round ${ahead.round} ${EM} and ${mover} ` +
          `will be holding nothing that beats it.`,
      });
    } else if (gap && beatsOf(side.move).includes(gap)) {
      // This player's own clock is what changed: the move just spent was one
      // of the two that answered `gap`, and the other is resting too.
      tempo.push({
        kind: 'tempo-gap',
        text:
          `${mover}'s ${label(side.move)} ${outcomePhrase(frame, side)} ${EM} and leaves ` +
          `them with nothing that beats ${label(gap)} in round ${ahead.round}.`,
      });
    }

    // Spending the punish is the cost that decides whether a round was worth
    // taking. A safe move is worth a third of a win only while its owner still
    // holds one of the two moves that beat it — the answer to the mirror — so
    // playing that move banks the edge and hands it back at the same time.
    if (hasNextRound && read?.reachable && read.punish.includes(side.move) && value <= 0) {
      tempo.push({
        kind: 'tempo-punish-spent',
        text:
          `${label(side.move)} was ${mover}'s answer to ${label(read.move)} ${EM} spending ` +
          (roundEdge(value) === 'even'
            ? `it leaves round ${ahead.round} an even one.`
            : `it leaves round ${ahead.round} ${blocked}'s under best play.`),
      });
    }
  }

  const insights: Callout[] = [];

  // Neither side has played, so the only locked moves are the two that start
  // that way: the opening round is the game everybody already knows.
  if (frame.a.recentMoves.length === 0 && frame.b.recentMoves.length === 0) {
    const open = liveMoves(frame.a.delaysBefore).map(label);
    insights.push({
      kind: 'opening',
      text:
        `Nothing has been played yet, so both open with the same three: ` +
        `${open.slice(0, -1).join(', ')} and ${open[open.length - 1]}. ` +
        `Lizard and Robot are still locked.`,
    });
  }

  insights.push(...played, ...tempo, ...traps, ...missed);

  // Only when nothing more specific applied. These are the rounds that most
  // look like guesswork from outside, and the ones where saying whether the
  // position was even is worth more than saying nothing.
  if (insights.length === 0) {
    const value = roundValue(
      liveMoves(frame.a.delaysBefore),
      liveMoves(frame.b.delaysBefore),
    );
    const ahead = value > 0 ? nameA : nameB;
    const edge = roundEdge(value);
    insights.push({
      kind: 'round-edge',
      text:
        edge === 'even'
          ? 'Neither side had an edge going in — played perfectly, this round was a coin flip.'
          : edge === 'slight'
            ? `Going in, ${ahead} had a slight edge under best play.`
            : `Going in, this round was ${ahead}'s under best play.`,
    });
  }

  const always: Callout[] = [];

  // Named by the round it comes back rather than by a duration, so it can be
  // read straight off the strip. A rest that outlasts the match has no round
  // to name, so it says that instead of pointing at a round nobody will see.
  const backA = returnsInRound(frame.round, frame.a);
  const backB = returnsInRound(frame.round, frame.b);

  if (frame.outcome === 'draw') {
    // A mirror normally costs both players the same, so one sentence covers it.
    // A loadout can price it differently on each side — Copycat and Echo Chamber
    // both discount a draw — and then "back for both" is simply not true.
    const move = label(frame.a.move);
    const whenBack = (back: number) =>
      back > lastRound ? 'not again this match' : `in round ${back}`;
    always.push({
      kind: 'cooldown',
      text:
        backA > lastRound && backB > lastRound
          ? `Neither plays ${move} again this match.`
          : backA === backB
            ? `${move} is back for both in round ${backA}.`
            : `${nameA}'s ${move} is back ${whenBack(backA)}, ${nameB}'s ${whenBack(backB)}.`,
    });
  } else {
    const aWon = frame.outcome === frame.a.seatKey;
    const winner = aWon ? frame.a : frame.b;
    const name = aWon ? nameA : nameB;
    const back = aWon ? backA : backB;
    always.push({
      kind: 'cooldown',
      text:
        back > lastRound
          ? `${name}'s ${label(winner.move)} is out for the rest of the match.`
          : `${name}'s ${label(winner.move)} is back in round ${back}.`,
    });
  }

  const needed = winsNeeded(replay.bestOf);
  const { score: sa } = frame.a;
  const { score: sb } = frame.b;
  const decided = Math.max(sa, sb) >= needed;
  if (!decided && Math.max(sa, sb) === needed - 1) {
    const both = sa === sb;
    const name = sa > sb ? nameA : nameB;
    always.push({
      kind: 'match-point',
      text: both ? 'Match point for both players.' : `Match point for ${name}.`,
    });
  }

  return [...insights.slice(0, MAX_INSIGHTS), ...always];
}

export type RuleCardId = 'three' | 'cooldown' | 'unlock' | 'safe';

export interface RuleCard {
  title: string;
  body: string;
}

/**
 * The three rules a watcher has to be told, because the board shows them
 * rather than saying them. Copy is the ticket's, verbatim — the "you" in the
 * cooldown card is whoever is playing, not the watcher, and is the one place
 * a replay uses the word.
 */
export const RULE_CARDS: Record<RuleCardId, RuleCard> = {
  three: {
    title: 'Three moves each',
    body:
      'Every round each player has exactly three moves they can play — never more, ' +
      'never fewer. Which three is the whole game.',
  },
  cooldown: {
    title: 'Cooldowns',
    body: 'Every move you play goes on cooldown for 2 rounds',
  },
  unlock: {
    title: 'Locked at the start',
    body: 'Lizard and Robot start locked and unlock as the match goes on',
  },
  safe: {
    title: 'Safe picks',
    body:
      'Watch the arrows: a move nothing can beat right now is a safe pick. No move ever ' +
      "beats all three of an opponent's options, so that is as good as a round gets.",
  },
};

/** A move the player has already thrown is resting because they threw it. */
function hasRestingPick(side: ReplaySide): boolean {
  return side.recentMoves.some((m) => side.delaysBefore[m] > 0);
}

/**
 * Lizard and Robot, read off the engine's own opening rather than listed here.
 * Only ever asked of a duel — the card that uses it names these two by name, so
 * it is withheld from a match whose loadouts moved them.
 */
const DUEL_STARTS_LOCKED: Move[] = ALL_MOVES.filter((m) => INITIAL_DELAYS[m] > 0);

/**
 * A move that started the match locked and has come free without being
 * played — the opening lock lifting, rather than a cooldown expiring.
 */
function hasFreshUnlock(side: ReplaySide): boolean {
  return DUEL_STARTS_LOCKED.some(
    (m) => side.delaysBefore[m] === 0 && !side.recentMoves.includes(m),
  );
}

const RULE_ORDER: RuleCardId[] = ['three', 'cooldown', 'unlock', 'safe'];

/**
 * Rules whose copy states a duel's numbers outright — a pick costing 2 rounds,
 * Lizard and Robot being the locked pair. Both are things a loadout changes, and
 * writing helper-aware rule copy is a content pass of its own (JQ-207 is about
 * not being wrong, not about saying more). So at a helpers match they are simply
 * not offered, and the rules that read the board instead still are.
 */
const DUEL_ONLY_RULES: RuleCardId[] = ['cooldown', 'unlock'];

const RULE_APPLIES: Record<RuleCardId, (frame: ReplayFrame) => boolean> = {
  // Always true, which is exactly why it is worth saying — and it gives round
  // one, which demonstrates none of the other rules, a rule of its own.
  three: () => true,
  cooldown: (f) => hasRestingPick(f.a) || hasRestingPick(f.b),
  unlock: (f) => hasFreshUnlock(f.a) || hasFreshUnlock(f.b),
  safe: (f) => f.a.safeMoves.length > 0 || f.b.safeMoves.length > 0,
};

/**
 * Which rule card, if any, belongs to each round — one entry per frame.
 *
 * A rule is explained the first round it is actually visible on the board,
 * which is the only moment it means anything; a rule a replay never reaches
 * is never explained. Two rules coming true on the same round would stack two
 * cards over the board, so the second waits for the next round it still holds
 * on. Round one is always bare: nothing has been played into it yet, so its
 * only locked moves are the opening ones, which is the *unlock* rule's
 * business rather than the cooldown rule's.
 */
export function ruleCardSchedule(replay: Replay): (RuleCardId | null)[] {
  const left = new Set(
    replay.hasLoadouts ? RULE_ORDER.filter((r) => !DUEL_ONLY_RULES.includes(r)) : RULE_ORDER,
  );
  return replay.frames.map((frame) => {
    const id = RULE_ORDER.find((r) => left.has(r) && RULE_APPLIES[r](frame));
    if (!id) return null;
    left.delete(id);
    return id;
  });
}
