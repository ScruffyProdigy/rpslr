import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { lobbyJwksUrl } from './lobbyIssuer.js';

/**
 * A Lobby-issued assignment token binds a specific Lobby user to a specific
 * seat in a specific match. Lobby owns matchmaking; it signs these tokens and
 * the game verifies them using JWKS at `{iss}/.well-known/jwks.json`.
 *
 * The game uses the push model (option 2): Lobby provisions the match
 * server-to-server first, then links each user with a token that *proves who
 * they are* so they can only claim their own reserved seat. The token does not
 * carry the roster — the pushed match is the source of truth.
 *
 * Expected JWT claims:
 *   iss        -> Lobby issuer URL (same value as provision `lobbyId`)
 *   aud        -> this game's API origin (e.g. http://localhost:3001)
 *   sub        -> lobby user id
 *   matchId    -> Lobby session / external match id
 *   seatKey    -> the seat reserved for this user
 *   name       -> display name (optional; overrides provision profile)
 *   jti, nbf, iat, exp -> standard time / uniqueness claims
 */
import type { LobbyPlayerProfile } from './lobbyProfile.js';

export interface AssignmentSeat {
  seatKey: string;
  team?: string;
  role?: string;
  lobbyUserId: string;
  /** Optional presentation data from Lobby at provision time. */
  player?: LobbyPlayerProfile;
}

export interface AssignmentClaims {
  /** JWT `iss` — must match the match's provisioned `lobbyId`. */
  lobbyIssuer: string;
  lobbyUserId: string;
  externalMatchId: string;
  seatKey: string;
  displayName?: string;
}

export class TokenError extends Error {}

/** Pluggable so tests can inject a fake verifier instead of hitting JWKS. */
export interface TokenVerifier {
  verify(token: string): Promise<AssignmentClaims>;
}

export function claimsFromPayload(payload: JWTPayload): AssignmentClaims {
  const sub = payload.sub;
  const matchId = (payload.matchId ?? payload.match_id) as string | undefined;
  const seatKey = (payload.seatKey ?? payload.seat_key) as string | undefined;
  const iss = payload.iss;
  if (typeof iss !== 'string' || !iss.trim()) {
    throw new TokenError('token missing iss');
  }
  if (!sub || !matchId || !seatKey) {
    throw new TokenError('token missing sub/matchId/seatKey');
  }
  return {
    lobbyIssuer: iss.trim(),
    lobbyUserId: sub,
    externalMatchId: matchId,
    seatKey,
    displayName: (payload.name ?? payload.displayName) as string | undefined,
  };
}

/**
 * Verifies seat JWTs using each token's `iss` claim to locate the Lobby JWKS.
 * No per-environment Lobby URL is configured on the game server.
 */
export class IssuerJwksTokenVerifier implements TokenVerifier {
  constructor(private readonly audiences: string[] = []) {}

  private jwksFor(issuer: string) {
    const key = lobbyJwksUrl(issuer);
    let jwks = this.jwksByIssuer.get(key);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(key));
      this.jwksByIssuer.set(key, jwks);
    }
    return jwks;
  }

  async verify(token: string): Promise<AssignmentClaims> {
    let issuer: string;
    try {
      const unverified = decodeJwt(token);
      if (typeof unverified.iss !== 'string' || !unverified.iss.trim()) {
        throw new TokenError('token missing iss');
      }
      issuer = unverified.iss.trim();
    } catch (err) {
      if (err instanceof TokenError) throw err;
      throw new TokenError('invalid lobby token');
    }

    try {
      const verifyOpts: { issuer: string; audience?: string | string[] } = { issuer };
      if (this.audiences.length > 0) {
        verifyOpts.audience =
          this.audiences.length === 1 ? this.audiences[0] : this.audiences;
      }
      const { payload } = await jwtVerify(token, this.jwksFor(issuer), verifyOpts);
      return claimsFromPayload(payload);
    } catch (err) {
      if (err instanceof TokenError) throw err;
      throw new TokenError('invalid lobby token');
    }
  }
}

export function createTokenVerifier(audiences: string[] = []): TokenVerifier {
  return new IssuerJwksTokenVerifier(audiences);
}
