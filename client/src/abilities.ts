/**
 * The ability rail's rules, as pure functions.
 *
 * Two things this file deliberately does not do. It does not compute a charge —
 * `MatchState.abilities` is the server's fold over the rounds, projected for the
 * viewing seat, and re-deriving it here would be a second cooldown engine to keep
 * in step (the argument JQ-207 settled for the board). And it does not decide
 * whether a target is legal — `namedMovesFor` in `api/src/service.ts` does, and
 * this mirrors it so the board can grey out a chip the server was always going to
 * refuse. A mirror is allowed to be wrong in one direction only: it may never
 * offer what the server refuses.
 */

import type { AbilityMap, AbilityState } from '@game/helpers/abilities';
import { slotsFor } from '@game/helpers/abilities';
import type { Loadout } from '@game/helpers/loadout';
import { getHelper } from '@game/helpers/roster';
import type { AbilityFiring } from '@game/types';
import type { Move } from './api';
import { ALL_MOVES, MOVE_META } from './moves';

/** Marks per move, as the seat entering this round has them. */
export type Marks = Record<string, number>;

/** Both sides' marks, which is all any target rule reads. */
export interface MarksBySide {
  own: Marks;
  opponent: Marks;
}

/** One card on the rail: what it is, and where its charge stands. */
export interface HeldAbility {
  id: string;
  name: string;
  blurb: string;
  charge: AbilityState;
}

/**
 * A charge as a word.
 *
 * `kind` drives the styling; `label` is the word, and the word is what carries
 * the state — JQ-195's rule is that no state on the board rides on colour alone,
 * and three cards differing only in tint would break it.
 */
export interface ChargeReading {
  kind: 'ready' | 'recharging' | 'spent';
  label: string;
}

/**
 * A held ability the charge map says nothing about.
 *
 * Spent rather than ready: an unknown charge must never be the one that offers a
 * fire button. Reached when a projection arrives for a seat mid-claim, and by the
 * REST state route, which identifies no viewer and so carries no charges at all.
 */
const UNKNOWN_CHARGE: AbilityState = { marks: null, available: false };

/**
 * Where a charge stands, in words.
 *
 * The null branch comes first on purpose. `marks: null` is "never again this
 * match", and the server chose null over Infinity precisely because a client
 * comparing `marks > 0` would read Infinity's JSON as available — so nothing here
 * compares before that case is gone.
 *
 * `available` is not consulted. It goes false for a charge already spent *this*
 * round, which is a round condition rather than a charge one: the card still
 * reads Ready, and the rail disables the button and says you have already fired.
 */
export function chargeReading(charge: AbilityState): ChargeReading {
  if (charge.marks === null) return { kind: 'spent', label: 'Spent' };
  if (charge.marks === 0) return { kind: 'ready', label: 'Ready' };
  const marks = charge.marks;
  return { kind: 'recharging', label: `${marks} more round${marks === 1 ? '' : 's'}` };
}

/**
 * The cards this seat holds a charge for, with the roster's own name and blurb.
 *
 * Asked through `slotsFor`, which is the same source `rulesFor` compiles a
 * loadout's abilities from — so "the rail shows it" cannot drift from "the engine
 * will honour it". A passive Major holds no slot and so never reaches the rail;
 * `duel` brings the null loadout and so reaches it with nothing.
 */
export function heldAbilities(loadout: Loadout | null, abilities: AbilityMap): HeldAbility[] {
  return Object.keys(slotsFor(loadout)).map((id) => {
    const helper = getHelper(id);
    return {
      id,
      name: helper?.name ?? id,
      blurb: helper?.blurb ?? '',
      charge: abilities[id] ?? UNKNOWN_CHARGE,
    };
  });
}

/** One move a firing has to name, and the rule the server will hold it to. */
export interface TargetStep {
  /** Which field of the `fire` message this step fills. */
  field: 'target' | 'source';
  /** Asked of the player, e.g. "Name a move they have on cooldown". */
  prompt: string;
  /** Whose marks the chips are drawn against — whose board you are pointing at. */
  side: 'own' | 'opponent';
  /** True when the move may be named given the marks. */
  allows: (move: Move, marks: MarksBySide) => boolean;
  /** Why a disallowed move is disallowed, spoken to the player. */
  rejection: (move: Move) => string;
}

