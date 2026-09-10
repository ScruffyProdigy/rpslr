/**
 * The twenty-one helper cards, as pure data.
 *
 * This is the single source of truth for the roster: the queue-options endpoint
 * (`helpers/queueOptions.ts`) and the pick/win-rate telemetry (JQ-152) both read it
 * rather than keeping their own list, and the contract's roster fixture is generated
 * from it, so a card added here reaches the lobby's picker or fails CI. `game.ts` deliberately does not — the engine takes the
 * rules a loadout compiles to, never the cards themselves.
 */

import type { Move } from '../game.js';

export type Tier = 'Major' | 'Minor' | 'Trinket';

/**
 * How a helper spends itself.
 *
 * A `passive` is always on. An `ability` is fired by choice and occupies its own slot
 * on the cooldown track, counted in the same delay marks a move uses: `opening` is
 * how many marks it starts with, and so how long before it is first available, and
 * `recharge` is what firing costs, and so how often it comes back.
 *
 * `recharge: null` means it never does — "once per match" is a value here rather than
 * a separate kind. There is no per-round kind either: Quarantine names its move when
 * it fires, like any other ability.
 *
 * The effects themselves are not implemented (Task 1.6). The numbers are declared
 * here anyway, because the lobby's loadout picker has to show them — a player
 * drafting Sacrifice needs to know it does nothing until round 4 — rather than
 * because any signature is waiting on them. They are all first guesses, meant to
 * move as JQ-152's telemetry comes in rather than be argued to a conclusion first.
 */
export type Load =
  | { kind: 'passive' }
  | { kind: 'ability'; opening: number; recharge: number | null };

export type AbilityLoad = { kind: 'ability'; opening: number; recharge: number | null };

/** Written once so the roster below reads as a table rather than as boilerplate. */
const PASSIVE = { kind: 'passive' } as const;

export function isAbility(load: Load): load is AbilityLoad {
  return load.kind === 'ability';
}

/** Marks a helper places on its bound move at the start of the match. */
export const MARK_COST: Record<Tier, number> = { Major: 2, Minor: 1, Trinket: 0 };

/**
 * Whether the opponent is told a firing happened at the moment it happens.
 *
 * Both exist because they play differently and both are fun. A `secret` firing is
 * withheld until the round resolves; a `public` one is announced as it is fired,
 * which hands the seat it acts against something to answer.
 *
 * Only two of the six are secret out of necessity — Quarantine ("*if they play
 * it*") and Sacrifice (the wasted move is the cost). Rust, Thief and Freeze apply
 * whatever the opponent plays, so they would work identically in public. That they
 * are all secret today is a fact about this file, not about the engine.
 *
 * Not the same axis as whether a firing needs a mid-round sub-phase. Oracle is
 * `secret` — its named move is hidden from the opponent until the round resolves —
 * and still opens one, because it reveals to its own *holder*. See
 * `helpers/reveals.ts`, which is where that other question is answered.
 */
export type Reveal = 'secret' | 'public';

/**
 * How a helper spends itself, and who sees it do so. The two move together: an
 * ability must declare a `reveal`, and a passive has no firing to disclose.
 *
 * A union rather than an optional field, so both halves are the type's to enforce.
 * A card that fires without saying whether it does so in secret fails `tsc`, which
 * is the point — putting "secretly" in a blurb is a documentation convention, and
 * documentation drifts.
 */
type Spend =
  | { load: { kind: 'passive' }; reveal?: never }
  | { load: AbilityLoad; reveal: Reveal };

/**
 * Only a bound tier has a move, and only a bound tier may carry a charge. Both
 * rules live in the type, so a miswritten card fails `tsc` rather than waiting for
 * a runtime assertion that someone has to remember to write.
 *
 * JQ-237 moved the second one. It used to read "only a Major", which conflated
 * price with load and left an ability worth about a tier step less than a Major
 * with nowhere to live. Tier still sets the price — `MARK_COST` is untouched — and
 * load now sets itself, so a Minor may buy a cheaper opening and still fire.
 *
 * A Trinket stays passive-only, and that is the rule doing work now: it has no
 * bound move and costs nothing, so a charge on one would be an ability for free.
 * Keeping one tier reliably load-free is also what lets the draft always answer a
 * player who wants nothing to remember.
 */
