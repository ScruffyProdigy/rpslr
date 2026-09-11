import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every live region the client ships, and why each one is the shape it is.
 *
 * Three separate tickets have now re-derived this list from `grep` — JQ-157,
 * JQ-194, and the audit that produced JQ-194 — so it is written down here, next
 * to the assertions that keep it honest. Adding a region to the app without
 * adding it below fails `the ledger is the whole list`, which is the point: a
 * live region is a decision about interrupting someone, and the cheapest place
 * to notice one is being made is the moment it is made.
 *
 * Two findings run through the whole ledger, both from JQ-157:
 *
 *  1. **A region mounted in the same tick as its content is not reliably
 *     announced.** Screen readers watch an existing region for changes; one
 *     that arrives already full often says nothing. So a region that has to
 *     appear and disappear is hoisted onto a wrapper that outlives it — the
 *     picker's centre slot, the board's status slot, the history strip's detail
 *     line — or, where no permanent parent exists, it mounts empty and fills on
 *     the commit after, which is `MatchEndCard`'s case.
 *  2. **Regions do not nest.** A region inside a region double-announces, so
 *     `PickerCenter`, `RevealCard` and the board's hints all carry no role of
 *     their own and render into a slot that has one.
 *
 * The third, added by JQ-194: **a region attached to something that changes on
 * a timer talks on that timer.** `HowToPlayGraph`'s caption did, every 2.5
 * seconds, for as long as two players took to sit down.
 */
const LEDGER = [
  {
    file: 'App.tsx',
    anchor: 'banner banner--lobby',
    why: 'The debug banner. Says which match the page is on; changes only on a reconnect.',
  },
  {
    file: 'App.tsx',
    anchor: 'banner banner--standalone',
    why: 'Same banner, standalone mode. One of the two is rendered, never both.',
  },
  {
    file: 'App.tsx',
    anchor: 'reconnect-bar',
    why: 'The socket dropped. Interrupting is the point — the board is not live.',
  },
  {
    file: 'App.tsx',
    anchor: 'claim-screen__label',
    why: 'Claim progress. The one thing happening on a screen with nothing else on it.',
  },
  {
    file: 'App.tsx',
    anchor: 'className="hint"',
    why: 'The pre-match lead-in. Mounts with its text and is never updated, so it is a label that happens to carry a role rather than a region doing any work.',
  },
  {
    file: 'App.tsx',
    anchor: 'board-status',
    why: "The board's status slot. Permanent even when empty — it is also what stops the pentagon moving under a thumb — so the four hints inside it announce as changes to a region that was already there (JQ-194).",
  },
  {
    file: 'App.tsx',
    anchor: 'error--picker',
    why: 'The only assertive region in the app. A move that did not reach the server has to interrupt; nothing else here does.',
  },
  {
    file: 'components/MovePicker.tsx',
    anchor: 'picker-slot',
    why: "The board's voice: prompt, preview caption, wait, round result. Outlives the picker → reveal swap, which is what put the round result on the reliable path (JQ-157).",
  },
  {
    file: 'components/MatchEndCard.tsx',
    anchor: 'match-end__verdict',
    why: 'The match result. This card replaces the whole board, so there is no permanent parent to inherit from: the verdict line is the region, and its text arrives a commit after it does (JQ-194).',
  },
  {
    file: 'components/RoundStrip.tsx',
    anchor: 'history-strip__detail',
    why: 'The verb line for a tapped round. Rendered empty when no chip is open, so the line is a change rather than a new region (JQ-194).',
  },
  {
    file: 'components/HowToPlayGraph.tsx',
    anchor: 'htp-graph__caption',
    why: 'The teaching caption. Live only while the carousel is paused, because it advances on a 2.5s interval and a live caption announced the panel on that interval for the whole pre-match wait (JQ-194).',
  },
  {
    file: 'components/SubPhasePrompt.tsx',
    anchor: 'subphase-prompt',
    why: 'A window opening on your turn. Time-bounded, so it has to be heard rather than found.',
  },
  {
    file: 'components/ShareReplayButton.tsx',
    anchor: 'share-replay__status',
    why: 'Copied / shared / failed. Answers a button press, which is the case a polite region is for.',
  },
  {
    file: 'components/ReplayCommentary.tsx',
    anchor: 'replay-commentary__say',
    why: 'The replay narrating itself. A watcher is not deciding anything, so there is nothing to talk over.',
  },
  {
    file: 'components/RoundTimer.tsx',
    anchor: 'round-timer',
    why: 'Explicitly OFF. The seconds tick once a second; announcing them would make the board unusable. The number is there to read on demand, and expiry is announced by the reveal.',
  },
] as const;

const SRC = resolve(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path)) return [];
    return [path];
  });
}

