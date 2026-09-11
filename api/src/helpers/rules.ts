/**
 * Where each card's effect actually lives: compiles a loadout into the
 * `PlayerRules` the engine takes.
 *
 * `game.ts` never imports this file — the dependency runs one way, from cards to
 * engine, so the engine cannot grow a dependency on the roster.
 *
 * Not implemented here, deliberately:
 *   - Quarantine asks its owner to name a move when it fires, so it needs input the
 *     rules object has nowhere to put yet.
 *   - Oracle needs a mid-round reveal sub-phase (JQ-150).
 *   - Sacrifice, Rust, Thief and Freeze are fired by choice, so they need ability
 *     state the rules object does not carry yet, and a record of what was fired
 *     each round — firing is a decision, so unlike everything here it is not
 *     derivable from the move list. Task 1.6, once JQ-148's migration has somewhere
 *     to put it.
 * All six are legal to hold today and cost their opening marks; they simply have
 * no further effect, and a test pins that so none of them half-works by accident.
 */

import {
  BEATS,
  BASE_RULES,
  MOVES,
  NO_DISCLOSURE,
  type Disclosure,
  type AttributedMark,
  type Move,
  type PlayerRules,
} from '../game.js';
import { slotsFor } from './abilities.js';
import { helpersIn, openingMarks, type Loadout, type MovePicker } from './loadout.js';
import type { HelperId } from './roster.js';

/** A plain duel is the null loadout, not a special case in the engine. */
export const DUEL_RULES = BASE_RULES;

/**
 * The one random decision a loadout makes: where a same-move collision displaces
 * the cheaper helper's marks. Called once, server-side, when the match starts; the
 * result is persisted so every later replay is deterministic. Returns null when
 * there is nothing to displace.
 */
export function rollFor(loadout: Loadout | null, pick: MovePicker): Move | null {
  if (!loadout) return null;
  return openingMarks(loadout, pick).rolledMove;
}

/**
 * The per-match decisions a loadout carries that are not derivable from the cards
 * themselves. Both are settled once, before round 1, and stored: replaying a match
 * has to reach the marks it reached the first time.
 */
export interface LoadoutState {
  /** From `rollFor` — where a same-move collision displaced the cheaper marks. */
  roll?: Move | null;
}

/**
 * Compile a loadout into rules.
 *
 * `roll` is the stored result of `rollFor`, not a fresh throw — a replay has to
 * reach the same marks it reached the first time. A colliding loadout with no roll
 * is a wiring mistake rather than bad input, so it throws instead of quietly
 * placing the marks somewhere plausible.
 */
