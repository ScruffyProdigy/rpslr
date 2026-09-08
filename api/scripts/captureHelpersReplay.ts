/**
 * Regenerate the `duel-helpers` replay fixture the frontend is checked against.
 *
 *     npm run golden:helpers-replay
 *
 * Safe to re-run whenever a helper's rules deliberately change: this is a sample
 * match, not the byte-identity contract `golden:duel` maintains.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHelpersReplay } from '../src/helpers/helpersReplayFixture.js';

const target = new URL('../../docs/fixtures/replay/duel-helpers.json', import.meta.url);
mkdirSync(dirname(fileURLToPath(target)), { recursive: true });
writeFileSync(target, JSON.stringify(await captureHelpersReplay(), null, 2) + '\n');
console.log('wrote', target.pathname);
