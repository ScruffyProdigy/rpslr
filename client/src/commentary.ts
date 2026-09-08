import type { Move } from './api';
import { MOVE_META, beatVerb, describeBeat, threatsTo, winsNeeded } from './moves';
import { DELAY_ON_CHOICE, type Replay, type ReplayFrame, type ReplaySide } from './replay';

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

export type CalloutKind = 'safe-pick' | 'cooldown' | 'match-point';

export interface Callout {
  /** Stable across copy changes, so components and tests key on it. */
  kind: CalloutKind;
  text: string;
}

/**
 * Why a move could not lose: both of the moves that beat it were resting.
 *
 * Every move is beaten by exactly two others, so a move in `safeMoves` always
 * has exactly two attackers to name — and naming them with their verbs is the
 * whole lesson, because those are the two faded arrows on the board.
 */
function safePickText(
  mover: string,
  blocked: string,
  side: ReplaySide,
  oppDelays: Record<string, number>,
): string {
  const [x, y] = threatsTo(side.move, oppDelays).all;
  return (
    `${describeBeat(x, side.move)} and ${label(y)} ${beatVerb(y, side.move)} it, ` +
    `but ${blocked} had both on cooldown ${EM} ` +
    `nothing could beat ${mover}'s ${label(side.move)}. A safe pick.`
  );
}

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
  const out: Callout[] = [];

  // A safe move cannot lose, so only the winner of a round — or either player
  // in a mirror — can have played one. Checked per side rather than assumed,
  // because in a mirror the two sides face different cooldowns.
  if (frame.a.safeMoves.includes(frame.a.move)) {
    out.push({ kind: 'safe-pick', text: safePickText(nameA, nameB, frame.a, frame.b.delaysBefore) });
  }
  if (frame.b.safeMoves.includes(frame.b.move)) {
    out.push({ kind: 'safe-pick', text: safePickText(nameB, nameA, frame.b, frame.a.delaysBefore) });
  }

  if (frame.outcome === 'draw') {
    out.push({
      kind: 'cooldown',
      text: `Neither can play ${label(frame.a.move)} for the next ${DELAY_ON_CHOICE} rounds.`,
    });
  } else {
    const aWon = frame.outcome === frame.a.seatKey;
    const winner = aWon ? frame.a : frame.b;
    const name = aWon ? nameA : nameB;
    out.push({
      kind: 'cooldown',
      text: `${name}'s ${label(winner.move)} is now out for ${DELAY_ON_CHOICE} rounds.`,
    });
  }

  const needed = winsNeeded(replay.bestOf);
  const { score: sa } = frame.a;
  const { score: sb } = frame.b;
  const settled = Math.max(sa, sb) >= needed;
  if (!settled && Math.max(sa, sb) === needed - 1) {
    const both = sa === sb;
    const name = sa > sb ? nameA : nameB;
    out.push({
      kind: 'match-point',
      text: both ? 'Match point for both players.' : `Match point for ${name}.`,
    });
  }

  return out;
}

export type RuleCardId = 'cooldown' | 'unlock' | 'safe';

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
    body: 'Watch the arrows: a move nothing can beat right now is a safe pick',
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

const RULE_ORDER: RuleCardId[] = ['cooldown', 'unlock', 'safe'];

const RULE_APPLIES: Record<RuleCardId, (frame: ReplayFrame) => boolean> = {
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