export type HelperDef<T extends Tier = Tier> = {
  id: string;
  name: string;
  tier: T;
  boundMove: T extends 'Trinket' ? null : Move;
  /**
   * Player-facing copy; served as `description` in the queue-options roster.
   *
   * Says what the helper does, never how often. How often is the `opening` and
   * `recharge` marks above, which the lobby's loadout picker renders from the
   * roster — putting them in prose as well means two copies of a value that is
   * expected to move, and the prose is the copy that goes stale in silence.
   */
  blurb: string;
} & (T extends 'Trinket' ? { load: { kind: 'passive' }; reveal?: never } : Spend);

const MAJORS = [
  { id: 'good-old-rock', name: 'Good Old Rock', tier: 'Major', boundMove: 'rock',
    load: PASSIVE, blurb: 'When you play Rock, a loss becomes a draw.' },
  { id: 'chimera', name: 'Chimera', tier: 'Major', boundMove: 'lizard',
    load: PASSIVE, blurb: 'Your Lizard also beats Scissors, all match.' },
  { id: 'ferrus', name: 'Ferrus', tier: 'Major', boundMove: 'robot',
    load: PASSIVE, blurb: 'When you play Robot, the move they played takes an extra mark.' },
  // Secret out of necessity: "if they play it" is only a threat while they cannot
  // read the guess. An opponent who could would simply play something else.
  { id: 'quarantine', name: 'Quarantine', tier: 'Major', boundMove: 'scissors',
    load: { kind: 'ability', opening: 0, recharge: 3 }, reveal: 'secret',
    blurb: 'Secretly name a move. If they play it, it takes 2 extra marks.' },
  // `secret` on this axis and still sub-phased on the other: the move it names is
  // hidden from the opponent until the round resolves, and the window it opens is
  // for its own holder. The two questions are separate — see `Reveal`.
  //
  // The blurb no longer promises how the round ends. Once anyone else may re-pick
  // (JQ-239) the opponent can move *onto* the named move, so the guarantee is real
  // as of lock-in and not at resolution.
  { id: 'oracle', name: 'Oracle', tier: 'Major', boundMove: 'paper',
    load: { kind: 'ability', opening: 0, recharge: 3 }, reveal: 'secret',
    blurb: 'Secretly learn one live move they had not chosen, then re-pick.' },
  // The four below carry their marks but no effect yet — Task 1.6 implements those.
  // Sacrifice opens on 3 so it cannot fire before round 4: its early line is
  // degenerate rather than merely weak, which is the only reason to gate a card.
  // Secret out of necessity too, for the opposite reason to Quarantine: the cost is
  // that they waste a move on a round already decided, which they would not if told.
  { id: 'sacrifice', name: 'Sacrifice', tier: 'Major', boundMove: 'rock',
    load: { kind: 'ability', opening: 3, recharge: 3 }, reveal: 'secret',
    blurb: 'Secretly declare the round a draw before picking, and clear all your marks.' },
  // Rust, Thief and Freeze all apply whatever the opponent plays, so they would work
  // identically in public. They are secret by convention rather than by function;
  // making one public is a balance decision per card, not a change to this field's
  // meaning.
  { id: 'rust', name: 'Rust', tier: 'Major', boundMove: 'scissors',
    load: { kind: 'ability', opening: 0, recharge: 3 }, reveal: 'secret',
    blurb: 'Secretly add 2 marks to a move they currently have live.' },
  { id: 'thief', name: 'Thief', tier: 'Major', boundMove: 'lizard',
    load: { kind: 'ability', opening: 0, recharge: 3 }, reveal: 'secret',
    blurb: 'Secretly move one mark from one of your moves onto one of theirs.' },
  { id: 'freeze', name: 'Freeze', tier: 'Major', boundMove: 'robot',
    load: { kind: 'ability', opening: 0, recharge: 3 }, reveal: 'secret',
    blurb: "Secretly stop their marks decrementing this round." },
  // A Major because cancelling their first win is worth ~+15.6pp — first-to-3
  // against first-to-4 is a six-round race you take with three wins, 42/64. A tier
  // step is only worth ~3pp, so this is the defensible price rather than the right
  // one; the effect itself is what wants revisiting. See JQ-209.
  { id: 'second-wind', name: 'Second Wind', tier: 'Major', boundMove: 'rock',
    load: PASSIVE, blurb: 'The first round you lose is a draw instead.' },
] as const satisfies readonly HelperDef<'Major'>[];

