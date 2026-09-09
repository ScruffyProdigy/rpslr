/// <reference types="vitest/config" />
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The server's rules engine, as the client sees it.
 *
 * `api/src/game.ts` and `api/src/helpers/` are pure — no I/O, no express, no pg —
 * which is what makes them safe to bundle into the frontend. The replay reads them
 * rather than mirroring them: a helpers match's cooldowns depend on both loadouts,
 * and a second copy of that arithmetic is a second copy to keep in step (JQ-207).
 */
const GAME_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api/src');

/**
 * The api is written for NodeNext's `./foo.js` import style. TypeScript maps those
 * back to `.ts` on its own; Vite does not, so it is done here — and only for files
 * under `api/src`, so a dependency that legitimately ships a `.js` sibling is left
 * alone.
 */
function gameSourceExtensions(): Plugin {
  return {
    name: 'rpslr:game-source-extensions',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer?.startsWith(GAME_SRC + path.sep)) return null;
      if (!source.startsWith('.') || !source.endsWith('.js')) return null;
      return path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
    },
  };
}

// Game frontend runs on 5174 to avoid Lobby's 5173.
export default defineConfig({
  plugins: [gameSourceExtensions(), react()],
  resolve: {
    alias: { '@game': GAME_SRC },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
