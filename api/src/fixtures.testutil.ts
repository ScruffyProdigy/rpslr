/**
 * Reads the contract's golden bodies from `docs/fixtures/prequeue/`.
 *
 * The fixtures are the specification and the code is checked against them, never the
 * reverse, so tests load the files rather than keeping a copy — a fixture edited
 * without the code moving must fail, which it cannot do if the expectation is
 * transcribed into a test.
 *
 * Test-only, but not a `.test.ts` file: several suites share it.
 */
import { readFileSync } from 'node:fs';

export function prequeueFixture<T = unknown>(name: string): T {
  const url = new URL(`../../docs/fixtures/prequeue/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

/**
 * Compares a response body against a fixture the way the contract means
 * "byte-for-byte": same fields, same values, in the same order — but indifferent to
 * how the fixture file happens to be indented.
 */
export function serialize(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Walk a helpers match past its loadout reveal (JQ-149).
 *
 * A match whose seats brought loadouts opens on the `loadouts` phase rather than
 * on `pick`, so a test that submits a move without this is testing the reveal's
 * guard rather than whatever it meant to test. This is exactly what the client
 * sends — one ack per seat, as each player dismisses the sheet — so a setup that
 * calls it is still describing a real match rather than reaching around one.
 *
 * Structurally typed against the service so this file stays free of the import
 * cycle a `GameService` type would create with the suites that use it.
 */
export async function pastLoadoutReveal(
  service: { acknowledgeLoadouts(ref: string, playerId: string): Promise<unknown> },
  code: string,
  playerIds: string[],
): Promise<void> {
  for (const playerId of playerIds) await service.acknowledgeLoadouts(code, playerId);
}
