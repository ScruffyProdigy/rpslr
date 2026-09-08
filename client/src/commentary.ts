import type { Move } from './api';
import {
  ALL_MOVES,
  MOVE_META,
  beatVerb,
  beatsOf,
  describeBeat,
  threatsTo,
  winsNeeded,
} from './moves';
import {
  DELAY_ON_CHOICE,
  type DelayMap,
  type Replay,
  type ReplayFrame,
  type ReplaySide,
} from './replay';

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
  | 'trap'
  | 'safe-out-of-reach'
  | 'cooldown'
  | 'match-point';

export interface Callout {
  /** Stable across copy changes, so components and tests key on it. */
  kind: CalloutKind;
  text: string;
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
 * Why a move could not lose: both of the moves that beat it were resting.
 *
 * Every move is beaten by exactly two others, so a move in `safeMoves` always
 * has exactly two attackers to name — and naming them with their verbs is the
 * whole lesson, because those are the two faded arrows on the board.
 *
 * The shape of the round is fixed too, and saying so is the point. A safe move
 * exists only when the opponent's two resting moves are exactly its two
 * attackers, which leaves them holding the move itself and the two it beats —
 * so a safe pick always wins two of their three options and draws the third.
 * It is the strongest a position ever gets here: nothing beats all three, ever,
 * because a move beats two and they always hold three.
 */
function safePickText(
  mover: string,
  blocked: string,
  side: ReplaySide,
  oppDelays: DelayMap,
): string {
  const [x, y] = threatsTo(side.move, oppDelays).all;
  return (
    `${describeBeat(x, side.move)} and ${label(y)} ${beatVerb(y, side.move)} it, ` +
    `but ${blocked} had both on cooldown ${EM} ` +
    `nothing could beat ${mover}'s ${label(side.move)}. A safe pick: two of ` +
    `${blocked}'s three options lose to it, and the third is the same move.`
  );
}

/**
 * The mirror of a safe pick: a move with nothing left to beat.
 *
 * A move beats exactly two others and the opponent always has exactly two
 * resting, so when those are the same pair the pick cannot win. The opponent
 * still holds the move itself, which is why a draw is on the table and losing
 * is the only other way out.
 */
function trapText(mover: string, blocked: string, move: Move): string {
  const [x, y] = beatsOf(move);
  return (
    `${label(move)} only beats ${label(x)} and ${label(y)}, and ${blocked} had both ` +
    `on cooldown ${EM} the best ${mover} could get from it was a draw.`
  );
}

/**
 * A safe move existed and its owner could not play it.
 *
 * Half of all rounds have a safe move somewhere; it is playable by the side it
 * would help only about three rounds in ten. Most of the rest is this — the
 * move nothing could answer, resting.
 */
function outOfReachText(mover: string, blocked: string, move: Move): string {
  return (
    `${label(move)} was the one move ${blocked} had no answer to, ` +
    `and it was resting for ${mover}.`
  );
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
  const sides = [
    { side: frame.a, oppDelays: frame.b.delaysBefore, mover: nameA, blocked: nameB },
    { side: frame.b, oppDelays: frame.a.delaysBefore, mover: nameB, blocked: nameA },
  ];

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

  // A safe move cannot lose, so only the winner of a round — or either player
  // in a mirror — can have played one. Checked per side rather than assumed,
  // because in a mirror the two sides face different cooldowns.
  for (const { side, oppDelays, mover, blocked } of sides) {
    if (side.safeMoves.includes(side.move)) {
      insights.push({ kind: 'safe-pick', text: safePickText(mover, blocked, side, oppDelays) });
    }
  }

  for (const { side, oppDelays, mover, blocked } of sides) {
    if (beatsOf(side.move).every((m) => oppDelays[m] > 0)) {
      insights.push({ kind: 'trap', text: trapText(mover, blocked, side.move) });
    }
  }

  // At most one move is ever safe for a side in a round — no two moves share an
  // attacking pair — so `safeMoves[0]` is the whole of it.
  for (const { side, mover, blocked } of sides) {
    const safe = side.safeMoves[0];
    if (safe !== undefined && side.delaysBefore[safe] > 0) {
      insights.push({ kind: 'safe-out-of-reach', text: outOfReachText(mover, blocked, safe) });
    }
  }

  const always: Callout[] = [];

  if (frame.outcome === 'draw') {
    always.push({
      kind: 'cooldown',
      text: `Neither can play ${label(frame.a.move)} for the next ${DELAY_ON_CHOICE} rounds.`,
    });
  } else {
    const aWon = frame.outcome === frame.a.seatKey;
    const winner = aWon ? frame.a : frame.b;
    const name = aWon ? nameA : nameB;
    always.push({
      kind: 'cooldown',
      text: `${name}'s ${label(winner.move)} is now out for ${DELAY_ON_CHOICE} rounds.`,
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

/** Moves that begin a match locked — `INITIAL_DELAYS` in `replay.ts`. */
const STARTS_LOCKED: Move[] = ['lizard', 'robot'];

/** A move the player has already thrown is resting because they threw it. */
function hasRestingPick(side: ReplaySide): boolean {
  return side.recentMoves.some((m) => side.delaysBefore[m] > 0);
}

/**
 * A move that started the match locked and has come free without being
 * played — the opening lock lifting, rather than a cooldown expiring.
 */
function hasFreshUnlock(side: ReplaySide): boolean {
  return STARTS_LOCKED.some((m) => side.delaysBefore[m] === 0 && !side.recentMoves.includes(m));
}

const RULE_ORDER: RuleCardId[] = ['three', 'cooldown', 'unlock', 'safe'];

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
export function ruleCardSchedule(frames: ReplayFrame[]): (RuleCardId | null)[] {
  const left = new Set(RULE_ORDER);
  return frames.map((frame) => {
    const id = RULE_ORDER.find((r) => left.has(r) && RULE_APPLIES[r](frame));
    if (!id) return null;
    left.delete(id);
    return id;
  });
}