/**
 * Comments discuss these attributes constantly — `RevealCard`'s doc comment is
 * mostly about the one it does not have — so only shipped markup is read.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Anything that makes an element speak, or deliberately stops it. */
const LIVE_ATTRIBUTE = /\b(?:aria-live|aria-atomic)=|\brole="(?:status|alert|log|timer|marquee)"/g;

/**
 * The JSX opening tag around `at`. Walks back to the `<` that starts it and
 * forward to the `>` that closes it, ignoring anything inside a `{…}`
 * expression so a template literal full of braces does not end the tag early.
 */
function enclosingTag(source: string, at: number): string {
  let open = at;
  while (open > 0 && !(source[open] === '<' && /[A-Za-z]/.test(source[open + 1] ?? ''))) open--;
  let depth = 0;
  let close = open;
  while (close < source.length) {
    const ch = source[close];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) break;
    close++;
  }
  return source.slice(open, close + 1);
}

/** Every element in shipped source carrying a live-region attribute, once each. */
function regions(): Array<{ file: string; tag: string }> {
  const found: Array<{ file: string; tag: string }> = [];
  for (const path of sourceFiles(SRC)) {
    const source = stripComments(readFileSync(path, 'utf8'));
    const file = relative(SRC, path);
    for (const match of source.matchAll(LIVE_ATTRIBUTE)) {
      const tag = enclosingTag(source, match.index ?? 0);
      // One element, two attributes (role and aria-live together) is one region.
      if (!found.some((f) => f.file === file && f.tag === tag)) found.push({ file, tag });
    }
  }
  return found;
}

describe('the live-region ledger (JQ-194)', () => {
  it('is the whole list — nothing announces that is not written down above', () => {
    const unledgered = regions()
      .filter(({ file, tag }) => !LEDGER.some((e) => e.file === file && tag.includes(e.anchor)))
      .map(({ file, tag }) => `${file}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
    expect(unledgered).toEqual([]);
  });

  it('has nothing written down that is no longer there', () => {
    const live = regions();
    const stale = LEDGER.filter(
      (e) => !live.some(({ file, tag }) => file === e.file && tag.includes(e.anchor)),
    ).map((e) => `${e.file}: ${e.anchor}`);
    expect(stale).toEqual([]);
  });

  it('explains every entry, because the why is the part that goes stale', () => {
    expect(LEDGER.filter((e) => e.why.length < 40)).toEqual([]);
  });
});

describe('the shapes the ledger depends on (JQ-157, JQ-194)', () => {
  const read = (file: string) => stripComments(readFileSync(join(SRC, file), 'utf8'));

  it('keeps the role on the permanent wrapper, not on the hints inside it', () => {
    // Each hint is rendered only while its condition holds, so a role on one is
    // mounted in the same tick as its text. `.board-status` is there either way.
    const app = read('App.tsx');
    const slot = app.slice(app.indexOf('<div className="board-status"'));
    const body = slot.slice(0, slot.indexOf('<MovePicker'));
    expect(body).toContain('className="board-status" role="status"');
    expect(body.match(/role="status"/g)).toHaveLength(1);
  });

  it('leaves the centre slot the only region on the board', () => {
    // A second one nested inside would say the round result twice.
    for (const file of ['components/RevealCard.tsx']) {
      expect(read(file)).not.toMatch(/role="(?:status|alert)"|aria-live=/);
    }
    const picker = read('components/MovePicker.tsx');
    expect(picker.slice(picker.indexOf('function PickerCenter'))).not.toMatch(
      /role="(?:status|alert)"|aria-live=/,
    );
  });

  it('lets the match result mount its region before its text', () => {
    // The card replaces the board, so the region cannot be inherited from
    // anywhere: it has to arrive empty and fill on the commit after.
    const card = read('components/MatchEndCard.tsx');
    expect(card).toMatch(/useState\(''\)/);
    expect(card).toMatch(/useEffect\(\(\) => \{\s*setSaid\(verdict\);\s*\}, \[verdict\]\)/);
    expect(card).toContain('role="status"');
  });

  it('silences the teaching caption while it is advancing itself', () => {
    const graph = read('components/HowToPlayGraph.tsx');
    expect(graph).toContain(`aria-live={paused ? 'polite' : 'off'}`);
    // The pause has to be set before the click that moves the graph, or the
    // first announcement lands in the same commit that made the region live.
    expect(graph).toContain('onFocus={() => setPaused(true)}');
    expect(graph).toContain('onPointerDown={() => setPaused(true)}');
  });

  it('keeps the timer explicitly quiet', () => {
    expect(read('components/RoundTimer.tsx')).toContain(`aria-live="off"`);
  });
});
