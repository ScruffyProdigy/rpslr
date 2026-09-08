/**
 * Where each card's effect actually lives: compiles a loadout into the
 * `PlayerRules` the engine takes.
 *
 * `game.ts` never imports this file — the dependency runs one way, from cards to
 * engine, so the engine cannot grow a dependency on the roster.
 *
 * Not implemented here, deliberately:
 *   - Quarantine asks its owner for a move every round, so it needs per-round
 *     input the rules object has nowhere to put yet.
 *   - Oracle needs a mid-round reveal sub-phase (JQ-150).
 *   - Sacrifice, Rust, Thief and Freeze are gated on the charge-Major resize
 *     sign-off (JQ-146 Task 1.0). Each is worth about a third of what a passive
 *     earns at present, so building them to the current numbers would bake in a
 *     balance bug.
 * All six are legal to hold today and cost their opening marks; they simply have
 * no further effect, and a test pins that so none of them half-works by accident.
 */

import {
  BEATS,
  BASE_RULES,
  MOVES,
  NO_DISCLOSURE,
  type Disclosure,
  type MarkAdjustment,
  type Move,
  type PlayerRules,
} from '../game.js';
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
  /** Blind Spot: the move its holder named at the draft. */
  blindSpot?: Move | null;
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

  // Blind Spot hides a move its holder *names at the draft* — any of the five, not
  // the robot it is bound to. Holding it without a named move is a wiring gap, the
  // same class of mistake as a collision with no roll, so it throws rather than
  // quietly hiding nothing. JQ-149 collects the name; JQ-151 renders the effect.
  const blindSpot = has('blind-spot') ? state.blindSpot ?? null : null;
  if (has('blind-spot') && blindSpot === null) {
    throw new Error('blind-spot needs the move its holder named at the draft');
  }
  if (blindSpot !== null && !MOVES.includes(blindSpot)) {
    throw new Error(`'${blindSpot}' is not a move blind-spot could name`);
  }

  const disclosure: Disclosure = {
    ...NO_DISCLOSURE,
    hidesLockIn: has('poker-face'),
    hiddenCooldown: blindSpot,
    showsOpponentMostPlayed: has('old-habits'),
    showsOpponentNextCooldowns: has('watchful'),
  };

  return {
    initialDelays: delays,
    rolledMove,
    beats,
    disclosure,

    /**
     * Marks the chosen move takes. Order is the semantics, so it is spelled out
     * rather than left to chance:
     *
     *  1. Bookend is absolute — "your first move of the match takes 1 mark" reads
     *     as a statement about that move, so it neither stacks with a discount nor
     *     loses to a surcharge.
     *  2. A draw rule beats a per-move one, and Echo Chamber ("yours doesn't")
     *     beats Copycat ("yours takes 1") because it is the stronger claim.
     *  3. A per-move discount beats an outcome surcharge: Ferrus says Robot takes
     *     1, full stop, which is why it is worth a Major.
     */
    delayOnChoice({ move, outcome, roundIndex }) {
      if (has('bookend') && roundIndex === 0) return 1;
      if (outcome === 'draw') {
        if (has('echo-chamber')) return 0;
        if (has('copycat')) return 1;
      }
      if (has('ferrus') && move === 'robot') return 1;
      if (has('featherweight') && move === 'lizard') return 1;
      if (has('tempered') && outcome === 'win') return 3;
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
      if (raw === 'loss') {
        if (has('good-old-rock') && ctx.own === 'rock') return 'draw';
        if (has('second-wind') && ctx.lossesSoFar === 0) return 'draw';
      }
      return raw;
    },

    /**
     * Marks a round adds beyond the chosen-move cost. Every card here reaches
     * across to the opponent, which is why replay has to walk both seats together.
     * They stack: two cards that both mark the move that beat you add two marks.
     */
    adjustAfterRound(ctx) {
      const adjustment: MarkAdjustment = { own: {}, opponent: {} };
      const markTheirs = (move: Move) => {
        adjustment.opponent[move] = (adjustment.opponent[move] ?? 0) + 1;
      };
      if (has('echo-chamber') && ctx.outcome === 'draw') markTheirs(ctx.opponent);
      if (has('grudge') && ctx.outcome === 'loss') markTheirs(ctx.opponent);
      if (has('small-mercy') && ctx.outcome === 'loss' && ctx.lossesSoFar === 0) {
        markTheirs(ctx.opponent);
      }
      return adjustment;
    },
  };
}

/** The cards a loadout names, for callers that want to show them. */
export { helpersIn };
