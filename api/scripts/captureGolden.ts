/**
 * Regenerate the `duel` byte-identity fixture.
 *
 *     npm run golden:duel
 *
 * Only run this to record a *deliberate* change to duel's rules, and say so in the
 * commit message. The fixture's whole value is that it was captured before the
 * loadout refactor; regenerating it to make a red test go green throws that away.
 */

import { writeFileSync } from 'node:fs';
import { captureGolden } from '../src/helpers/duelGolden.js';

const target = new URL('../src/helpers/__fixtures__/duelGolden.json', import.meta.url);
writeFileSync(target, JSON.stringify(await captureGolden(), null, 2) + '\n');
console.log('wrote', target.pathname);
