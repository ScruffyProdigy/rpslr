/**
 * Which of a match's firings every viewer may see.
 *
 * Firing used to be uniformly secret, justified by Quarantine's argument
 * specifically — it names the move it fears, and an opponent who could read that
 * would simply play something else. That argument holds for Quarantine and for
 * Sacrifice, whose cost is that the opponent wastes a move on a round already
 * decided. It does not hold for Rust, Thief or Freeze: they land whatever the
 * opponent plays, so they would work identically in public.
 *
 * So the rule is per card, read from `reveal`, and lives here rather than in the
 * service: a card that goes public reaches this filter by being rewritten, instead
 * of by someone remembering that a comment in `service.ts` also needs rewriting.
 *
 * Server-side either way. A state payload the client chooses not to render is still
 * a payload anyone can read.
 */

import { firesInPublic } from './roster.js';

/** All this filter needs of a firing. `AbilityFiring` satisfies it. */
export interface DisclosableFiring {
  round: number;
  helperId: string;
}

/**
 * A resolved round's firings are public because the round is over. Before that, a
 * `public` firing is announced as it is fired — which is the whole point of the
 * classification, since it hands the seat it acts against something to answer — and
 * a `secret` one waits.
 */
export function disclosedFirings<T extends DisclosableFiring>(
  firings: readonly T[],
  resolvedRounds: ReadonlySet<number>,
): T[] {
  return firings.filter((f) => resolvedRounds.has(f.round) || firesInPublic(f.helperId));
}
