import 'dotenv/config';

/** Centralized, validated runtime configuration for the game API. */
export interface AppConfig {
  appEnv: string;
  port: number;
  databaseUrl: string;
  corsAllowedOrigins: string[];
  requireLobbyAuth: boolean;
  /** Lobby user ids the game refuses to host. Lobby's push is rejected (403). */
  bannedLobbyUsers: string[];
  /**
   * Expected JWT `aud` values (game API origin). From GAME_API_AUDIENCE or
   * GAME_API_BASE_URL. Empty skips audience checks (tests only).
   */
  tokenAudiences: string[];
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Resolve the Postgres DSN. `DATABASE_URL` wins if set; otherwise it is derived
 * from the POSTGRES_* parts so POSTGRES_PORT is the single source of truth (e.g.
 * change just POSTGRES_PORT to avoid a host port collision in dev).
 */
function resolveDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const host = env.POSTGRES_HOST ?? 'localhost';
  const port = env.POSTGRES_PORT ?? '5433';
  const user = env.POSTGRES_USER ?? 'rps';
  const password = env.POSTGRES_PASSWORD ?? 'rps_dev_password';
  const db = env.POSTGRES_DB ?? 'rps_game';
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    appEnv: env.GAME_APP_ENV ?? 'local',
    port: Number(env.API_PORT ?? 3001),
    databaseUrl: resolveDatabaseUrl(env),
    corsAllowedOrigins: splitList(
      env.CORS_ALLOWED_ORIGINS ??
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174',
    ),
    requireLobbyAuth: (env.REQUIRE_LOBBY_AUTH ?? 'false') === 'true',
    bannedLobbyUsers: splitList(env.BANNED_LOBBY_USERS),
    tokenAudiences: splitList(env.GAME_API_AUDIENCE ?? env.GAME_API_BASE_URL),
  };
}

export const GAME_NAME = 'rock-paper-scissors-lizard-spock';
export const GAME_VERSION = '0.2.0';
