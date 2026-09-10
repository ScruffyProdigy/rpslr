import { describe, expect, it, vi } from 'vitest';

/**
 * The roster is faked here, and only here.
 *
 * Every card on the real roster is `secret` today (JQ-235 changes no card's
 * behaviour), so the public branch has no card to exercise it. Testing it against a
 * stand-in is the difference between "this works" and "this compiles" — the branch
 * exists precisely so that the next card to go public needs no service change, and
 * an untested branch would not deliver that.
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
