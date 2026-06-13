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
  /** Browser play URL for launch link minting (GAME_PLAY_URL). */
  playUrl: string;
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Lobby seat JWT `aud` is the game API origin (scheme + host), not an ingress path.
 * When only GAME_API_BASE_URL is set with a trailing `/api`, derive the origin for checks.
 */
export function apiOriginForAudience(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/api')) {
    return trimmed.slice(0, -4);
  }
  return trimmed;
}

/** Dedupe while preserving order. */
function uniqueOrigins(origins: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of origins) {
    if (!seen.has(o)) {
      seen.add(o);
      out.push(o);
    }
  }
  return out;
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
  const audienceRaw = env.GAME_API_AUDIENCE ?? env.GAME_API_BASE_URL ?? '';
  const tokenAudiences = uniqueOrigins(
    splitList(audienceRaw).map(apiOriginForAudience).filter(Boolean),
  );
  const explicitCors = env.CORS_ALLOWED_ORIGINS
    ? splitList(env.CORS_ALLOWED_ORIGINS)
    : splitList(
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174',
      );
  // Always allow this deployment's public API origin (browser UI on the same host).
  // Lobby catalog never lists CORS — each game derives self from GAME_API_AUDIENCE.
  const corsAllowedOrigins = uniqueOrigins([...explicitCors, ...tokenAudiences]);
  const playUrl =
    (env.GAME_PLAY_URL ?? '').trim() ||
    (tokenAudiences[0] ?? '').trim() ||
    'http://localhost:5174';

  return {
    appEnv: env.GAME_APP_ENV ?? 'local',
    port: Number(env.API_PORT ?? 3001),
    databaseUrl: resolveDatabaseUrl(env),
    corsAllowedOrigins,
    requireLobbyAuth: (env.REQUIRE_LOBBY_AUTH ?? 'false') === 'true',
    bannedLobbyUsers: splitList(env.BANNED_LOBBY_USERS),
    tokenAudiences,
    playUrl,
  };
}

export const GAME_NAME = 'rock-paper-scissors-lizard-robot';
export const GAME_VERSION = '0.2.0';