export function rulesFor(loadout: Loadout | null, state: LoadoutState = {}): PlayerRules {
  if (!loadout) return DUEL_RULES;
  const roll = state.roll ?? null;

  const ids = new Set<string>(loadout);
  const has = (id: HelperId) => ids.has(id);

  const { delays, rolledMove } = openingMarks(loadout, (candidates) => {
    if (roll === null) {
      throw new Error(
        `loadout ${loadout.join(' + ')} needs a stored roll: both helpers bind the same move`,
      );
    }
    if (!candidates.includes(roll)) {
      throw new Error(`stored roll '${roll}' is not one of ${candidates.join(', ')}`);
    }
    return roll;
  });

  const beats: Record<Move, readonly Move[]> = Object.fromEntries(
    MOVES.map((m) => [m, [...BEATS[m]]]),
  ) as Record<Move, Move[]>;
  if (has('chimera')) beats.lizard = [...beats.lizard, 'scissors'];

  const disclosure: Disclosure = {
    ...NO_DISCLOSURE,
    hidesLockIn: has('poker-face'),
    showsOpponentMostPlayed: has('old-habits'),
    showsOpponentNextCooldowns: has('watchful'),
  };

  return {
    initialDelays: delays,
    rolledMove,
    beats,
    disclosure,
    abilities: slotsFor(loadout),

    /**
     * Marks the chosen move takes. Order is the semantics, so it is spelled out
     * rather than left to chance:
     *
     *  1. Bookend is absolute — "your first move of the match takes 1 mark" reads
     *     as a statement about that move, so it neither stacks with a discount nor
     *     loses to a surcharge.
     *  2. A draw rule beats a per-move one: Copycat ("yours takes 1") is a claim
     *     about the round, so it settles the cost before a per-move card speaks.
     *     Echo Chamber used to sit here too, claiming 0 and outranking Copycat —
     *     JQ-209 moved it to `adjustAfterRound` as a surcharge on both seats, so
     *     the two cards no longer compete for the same slot and stack additively
     *     instead: Copycat sets the base to 1, Echo Chamber adds its mark back.
     *  3. A per-move discount beats an outcome one: Featherweight says Lizard takes
     *     1, full stop, rather than bending to how the round went. Well Oiled says
     *     the same about Robot.
     *
     * Every branch on this path is now a discount. Tempered carried the only
     * surcharge — 3 marks for a winning move — and JQ-209 removed it, because
     * self-harm costs 0.383 a mark against self-relief's 0.156 and no amount of
     * loss-relief could pay for it. So precedence decides *which* discount applies,
     * never whether the cost goes up.
     */
    /**
     * What this seat's fired abilities do to the round. Firing is validated by the
     * caller; a firing naming an ability this loadout does not hold is ignored
     * here rather than trusted.
     */
    fireEffects({ firings, own, opponent, opponentDelays, ownDelays }) {
      const fired = (id: HelperId) => (has(id) ? firings.find((f) => f.id === id) : undefined);
      // Attributed, not merely counted: the board across the table has to be able
      // to say *which* card put a mark there, and a merged total cannot (JQ-151).
      const ownMarks: AttributedMark[] = [];
      const theirMarks: AttributedMark[] = [];
      const markTheirs = (move: Move, n: number, helperId: HelperId) => {
        theirMarks.push({ move, amount: n, helperId });
      };
      const markOwn = (move: Move, n: number, helperId: HelperId) => {
        ownMarks.push({ move, amount: n, helperId });
      };

      // Quarantine names a move before the round; it lands only if they play it.
      // The charge is spent either way, which `abilityMarks` handles by charging
      // every firing — so a miss costs the same as a hit, as the card says.
      const quarantine = fired('quarantine');
      if (quarantine && quarantine.target === opponent) markTheirs(opponent, 2, 'quarantine');

      // The same guess kept quiet. Identical marks by design: `reveal` decides who is
      // told, never what a firing does, and the pair is meant to differ only there.
      // Being unannounced is why this one still lands at ~1/3 where Quarantine, which
      // says so, is dodged instead.
      const tripwire = fired('tripwire');
      if (tripwire && tripwire.target === opponent) markTheirs(opponent, 2, 'tripwire');

      // Rust deepens a move already on cooldown, so a target they have clear is
      // not a legal firing. The caller rejects one; ignoring it here means a bad
      // firing cannot quietly become a free mark.
      //
      // One mark, not two, since JQ-209. Two was Quarantine's effect without
      // Quarantine's ~1/3 hit rate, which put it at ~26pp against a 9-10pp target.
      const rust = fired('rust');
      if (rust?.target && opponentDelays[rust.target] > 0) markTheirs(rust.target, 1, 'rust');

      // Thief moves a mark rather than adding one, so it needs a mark to move: a
      // source they have clear is not a legal firing and lands as nothing.
      const thief = fired('thief');
      if (thief?.source && thief.target && ownDelays[thief.source] > 0) {
        markOwn(thief.source, -1, 'thief');
        markTheirs(thief.target, 1, 'thief');
      }

      // Flywheel takes a mark off everything already down. Marks floor at zero, so a
      // move on one mark simply clears; nothing here can go negative.
      if (fired('flywheel')) {
        for (const move of MOVES) if (ownDelays[move] > 0) markOwn(move, -1, 'flywheel');
      }

      // Feint moves this round's cost rather than cancelling it: the played move is
      // credited back the standard 2 and the named move is charged 2 instead. A
      // discount that made the pick cost less than 2 is absorbed by the floor, so
      // Feint can never come out ahead on marks — only on which move is left live.
      const feint = fired('feint');
      if (feint?.target && feint.target !== own) {
        markOwn(own, -2, 'feint');
        markOwn(feint.target, 2, 'feint');
      }

      return {
        freezesOpponentDecay: Boolean(fired('freeze')),
        marks: { own: ownMarks, opponent: theirMarks },
      };
    },

    /** Sacrifice gives up the round to wipe the board. Fired before either picks. */
    declaresDraw(firings) {
      return has('sacrifice') && firings.some((f) => f.id === 'sacrifice');
    },

    delayOnChoice({ move, outcome, roundIndex }) {
      if (has('bookend') && roundIndex === 0) return 1;
      if (has('prologue') && roundIndex <= 1) return 1;
      if (outcome === 'draw' && has('copycat')) return 1;
      if (has('featherweight') && move === 'lizard') return 1;
      if (has('well-oiled') && move === 'robot') return 1;
      if (has('tempered') && outcome === 'loss') return 1;
      return 2;
    },

    /**
     * How this player reads a result the round already decided. Diverging from the
     * round's winner is the point: Good Old Rock spares its owner a loss without
     * taking the opponent's win away.
     */
    transformOutcome(raw, ctx) {
      if (
        has('sharp-practice') &&
        raw === 'draw' &&
        ctx.own === 'scissors' &&
        ctx.opponent === 'scissors'
      ) {
        return 'win';
      }
      if (raw === 'loss' && has('good-old-rock') && ctx.own === 'rock') return 'draw';
      return raw;
    },

    /**
     * Marks a round adds beyond the chosen-move cost. Every card here reaches
     * across to the opponent, which is why replay has to walk both seats together.
     * They stack: two cards that both mark the move that beat you add two marks.
     */
    adjustAfterRound(ctx) {
      // Only `markTheirs` now. Second Wind was the one card here that put a mark on
      // its *own* owner, and JQ-236 retired it — so every remaining end-of-round
      // adjustment reaches across, and `own` is left empty by every path.
      const opponent: AttributedMark[] = [];
      const markTheirs = (move: Move, helperId: HelperId) => {
        opponent.push({ move, amount: 1, helperId });
      };
      if (has('ferrus') && ctx.own === 'robot') markTheirs(ctx.opponent, 'ferrus');
      // Their move only. Marking both was exactly zero: a mark taken on costs the
      // same 0.383 a mark handed out earns, and the cheap 0.156 rate is for shedding
      // one rather than taking one.
      if (has('echo-chamber') && ctx.outcome === 'draw') markTheirs(ctx.opponent, 'echo-chamber');
      // Grudge skips the first loss and Small Mercy takes only the first, so the two
      // partition the losses rather than overlapping on them.
      if (has('grudge') && ctx.outcome === 'loss' && ctx.lossesSoFar >= 1) {
        markTheirs(ctx.opponent, 'grudge');
      }
      if (has('small-mercy') && ctx.outcome === 'loss' && ctx.lossesSoFar === 0) {
        markTheirs(ctx.opponent, 'small-mercy');
      }
      return { own: [], opponent };
    },
  };
}

/** The cards a loadout names, for callers that want to show them. */
export { helpersIn };