const MINORS = [
  { id: 'echo-chamber', name: 'Echo Chamber', tier: 'Minor', boundMove: 'paper',
    load: PASSIVE, blurb: "On a drawn round, their move takes an extra mark and yours doesn't." },
  { id: 'sharp-practice', name: 'Sharp Practice', tier: 'Minor', boundMove: 'scissors',
    load: PASSIVE, blurb: 'A Scissors mirror is a win for you, not a draw.' },
  { id: 'grudge', name: 'Grudge', tier: 'Minor', boundMove: 'scissors',
    load: PASSIVE, blurb: 'The move that beat you last round takes an extra mark for them.' },
  { id: 'tempered', name: 'Tempered', tier: 'Minor', boundMove: 'lizard',
    load: PASSIVE, blurb: 'Your winning move takes 3 marks; your losing move takes 1.' },
  { id: 'featherweight', name: 'Featherweight', tier: 'Minor', boundMove: 'lizard',
    load: PASSIVE, blurb: 'Your Lizard takes 1 mark instead of 2.' },
  // Blind Spot was cut here. It hid a cooldown that is fully derivable from the
  // public move history, so it did nothing to an opponent doing the arithmetic and
  // only obstructed one who wasn't — the inverse of the design doc's own case
  // against Watchful and Old Habits. Poker Face survives the same test, because
  // lock-in is live state and not in the history.
] as const satisfies readonly HelperDef<'Minor'>[];

const TRINKETS = [
  // A Trinket rather than a Minor: hiding lock-in denies a timing tell, not a
  // number, so it belongs with Old Habits and Watchful in the tier where cards are
  // honestly priced at nothing. Unlike Blind Spot it is at least not derivable —
  // lock-in is live state, absent from the move history.
  { id: 'poker-face', name: 'Poker Face', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'The opponent is never told you have locked in.' },
  { id: 'small-mercy', name: 'Small Mercy', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'The first round you lose, the move that beat you takes an extra mark.' },
  { id: 'copycat', name: 'Copycat', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'On a drawn round, your move takes 1 mark instead of 2.' },
  { id: 'bookend', name: 'Bookend', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'Your first move of the match takes 1 mark instead of 2.' },
  { id: 'old-habits', name: 'Old Habits', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'You are shown which move the opponent has played most this match.' },
  { id: 'watchful', name: 'Watchful', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: "You are shown the opponent's cooldowns as they will stand next round." },
] as const satisfies readonly HelperDef<'Trinket'>[];

export const HELPERS: readonly HelperDef[] = [...MAJORS, ...MINORS, ...TRINKETS];

/**
 * The 21 ids as a union rather than `string`. `rules.ts` decides a card's effect
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

/**
 * Whether a firing is announced as it happens rather than held until the round
 * resolves.
 *
 * Takes an id because its caller has a recorded firing rather than a card, and
 * answers `false` for anything it cannot place — a passive, or an id no longer on
 * the roster. Withholding is the safe default: disclosing a firing that should have
 * been secret cannot be taken back, and a firing withheld still surfaces when the
 * round resolves.
 */
export function firesInPublic(helperId: string): boolean {
  return getHelper(helperId)?.reveal === 'public';
}
