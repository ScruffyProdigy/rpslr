/**
 * The game's own record of which browser holds which seat.
 *
 * This is recovery path 1 from the protocol handoff (§ *Reconnecting a player*):
 * on a successful claim the game writes a cookie **on its own origin** naming
 * the seat this browser took, and a later request that arrives with no
 * `?token=` — a refresh, the back button, a tab that crashed — is resumed from
 * it. No Lobby round trip, so it keeps working when Lobby is slow, unreachable,
 * or the player's Lobby session is gone. Path 2 (the Rejoin button) is the
 * independent fallback for when *this* is the half that is missing.
 *
 * ## Why the cookie needs no signature
 *
 * It carries `playerId`, which is already the game's gameplay credential: every
 * `/move` and `/fire` names it and nothing else. A forged binding therefore
 * needs a `playerId` the forger could only have by already being able to play
 * that seat, so the cookie grants nothing the client did not already hold. It
 * still names `sub` and `seatKey` alongside it, because the resume path checks
 * all three against the match before it resumes anything — the binding names a
 * seat, and the match stays the source of truth for whether that seat is live.
 *
 * `HttpOnly`, because only the server ever reads it. `SameSite=Lax`, because
 * the game's client and API are the same site in every environment (one host
 * with `/api` in production, two localhost ports in dev), so a same-site XHR
 * carries it and a cross-site POST from anywhere else does not.
 */

export const SEAT_BINDING_COOKIE = 'rpslr_seat';

/**
 * A day is longer than any RPSLR match and shorter than a browser session that
 * has plainly moved on. The binding is checked against the match on every use
 * anyway, so this only bounds how long a dead one lingers.
 */
const MAX_AGE_SECONDS = 12 * 60 * 60;

export interface SeatBinding {
  /** Lobby's id for the match — the join key on both sides of the protocol. */
  externalMatchId: string;
  seatKey: string;
  /** The verified `sub` from the seat token that claimed it. */
  lobbyUserId: string;
  /** The game's own player row, and the credential the client plays with. */
  playerId: string;
}

/** Short keys: this rides on every request to the game's own origin. */
interface WireBinding {
  m: string;
  s: string;
  u: string;
  p: string;
}

export function encodeSeatBinding(binding: SeatBinding): string {
  const wire: WireBinding = {
    m: binding.externalMatchId,
    s: binding.seatKey,
    u: binding.lobbyUserId,
    p: binding.playerId,
  };
  return Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
}

/** Null for anything that is not a binding we wrote — never a throw. */
export function decodeSeatBinding(raw: string | undefined | null): SeatBinding | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { m, s, u, p } = parsed as Partial<WireBinding>;
  if (!isNonEmpty(m) || !isNonEmpty(s) || !isNonEmpty(u) || !isNonEmpty(p)) return null;
  return { externalMatchId: m, seatKey: s, lobbyUserId: u, playerId: p };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Parse a `Cookie` header. Hand-rolled rather than pulling in `cookie-parser`:
 * one cookie is read, in one place, and the header format is a semicolon list.
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** The `Set-Cookie` value that writes the binding. */
export function seatBindingCookie(binding: SeatBinding, opts: { secure: boolean }): string {
  return [
    `${SEAT_BINDING_COOKIE}=${encodeSeatBinding(binding)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

/**
 * The `Set-Cookie` value that clears it. Sent when a binding names a seat the
 * match will not resume — a finished match, a seat someone else now holds — so
 * a browser stops presenting a binding that can never work again.
 */
export function clearSeatBindingCookie(opts: { secure: boolean }): string {
  return [
    `${SEAT_BINDING_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}
