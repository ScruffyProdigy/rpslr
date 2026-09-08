/**
 * Re-validation of the pre-queue selections that arrive on provision.
 *
 * The lobby validated these already against the roster this game served this
 * player, so a rejection here should be unreachable in practice — it means one side
 * has a bug. The check stays anyway, for the same reason the game never trusts a
 * client: a lobby that could report helper state could report a win. The lobby's
 * validation is the good UX; this one is the authority.
 *
 * @see docs/prequeue-options-contract.md §4
 */

import type { GameModeManifest, PreQueueGroup } from './gameModes.js';
import { parseLoadout, type Loadout } from './helpers/loadout.js';
import { validateSelection } from './helpers/queueOptions.js';
import type { AssignmentSeat, SeatOptionSelection } from './tokens.js';

/**
 * What a seat gets when provision omits `options`: exactly RPSLR's `duel` opening
 * (Robot 2 marks, Lizard 1), so a defaulted `duel-helpers` match plays like the mode
 * it grew out of rather than like an arbitrary pairing.
 *
 * A narrow safety net, not the deploy mechanism — it covers standalone play, the
 * stub-lobby harness, and provisions that omit options for a reason neither side
 * anticipated. `REQUIRE_PREQUEUE_OPTIONS=true` closes it once real selections arrive.
 */
export const DEFAULT_LOADOUT_IDS = ['ferrus', 'featherweight'] as const;

/** The body of a 400. `seatKey` is for diagnosis: a rejection fails the whole match. */
export interface PreQueueRejection {
  error: string;
  seatKey: string;
  reason: string;
}

export interface ResolvedSelection {
  seatKey: string;
  groupKey: string;
  optionIds: string[];
  /** True when the seat sent nothing and took `DEFAULT_LOADOUT_IDS`. */
  defaulted: boolean;
}

export function isPreQueueRejection(
  result: ResolvedSelection[] | PreQueueRejection,
): result is PreQueueRejection {
  return !Array.isArray(result);
}

function reject(seatKey: string, reason: string): PreQueueRejection {
  return { error: 'invalid pre-queue selection', seatKey, reason };
}

/** The ids this game defaults `group` to, or null if it has no sensible default. */
function defaultIdsFor(group: PreQueueGroup): string[] | null {
  return group.kind === 'Loadout' ? [...DEFAULT_LOADOUT_IDS] : null;
}

/**
 * Resolve every seat's selections for `mode`.
 *
 * A mode with no `preQueue` resolves to nothing and ignores any `options` it was
 * sent: the lobby only sends them for a mode whose manifest declares the block, so
 * their presence on `duel` is the lobby's bug to fix rather than this game's to
 * enforce, and failing the provision would take a playable match down with it.
 *
 * Seats are checked in order and the first failure wins, because a 400 fails the
 * whole provision — there is no salvaging the other seats to report.
 */
export function resolvePreQueueOptions(
  mode: GameModeManifest,
  seats: AssignmentSeat[],
  opts: { require: boolean },
): ResolvedSelection[] | PreQueueRejection {
  const groups = mode.preQueue?.groups ?? [];
  if (groups.length === 0) return [];

  const resolved: ResolvedSelection[] = [];
  for (const seat of seats) {
    const sent = seat.options ?? [];
    for (const selection of sent) {
      if (!groups.some((g) => g.key === selection.groupKey)) {
        return reject(seat.seatKey, `unknown pre-queue group: ${selection.groupKey}`);
      }
    }

    for (const group of groups) {
      const match: SeatOptionSelection | undefined = sent.find((s) => s.groupKey === group.key);

      if (!match) {
        if (opts.require) {
          return reject(seat.seatKey, `pre-queue selection is required for ${group.key}`);
        }
        const fallback = defaultIdsFor(group);
        if (!fallback) {
          return reject(seat.seatKey, `pre-queue selection is required for ${group.key}`);
        }
        resolved.push({
          seatKey: seat.seatKey,
          groupKey: group.key,
          optionIds: fallback,
          defaulted: true,
        });
        continue;
      }

      const checked = validateSelection(group, match.optionIds);
      if (typeof checked === 'string') return reject(seat.seatKey, checked);
      resolved.push({
        seatKey: seat.seatKey,
        groupKey: group.key,
        optionIds: checked,
        defaulted: false,
      });
    }
  }
  return resolved;
}

/**
 * The `Loadout` a seat's resolved selections compile to, or null for a mode that
 * asks for no loadout at all — which is `duel`, and is the null loadout rather than
 * a special case in the engine.
 *
 * `parseLoadout` cannot fail on input `resolvePreQueueOptions` already accepted, so
 * a failure here means the two disagree about what a valid selection is. That is a
 * wiring bug and it throws, rather than quietly seating a player with no helpers.
 */
export function seatLoadout(
  mode: GameModeManifest,
  selections: ResolvedSelection[],
  seatKey: string,
): Loadout | null {
  const group = mode.preQueue?.groups.find((g) => g.kind === 'Loadout');
  if (!group) return null;
  const picked = selections.find((s) => s.seatKey === seatKey && s.groupKey === group.key);
  if (!picked) return null;

  const loadout = parseLoadout(picked.optionIds);
  if (typeof loadout === 'string') {
    throw new Error(`resolved selection failed parseLoadout: ${loadout}`);
  }
  return loadout;
}
