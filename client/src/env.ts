/** Runtime config injected via /env.js into window.env (Lobby-style pattern). */
export interface RuntimeEnv {
  GAME_APP_ENV: 'local' | 'staging' | 'production';
  GAME_API_BASE_URL: string;
  /** Optional explicit WebSocket base; derived from the API base when unset. */
  GAME_WS_BASE_URL?: string;
  /** The game's page on JoinQuest — where a replay sends a watcher to play. */
  GAME_LOBBY_URL?: string;
}

declare global {
  interface Window {
    env?: Partial<RuntimeEnv>;
  }
}

/**
 * Where "Play RPSLR on JoinQuest" goes. The same page in every environment
 * unless someone is pointing a deployment at a different Lobby, so it is a
 * default rather than something each overlay has to remember to set.
 */
const DEFAULT_LOBBY_GAME_URL = 'https://joinquest.cc/games/rock-paper-scissors-lizard-robot';

const defaults: RuntimeEnv = {
  GAME_APP_ENV: 'local',
  GAME_API_BASE_URL: 'http://localhost:3001',
};

export function getEnv(): RuntimeEnv {
  const w = typeof window !== 'undefined' ? window.env ?? {} : {};
  return {
    GAME_APP_ENV: (w.GAME_APP_ENV as RuntimeEnv['GAME_APP_ENV']) ?? defaults.GAME_APP_ENV,
    GAME_API_BASE_URL: w.GAME_API_BASE_URL ?? defaults.GAME_API_BASE_URL,
    GAME_WS_BASE_URL: w.GAME_WS_BASE_URL,
    GAME_LOBBY_URL: w.GAME_LOBBY_URL,
  };
}

/**
 * The game's own page on JoinQuest. The entrypoint always writes the key, so
 * an unset ConfigMap value arrives as an empty string rather than as absent —
 * blank has to mean "not configured", not "link to nowhere".
 */
export function getLobbyGameUrl(env: RuntimeEnv = getEnv()): string {
  return env.GAME_LOBBY_URL?.trim() || DEFAULT_LOBBY_GAME_URL;
}

/**
 * WebSocket endpoint for live gameplay. Uses GAME_WS_BASE_URL when provided,
 * otherwise derives it from the API base (http→ws, https→wss). The server
 * mounts the socket at /api/v1/ws so it routes through the same ingress prefix.
 */
export function getWebSocketUrl(env: RuntimeEnv = getEnv()): string {
  // Note: `||` (not `??`) so an empty-string GAME_WS_BASE_URL (the env.js
  // default) falls back to the API base instead of producing a relative URL.
  const base = (env.GAME_WS_BASE_URL || env.GAME_API_BASE_URL).replace(/\/$/, '');
  const wsBase = base.replace(/^http(s?):\/\//, (_m, s) => `ws${s}://`);
  return `${wsBase}/api/v1/ws`;
}

/**
 * Game returns launch URL bases on provision; Lobby attaches the seat JWT:
 *   {launchUrlBase}&token=<jwt>
 *
 * Query-style (RPS): {playUrl}/?match=<externalMatchId>&seat=<seatKey>
 *
 * "Back to Lobby" uses `{lobby.returnUrl}?match={externalMatchId}` from provision.
 * See lobbyReturn.ts for the canonical link builder.
 */
export interface LobbyLink {
  matchId: string | null;
  token: string | null;
  seat: string | null;
  lobbyUser: string | null;
}

export { buildLobbyReturnLink } from './lobbyReturn';

export function getLobbyLink(search = window.location.search): LobbyLink {
  const params = new URLSearchParams(search);
  return {
    matchId: params.get('match'),
    token: params.get('token'),
    seat: params.get('seat'),
    lobbyUser: params.get('lobby_user'),
  };
}

/**
 * Developer chrome (API/env readouts, footer, mode banners) is opt-in via
 * `?debug=1` so players never see it.
 */
export function isDebugMode(search = window.location.search): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

/** Back-compat convenience used by the standalone UI. */
export function getLobbyUserFromUrl(search = window.location.search): string | null {
  return new URLSearchParams(search).get('lobby_user');
}
