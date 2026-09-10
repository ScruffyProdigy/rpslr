/**
 * The twenty-five helper cards, as pure data.
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
 * Sacrifice is the only card secret out of necessity: the cost is that they waste a
 * move on a round already decided, which they would not do if told. Rust and Thief
 * apply whatever the opponent plays, so they would work identically in public and
 * are secret by convention rather than by function.
 *
 * Quarantine used to be listed here as the second necessity, on the argument that a
 * name they can read is a name they dodge. That argument was backwards — dodging is
 * the effect, and denying a live option outright beats collecting marks one time in
 * three. It fires in public, and so does Freeze.
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
  // Public, and that is the card. An earlier draft called it "secret out of
  // necessity" on the grounds that a name they can read is a name they dodge — but
  // dodging *is* the effect. A move they will not play is a move denied, and a live
  // option denied for a round is worth 0.383 outright, where the secret version
  // collects 2 marks one time in three, or 0.255. Naming out loud is the stronger
  // half as well as the more interesting one, so the card is priced on it.
  //
  // What it buys is a decision about *when*. `disclosedFirings` publishes a public
  // firing the moment it happens, so firing before they commit deters — they pick
  // knowing — while firing after they lock only forces a re-pick in the rounds they
  // had already chosen the named move, and `submitMove` locks the firer, so nothing
  // is gained from watching them switch. Early is the strong line. That is a skill
  // the card teaches by costing you when you get it wrong.
  //
  // Recharge 4 rather than 3 is the whole of the reprice: 0.383 every third round is
  // ~12.8pp against a 9-10pp target, every fourth is ~9.6pp. The magnitude cannot do
  // this job — on a public card 2 marks is a credibility threshold rather than a
  // value, so it is paid rarely and dropping it to 1 would stop the deterrence
  // instead of shrinking it. Cadence is the only knob a public card has.
  { id: 'quarantine', name: 'Quarantine', tier: 'Major', boundMove: 'scissors',
    load: { kind: 'ability', opening: 0, recharge: 4 }, reveal: 'public',
    blurb: 'Name a move. If they play it, it takes 2 extra marks.' },
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
  // JQ-209 repriced this twice over. The blurb said "a move they currently have
  // live" while `fireEffects` has always required `opponentDelays[target] > 0` — a
  // move already down — so the card's own text described a different card. And at
  // +2 marks every third round it was Quarantine's effect without Quarantine's ~1/3
  // hit rate: +2 / 3 rounds = 0.67 marks a round, ~26pp, the number Quarantine was
  // itself repriced away from. One mark on a four-mark recharge is ~9.6pp.
  { id: 'rust', name: 'Rust', tier: 'Major', boundMove: 'scissors',
    load: { kind: 'ability', opening: 0, recharge: 4 }, reveal: 'secret',
    blurb: 'Secretly add a mark to a move already on their cooldown.' },
  // The only card that denies and relieves in one action, which is why it prices
  // at ~18pp on a 3-mark recharge: 0.33 x 0.383 of denial plus 0.33 x 0.156 of
  // relief. Six marks halves it to ~9pp and gives it a shape — it returns only in
  // a match that grinds, so it self-selects into the comeback slot beside Sacrifice.
  { id: 'thief', name: 'Thief', tier: 'Major', boundMove: 'lizard',
    load: { kind: 'ability', opening: 0, recharge: 6 }, reveal: 'secret',
    blurb: 'Secretly move one mark from one of your moves onto one of theirs.' },
  // Freeze holds both their blocked moves down an extra round, so it is worth ~2
  // marks a firing — the same ~26pp as Rust was, and for the same reason. Cutting
  // the effect would have made it Rust with no target, so the cadence took the cut
  // instead: `recharge: null` is the "once per match" the type already had and
  // nothing used. Once per match is still ~14.6pp on its own; announcing it before
  // anyone commits is what brings it to ~11pp, because a board they can see is a
  // board they can plan around.
  //
  // This is the roster's first public firing, which the design doc asks for in as
  // many words: Rust, Thief and Freeze "apply regardless of what the opponent
  // plays, so they work identically in public" and are secret by convention rather
  // than by function.
  //
  // It does cost a sub-phase, and an earlier draft of this comment claimed it did
  // not. `entitlementsIn` hands the seat a public firing acts *against* the round's
  // window, so the disclosure lands after both have committed rather than before —
  // the design doc's third row, not its second. The ~11pp above is priced on that
  // reading and stands: the discount comes from the opponent getting a reaction,
  // and a mid-round re-pick is a reaction. What changes is the cost side. Every
  // Freeze is a mid-round pause, and the doc is explicit that the budget for those
  // is small. Once per match is what keeps it affordable, and a public card on a
  // short recharge would not be. See `Reveal` above.
  { id: 'freeze', name: 'Freeze', tier: 'Major', boundMove: 'robot',
    load: { kind: 'ability', opening: 0, recharge: null }, reveal: 'public',
    blurb: 'Stop their marks decrementing this round.' },
  // Cancelling their first win is ~+15.6pp — first-to-3 against first-to-4 is a
  // six-round race you take with three wins, 42/64 — against a 9-10pp Major target.
  // JQ-209 took the weaker-effect option rather than keeping a knowingly hot Major:
  // the save costs an extra mark on the move that lost, ~7.3pp of tempo back, which
  // lands the card at ~8.3pp.
  //
  // It was two marks, priced at 0.156 each, until the rate was checked. A mark you
  // put on your *own* board mid-match is not worth what a mark you take off it is:
  // shedding one takes you from 3 live toward 4 (+0.156), adding one pushes you from
  // 3 toward 2 (-0.383). Two marks was 14.6pp of cost against a 15.6pp save — a card
  // worth 1pp. One mark is the price the save can actually carry.
  //
  // It also answers the doc's open question about defensive stacking. Good Old Rock
  // and Second Wind are both Rock-bound and both turn losses into draws, so they are
  // draftable together; now the second save is paid for in the currency the game is
  // actually about.
  { id: 'second-wind', name: 'Second Wind', tier: 'Major', boundMove: 'rock',
    load: PASSIVE,
    blurb: 'The first round you lose is a draw instead, but your move takes an extra mark.' },
] as const satisfies readonly HelperDef<'Major'>[];

const MINORS = [
  // Was the roster's worst mispricing at ~14pp on a 6-7pp tier: "yours doesn't" was
  // built as `delayOnChoice` returning 0, so your drawn move took no marks at all,
  // saving 2 — on top of a mark on theirs. It also strictly contained Copycat, which
  // the precedence rule in `rules.ts` had to arbitrate.
  //
  // The first fix put the extra mark on both moves and was wrong in the other
  // direction. A mark on your own board costs 0.383 mid-match, the same as a mark on
  // theirs earns — the +0.156 rate is for *shedding* one, not for taking one on. So
  // "both take a mark" is exactly zero, and the card did nothing at all.
  //
  // Denial alone is 0.2 x 0.383 = ~7.7pp, in band. A draw is a mirror, so it needs
  // both seats on the same move: with 3 live each and ~1.8 moves of overlap that is
  // about one round in five, not one in three. Copycat is untouched either way —
  // that discounts your drawn move, this surcharges theirs.
  { id: 'echo-chamber', name: 'Echo Chamber', tier: 'Minor', boundMove: 'paper',
    load: PASSIVE, blurb: "On a drawn round, their move takes an extra mark." },
  { id: 'sharp-practice', name: 'Sharp Practice', tier: 'Minor', boundMove: 'scissors',
    load: PASSIVE, blurb: 'A Scissors mirror is a win for you, not a draw.' },
  // Fired on every loss, which is ~0.375 of rounds: 0.375 x 0.383 = ~13pp, Major
  // strength at a Minor price — the exact failure the doc warns makes Minor + Minor
  // the best build. Skipping the first loss halves it to ~7pp and makes it the
  // complement of Small Mercy below rather than Small Mercy's superset: Small Mercy
  // covers loss one, Grudge covers the rest.
  { id: 'grudge', name: 'Grudge', tier: 'Minor', boundMove: 'scissors',
    load: PASSIVE,
    blurb: 'From your second loss onward, the move that beat you takes an extra mark for them.' },
  // It used to charge your winning move 3 marks to pay for the discount on your
  // losing one, and that trade cannot be made. Self-harm costs 0.383 a mark and
  // self-relief earns 0.156, so a single mark of penalty needs ~2.45 marks of relief
  // to break even and the most a losing move can be given back is 2. The card priced
  // at about -7.6pp: not merely cold, actively bad to hold.
  //
  // So the penalty is gone and the catch-up stays. ~5.2pp, a point under the band,
  // and the general rule is worth keeping: in this game anti-snowball has to come
  // from helping the loser, never from taxing the winner.
  { id: 'tempered', name: 'Tempered', tier: 'Minor', boundMove: 'lizard',
    load: PASSIVE, blurb: 'Your losing move takes 1 mark instead of 2.' },
  { id: 'featherweight', name: 'Featherweight', tier: 'Minor', boundMove: 'lizard',
    load: PASSIVE, blurb: 'Your Lizard takes 1 mark instead of 2.' },
  // Promoted out of the Trinkets by JQ-209. One mark of denial, once, is ~7.3pp
  // (0.383 x 19) — Minor money, not Trinket money — and Rock had three Majors and no
  // Minor, so a player wanting a cheap helper on Rock had nothing to pick and no way
  // to place a single opening mark there.
  { id: 'small-mercy', name: 'Small Mercy', tier: 'Minor', boundMove: 'rock',
    load: PASSIVE, blurb: 'The first round you lose, the move that beat you takes an extra mark.' },
  // Robot had the same hole as Rock, and the same fix. This is the effect Ferrus
  // used to carry, which was cut for being Featherweight at twice the price — as a
  // Minor it is Featherweight's sibling rather than its dominator, priced the same
  // (~5pp) for the same effect on a different move. Robot opens at 2 marks, the
  // deepest on the board, so the discount reads differently there.
  { id: 'well-oiled', name: 'Well Oiled', tier: 'Minor', boundMove: 'robot',
    load: PASSIVE, blurb: 'Your Robot takes 1 mark instead of 2.' },
  // The first three charged Minors. JQ-237 opened the tier to a charge and no card
  // had used it, so "a Minor may fire" was a type fact rather than a roster one.
  //
  // All three relieve rather than deny, and that is the tier's identity rather than
  // a coincidence. A mark of denial is worth 0.383 against relief's 0.156, so
  // *reliable* denial priced for a Minor has to fire about once every six rounds —
  // a Major's rhythm at a Minor's price, which reads as a worse Major rather than a
  // different card. Relief is cheap enough to fire often, so Majors deny and Minors
  // relieve, and the tiers play at different speeds instead of different sizes.
  //
  // Reliable is the load-bearing word, and an earlier draft of this comment left it
  // out. A *guess* is denial already discounted by its hit rate: one mark landing
  // one time in three is 0.128 a firing, which pays for a two-mark recharge at Minor
  // money without being slow. So the rule bounds what a Minor may deny *for certain*
  // — it does not close the tier to prediction, and JQ-236's secret name-a-move card
  // is the case that showed the difference.

  // The board-wide burst, and the self-side mirror of Freeze: where that holds every
  // mark on their board for a round, this takes one off every mark on yours. About
  // 2 marks a firing at steady state, 2 x 0.156 = 0.312, so ~6.2pp on a five-mark
  // recharge. Rare and large, which is what makes it a different decision from the
  // small frequent one below rather than a bigger version of it.
  { id: 'flywheel', name: 'Flywheel', tier: 'Minor', boundMove: 'robot',
    load: { kind: 'ability', opening: 0, recharge: 5 }, reveal: 'secret',
    blurb: 'Secretly clear a mark from every move you have on cooldown.' },
  // The only card on the roster that touches *where* marks land rather than how many
  // there are, and so the only way to play the same move twice running — which the
  // design doc lists as a fact about the game rather than a rule ("a played move
  // carries 2 marks, so every punish-them-for-repeating ability is dead on arrival").
  // Nothing else on the roster assumes that invariant holds for its own owner, so
  // breaking it here costs no other card.
  //
  // Its total marks are unchanged, so it is not priced on the mark economy at all:
  // what it buys is an option nobody else has, and the marks still have to go
  // somewhere you can afford. ~6.2pp at 0 / 4 is an estimate rather than a
  // derivation, and the widest error bar in this pass.
  { id: 'feint', name: 'Feint', tier: 'Minor', boundMove: 'paper',
    load: { kind: 'ability', opening: 0, recharge: 4 }, reveal: 'secret',
    blurb: "Secretly name one of your moves. This round's marks land on it instead." },
  // Opening tempo, which no card addresses and the shape table is entirely about:
  // a Major blocks rounds 1 and 2, a Minor round 1, a Trinket neither. Two marks of
  // relief while you are still above three live, where the shallow rate applies:
  // 2 x 0.156 x 19 = ~5.9pp. Bookend is the same idea one tier down and one round
  // shorter, which is what a tier step should look like.
  { id: 'prologue', name: 'Prologue', tier: 'Minor', boundMove: 'rock',
    load: PASSIVE, blurb: 'Your first two moves of the match take 1 mark instead of 2.' },
  // Blind Spot was cut here. It hid a cooldown that is fully derivable from the
  // public move history, so it did nothing to an opponent doing the arithmetic and
  // only obstructed one who wasn't — the inverse of the design doc's own case
  // against Watchful and Old Habits. Poker Face survives the same test, because
  // lock-in is live state and not in the history.
  //
  // JQ-209 re-ran that test over every information card on the roster and found
  // nothing else failing it. Old Habits and Watchful stay as the doc's declared
  // convenience traps; Oracle passes because a move they did *not* choose is not
  // computable from a history of what they did.
] as const satisfies readonly HelperDef<'Minor'>[];

const TRINKETS = [
  // A Trinket rather than a Minor: hiding lock-in denies a timing tell, not a
  // number, so it belongs with Old Habits and Watchful in the tier where cards are
  // honestly priced at nothing. Unlike Blind Spot it is at least not derivable —
  // lock-in is live state, absent from the move history.
  { id: 'poker-face', name: 'Poker Face', tier: 'Trinket', boundMove: null,
    load: PASSIVE, blurb: 'The opponent is never told you have locked in.' },
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
 * The 25 ids as a union rather than `string`. `rules.ts` decides a card's effect
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
