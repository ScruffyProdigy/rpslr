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
