/**
 * Regenerate the pre-queue roster fixture from `roster.ts`.
 *
 *     npm run golden:queue-options
 *
 * `docs/fixtures/prequeue/README.md` has said this file is generated and must not
 * be hand-edited since it was written; until JQ-237 there was nothing to generate
 * it with, so "regenerate" meant editing 21 entries by hand and hoping. This is the
 * generator it names.
 *
 * Run it only for a *deliberate* roster change — a card added, renamed, repriced or
 * cut — and say which in the commit message. The fixture is the contract's
 * specification: regenerating it to make a red test go green is how a wire contract
 * changes without anyone deciding to change it.
 */

import { writeFileSync } from 'node:fs';
import { helperChoices } from '../src/helpers/queueOptions.js';

const body = { modeKey: 'duel-helpers', choices: helperChoices() };

const target = new URL(
  '../../docs/fixtures/prequeue/queue-options.duel-helpers.json',
  import.meta.url,
);
writeFileSync(target, JSON.stringify(body, null, 2) + '\n');
console.log('wrote', target.pathname, `(${body.choices.length} choices)`);
