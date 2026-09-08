/**
 * The roster the lobby's pre-queue picker renders, and the validation of what comes
 * back — both generated from `roster.ts` rather than re-typed.
 *
 * That is the point of the module. `docs/fixtures/prequeue/queue-options.duel-helpers.json`
 * is the specification and the test compares this output against it, so a card added,
 * renamed or repriced in `roster.ts` either reaches the picker or fails CI.
 * Hand-writing the 21 entries here would let the two drift silently, which is exactly
 * what the fixture exists to prevent.
 *
 * Nothing in here teaches the lobby what a mark is: `section`, `badge` and
 * `description` are rendered verbatim and uninterpreted.
 *
 * @see JoinQuest developer integration guide §13 "Pre-queue options"; golden
 * bodies in `docs/fixtures/prequeue/`.
 */

import type { PreQueueGroup } from '../gameModes.js';
import { HELPERS, MARK_COST, type Tier } from './roster.js';

/** One entry in the roster body. Field names and order are the contract's. */
export interface QueueOptionChoice {
  id: string;
  label: string;
  section: string;
  badge: string;
  description: string;
  /**
   * Always false here. `locking: "none"` — every helper is available to every
   * player, so a locked choice (which carries a requirement rather than vanishing,
   * per the mode-eligibility vocabulary) never arises.
   */
  locked: boolean;
}

export interface QueueOptionsBody {
  modeKey: string;
  choices: QueueOptionChoice[];
}

/**
 * Derived from `MARK_COST` rather than written per tier, so repricing a tier moves
 * the badge with it. A Trinket costs nothing, and "0 marks" reads like a defect.
 */
export function badgeForTier(tier: Tier): string {
  const marks = MARK_COST[tier];
  if (marks === 0) return 'Free';
  return `${marks} mark${marks === 1 ? '' : 's'}`;
}

/** The full helper roster, in roster order — Majors, then Minors, then Trinkets. */
export function helperChoices(): QueueOptionChoice[] {
  return HELPERS.map((helper) => ({
    id: helper.id,
    label: helper.name,
    section: helper.tier,
    badge: badgeForTier(helper.tier),
    description: helper.blurb,
    locked: false,
  }));
}

/**
 * A roster a `preQueue` group can be picked from, keyed by the group's `kind`.
 *
 * `kind` is already on the manifest, so a second mode picking champions registers
 * `Champion` here and needs no change to the endpoint or the validator. The
 * messages live with the roster because they are in its own vocabulary — "helpers",
 * not "options" — and the contract's fixtures pin their wording.
 */
export interface OptionSource {
  choices: () => QueueOptionChoice[];
  /** Reason text when a selection has the wrong number of ids. */
  arityReason: (group: PreQueueGroup) => string;
  /** Reason text when a selection repeats an id. */
  duplicateReason: (group: PreQueueGroup) => string;
  /** Reason text when an id is not on the roster. */
  unknownReason: (id: string) => string;
}

/** Small counts read as words in the loadout's own copy; anything larger as digits. */
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

const LOADOUT_SOURCE: OptionSource = {
  choices: helperChoices,
  arityReason: (group) =>
    group.min === group.max
      ? `a loadout needs exactly ${group.min} helpers`
      : `a loadout needs between ${group.min} and ${group.max} helpers`,
  duplicateReason: (group) => `a loadout needs ${countWord(group.min)} different helpers`,
  unknownReason: (id) => `unknown helper: ${id}`,
};

const SOURCES: Record<string, OptionSource> = {
  Loadout: LOADOUT_SOURCE,
};

export function optionSourceFor(group: PreQueueGroup): OptionSource | undefined {
  return SOURCES[group.kind];
}

/**
 * Validate one group's selection against the group's own arity and its roster.
 *
 * Follows the repo's parse convention: the accepted ids on success, a
 * human-readable reason on failure, so the caller decides the status code (a 400,
 * never a 403 — see the contract §4).
 */
export function validateSelection(group: PreQueueGroup, optionIds: string[]): string[] | string {
  const source = optionSourceFor(group);
  if (!source) return `unknown pre-queue group kind: ${group.kind}`;

  if (optionIds.length < group.min || optionIds.length > group.max) {
    return source.arityReason(group);
  }
  for (const id of optionIds) {
    if (!source.choices().some((c) => c.id === id)) return source.unknownReason(id);
  }
  if (new Set(optionIds).size !== optionIds.length) return source.duplicateReason(group);
  return optionIds;
}
