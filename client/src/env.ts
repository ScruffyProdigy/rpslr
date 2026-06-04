/** Runtime config injected via /env.js into window.env (Lobby-style pattern). */
export interface RuntimeEnv {
  GAME_APP_ENV: 'local' | 'staging' | 'production';
  GAME_API_BASE_URL: string;
  /** Optional explicit WebSocket base; derived from the API base when unset. */
  GAME_WS_BASE_URL?: string;
}

declare global {
  interface Window {
    env?: Partial<RuntimeEnv>;
  }
}

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
  };
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
 * Lobby links out to the game with query params (session cookies do not cross
 * origins). Launch URL from Lobby:
 *   {playUrl}?match=<externalMatchId>&token=<jwt>
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

/** Back-compat convenience used by the standalone UI. */
export function getLobbyUserFromUrl(search = window.location.search): string | null {
  return new URLSearchParams(search).get('lobby_user');
}