const anyMove = () => true;

/** A move carrying at least one mark on the given side — what Rust and Thief need. */
const marked = (side: 'own' | 'opponent') => (move: Move, marks: MarksBySide) =>
  (marks[side][move] ?? 0) > 0;

/**
 * What each ability has to name, in the order it names it.
 *
 * Mirrors `namedMovesFor`'s switch, card for card. Thief is the only two-step
 * card, and the reason the walk is a list rather than an optional single target:
 * it moves a mark rather than adding one, so it names where the mark comes from
 * as well as where it goes.
 */
export function targetSteps(helperId: string): TargetStep[] {
  switch (helperId) {
    // Fired blind, at a move the opponent has not chosen yet, so every move is a
    // legal guess. That it may miss is the card's price, not a validation failure.
    case 'quarantine':
      return [
        {
          field: 'target',
          prompt: 'Name a move. If they play it, it takes 2 extra marks.',
          side: 'opponent',
          allows: anyMove,
          rejection: () => '',
        },
      ];
    case 'rust':
      return [
        {
          field: 'target',
          prompt: 'Name a move they have on cooldown.',
          side: 'opponent',
          allows: marked('opponent'),
          rejection: (move) =>
            `${MOVE_META[move].label} is clear — Rust needs a move they have on cooldown`,
        },
      ];
    case 'thief':
      return [
        {
          field: 'source',
          prompt: 'Take a mark from one of your moves.',
          side: 'own',
          allows: marked('own'),
          rejection: (move) =>
            `${MOVE_META[move].label} is clear — Thief needs a mark of yours to take`,
        },
        {
          field: 'target',
          prompt: 'Put it on one of theirs.',
          side: 'opponent',
          allows: anyMove,
          rejection: () => '',
        },
      ];
    // Sacrifice and Freeze act on the round rather than on a move. Oracle names
    // one, but the *server* names it, once both players have locked in — a target
    // from the client is refused rather than trusted.
    default:
      return [];
  }
}

/** The moves a step will accept, in board order. */
export function legalTargets(
  _helperId: string,
  step: TargetStep,
  marks: MarksBySide,
): Move[] {
  return ALL_MOVES.filter((move) => step.allows(move, marks));
}

/** "you"/"they" and "your"/"their", from the seat that fired. */
function voice(firing: AbilityFiring, mySeatKey: string) {
  const mine = firing.seatKey === mySeatKey;
  return {
    actor: mine ? 'you' : 'they',
    yours: mine ? 'your' : 'their',
    theirs: mine ? 'their' : 'your',
  };
}

/**
 * What one resolved firing did, in a line.
 *
 * Only ever called with firings from rounds that have resolved — the server
 * withholds the round in progress, because Quarantine names the move it fears and
 * an opponent who could read that would simply play something else.
 */
export function describeFiring(firing: AbilityFiring, mySeatKey: string): string {
  const { actor, yours, theirs } = voice(firing, mySeatKey);
  const name = getHelper(firing.helperId)?.name ?? firing.helperId;
  const target = firing.target ? MOVE_META[firing.target].label : null;
  const source = firing.source ? MOVE_META[firing.source].label : null;

  switch (firing.helperId) {
    case 'quarantine':
      return `${name} — ${actor} named ${target}`;
    case 'rust':
      return `${name} — ${actor} added 2 marks to ${theirs} ${target}`;
    case 'thief':
      return `${name} — ${actor} moved a mark from ${yours} ${source} onto ${theirs} ${target}`;
    case 'sacrifice':
      return `${name} — ${actor} declared the round a draw and cleared ${yours} marks`;
    case 'freeze':
      return `${name} — ${actor} stopped ${theirs} marks decrementing`;
    case 'oracle':
      // Null when the opponent played their only live move: there was nothing
      // they did not play, and the charge was spent to be told so.
      return target
        ? `${name} — ${actor} learned ${actor === 'you' ? 'they' : 'you'} did not play ${target}`
        : `${name} — there was nothing ${actor === 'you' ? 'they' : 'you'} did not play`;
    default:
      return `${name} — fired`;
  }
}
