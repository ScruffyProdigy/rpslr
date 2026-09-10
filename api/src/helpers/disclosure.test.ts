import { describe, expect, it, vi } from 'vitest';

/**
 * The roster is faked here, and only here.
 *
 * It was faked because every card was `secret` and the public branch had nothing to
 * exercise it. That reason expired with JQ-209 — Freeze fires in public now — and
 * the fake is kept anyway, for a better reason than the original.
 *
 * `town-crier` is not a card and never will be. Binding these cases to a real one
 * would make this file's subject the roster rather than `disclosedFirings`, so it
 * would go red the next time a card's `reveal` is repriced — which is exactly the
 * churn JQ-209 spent its time on elsewhere. The branch exists so that the next card
 * to go public needs no service change; a synthetic stand-in is what keeps that
 * claim under test whatever the roster happens to hold.
 *
 * `subPhase.test.ts` fakes one for the same reason and says so there.
 */
vi.mock('./roster.js', () => ({
  firesInPublic: (id: string) => id === 'town-crier',
}));

const { disclosedFirings } = await import('./disclosure.js');

const round = (n: number, helperId: string) => ({ round: n, helperId });

describe('disclosedFirings', () => {
  it('withholds a secret firing until its round resolves', () => {
    const firings = [round(1, 'quarantine')];
    expect(disclosedFirings(firings, new Set())).toEqual([]);
    expect(disclosedFirings(firings, new Set([1]))).toEqual(firings);
  });

  it('shows a public firing from the moment it is fired', () => {
    const firings = [round(1, 'town-crier')];
    expect(disclosedFirings(firings, new Set())).toEqual(firings);
  });

  it('splits one round by card rather than withholding it as a block', () => {
    // The old rule was per round. This is the whole change: two firings in the
    // same unresolved round can now disclose differently.
    const firings = [round(2, 'quarantine'), round(2, 'town-crier')];
    expect(disclosedFirings(firings, new Set([1]))).toEqual([round(2, 'town-crier')]);
  });

  it('keeps resolved rounds public whatever the card says', () => {
    const firings = [round(1, 'quarantine'), round(1, 'town-crier')];
    expect(disclosedFirings(firings, new Set([1]))).toEqual(firings);
  });
});
