/**
 * The twenty-two helper cards, as pure data.
 *
 * This is the single source of truth for the roster: the queue-options endpoint
 * (JQ-148) and the pick/win-rate telemetry (JQ-152) both read it rather than
 * keeping their own list. `game.ts` deliberately does not — the engine takes the
 * rules a loadout compiles to, never the cards themselves.
 */

import type { Move } from '../game.js';

export type Tier = 'Major' | 'Minor' | 'Trinket';

/**
 * How a helper spends itself. `passive` is always on; `charge` is fired by choice.
 * `per-round` is on its way out — Quarantine was its only user and now recharges
 * like everything else, so Task 1.6 collapses this to passive-or-ability.
 *
 * A charge is not spent once and gone: it sits on its own slot on the cooldown
 * track with opening and recharge marks, in the same delay marks a move uses, and
 * "once per match" is a recharge of never. Those numbers land in Task 1.6 — until
 * then this stays a bare string, because inventing the structure before the effects
 * exist would be structure nothing reads.
 */
export type Load = 'passive' | 'charge' | 'per-round';

/** Marks a helper places on its bound move at the start of the match. */
export const MARK_COST: Record<Tier, number> = { Major: 2, Minor: 1, Trinket: 0 };

/**
 * Only a Major may carry a charge, and only a bound tier has a move. Both rules
 * live in the type, so a miswritten card fails `tsc` rather than waiting for a
 * runtime assertion that someone has to remember to write.
 */
export interface HelperDef<T extends Tier = Tier> {
  id: string;
  name: string;
  tier: T;
  boundMove: T extends 'Trinket' ? null : Move;
  load: T extends 'Major' ? Load : 'passive';
  /**
   * Player-facing copy; also the `blurb` in the queue-options roster.
   *
   * Says what the helper does, never how often. An ability's cadence is its
   * opening and recharge marks, and those are numbers the picker renders — putting
   * them in prose too means two copies of a value that is expected to move, and the
   * prose is the one that silently goes stale.
   */
  blurb: string;
}

const MAJORS = [
  { id: 'good-old-rock', name: 'Good Old Rock', tier: 'Major', boundMove: 'rock',
    load: 'passive', blurb: 'When you play Rock, a loss becomes a draw.' },
  { id: 'chimera', name: 'Chimera', tier: 'Major', boundMove: 'lizard',
    load: 'passive', blurb: 'Your Lizard also beats Scissors, all match.' },
  { id: 'ferrus', name: 'Ferrus', tier: 'Major', boundMove: 'robot',
    load: 'passive', blurb: 'Your Robot takes 1 mark instead of 2.' },
  { id: 'quarantine', name: 'Quarantine', tier: 'Major', boundMove: 'scissors',
    load: 'per-round', blurb: 'Name a move. If they play it, it takes 2 extra marks.' },
  { id: 'oracle', name: 'Oracle', tier: 'Major', boundMove: 'paper',
    load: 'charge', blurb: 'Learn one live move they did not play, then re-pick.' },
  // The four below have no effect yet. They are named here because the roster
  // endpoint and the ladder test need all 22; JQ-147 Task 1.6 implements them, at
  // which point `load` carries their opening and recharge marks rather than the
  // bare string 'charge'. Sacrifice and Oracle are gated to arrive late; the rest
  // are available from round 1.
  { id: 'sacrifice', name: 'Sacrifice', tier: 'Major', boundMove: 'rock',
    load: 'charge', blurb: 'Declare the round a draw before picking, and clear all your marks.' },
  { id: 'rust', name: 'Rust', tier: 'Major', boundMove: 'scissors',
    load: 'charge', blurb: 'Add 2 marks to a move they currently have live.' },
  { id: 'thief', name: 'Thief', tier: 'Major', boundMove: 'lizard',
    load: 'charge', blurb: 'Move one mark from one of your moves onto one of theirs.' },
  { id: 'freeze', name: 'Freeze', tier: 'Major', boundMove: 'robot',
    load: 'charge', blurb: "Their marks don't decrement this round." },
] as const satisfies readonly HelperDef<'Major'>[];

const MINORS = [
  { id: 'second-wind', name: 'Second Wind', tier: 'Minor', boundMove: 'rock',
    load: 'passive', blurb: 'The first round you lose is a draw instead.' },
  { id: 'echo-chamber', name: 'Echo Chamber', tier: 'Minor', boundMove: 'paper',
    load: 'passive', blurb: "On a drawn round, their move takes an extra mark and yours doesn't." },
  { id: 'sharp-practice', name: 'Sharp Practice', tier: 'Minor', boundMove: 'scissors',
    load: 'passive', blurb: 'A Scissors mirror is a win for you, not a draw.' },
  { id: 'grudge', name: 'Grudge', tier: 'Minor', boundMove: 'scissors',
    load: 'passive', blurb: 'The move that beat you last round takes an extra mark for them.' },
  { id: 'tempered', name: 'Tempered', tier: 'Minor', boundMove: 'lizard',
    load: 'passive', blurb: 'Your winning move takes 3 marks; your losing move takes 1.' },
  { id: 'featherweight', name: 'Featherweight', tier: 'Minor', boundMove: 'lizard',
    load: 'passive', blurb: 'Your Lizard takes 1 mark instead of 2.' },
  { id: 'poker-face', name: 'Poker Face', tier: 'Minor', boundMove: 'robot',
    load: 'passive', blurb: 'The opponent is never told you have locked in.' },
  { id: 'blind-spot', name: 'Blind Spot', tier: 'Minor', boundMove: 'robot',
    load: 'passive', blurb: 'One of your moves has its cooldown hidden from them all match.' },
] as const satisfies readonly HelperDef<'Minor'>[];

const TRINKETS = [
  { id: 'small-mercy', name: 'Small Mercy', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'The first round you lose, the move that beat you takes an extra mark.' },
  { id: 'copycat', name: 'Copycat', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'On a drawn round, your move takes 1 mark instead of 2.' },
  { id: 'bookend', name: 'Bookend', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'Your first move of the match takes 1 mark instead of 2.' },
  { id: 'old-habits', name: 'Old Habits', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: 'You are shown which move the opponent has played most this match.' },
  { id: 'watchful', name: 'Watchful', tier: 'Trinket', boundMove: null,
    load: 'passive', blurb: "You are shown the opponent's cooldowns as they will stand next round." },
] as const satisfies readonly HelperDef<'Trinket'>[];

export const HELPERS: readonly HelperDef[] = [...MAJORS, ...MINORS, ...TRINKETS];

/**
 * The 22 ids as a union rather than `string`. `rules.ts` decides a card's effect
 * by matching its id, so a typo there would silently switch a helper off with
 * nothing failing — this makes it a build error instead.
 */
export type HelperId =
  | (typeof MAJORS)[number]['id']
  | (typeof MINORS)[number]['id']
  | (typeof TRINKETS)[number]['id'];

/** Takes a plain string because callers are usually validating untrusted input. */
export function getHelper(id: string): HelperDef | undefined {
  return HELPERS.find((h) => h.id === id);
}

export function isHelperId(id: string): id is HelperId {
  return getHelper(id) !== undefined;
}
