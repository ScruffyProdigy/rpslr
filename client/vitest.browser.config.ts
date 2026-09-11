/// <reference types="vitest/config" />
/**
 * The board's layout regression suite, in a real browser (JQ-158).
 *
 * Separate from `npm test` on purpose. `boardFit.test.ts` already evaluates the
 * real `min()`/`clamp()` arithmetic out of `styles.css`, which holds the two
 * constraints most likely to break silently without paying for a browser — so
 * the browser suite is for what *only* layout can answer: rendered tap-target
 * boxes, `container-type: inline-size` (which jsdom does not implement at all),
 * whether a pill appearing moves the board, and whether a card's contents fit
 * inside it.
 *
 * Vitest browser mode rather than a standalone Playwright runner: it reuses the
 * project's own Vite config — the `@game` alias, the api's `.js` → `.ts`
 * resolution — so a board test imports exactly what the app imports. Playwright
 * is here only as the browser provider.
 */
import { defineConfig } from 'vite';
import base from './vite.config';

// The Vite half verbatim — the `@game` alias and the api's `.js` → `.ts`
// resolution are exactly what the app builds with, and a layout test that
// resolved imports differently would be testing a different board. Only `test`
// is replaced: `mergeConfig` concatenates arrays, so the base's `exclude` (which
// names these very files) would survive into this run and match everything.
const { test: _jsdom, ...vite } = base;

export default defineConfig({
  ...vite,
  test: {
    include: ['src/**/*.browser.test.{ts,tsx}'],
    globals: true,
    // The real stylesheet is the subject: `css: false` would stub the import
    // and leave every element unstyled.
    css: true,
    browser: {
      enabled: true,
      provider: 'playwright',
      name: 'chromium',
      headless: true,
      screenshotFailures: false,
      // The widest phone the board claims to support. Each test narrows it
      // further with `page.viewport()`.
      viewport: { width: 390, height: 844 },
    },
  },
});
