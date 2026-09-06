import type { LobbyPlayerProfile, Seat } from '../api';

export function seatProfile(seat: Seat): LobbyPlayerProfile | null {
  return seat.player?.profile ?? seat.lobbyProfile ?? null;
}

/**
 * Who is in a seat, as the board refers to them: a Lobby profile for the
 * avatar and a name to speak. `placeholder` means the Lobby has told us
 * nothing yet (a reserved seat before its player claims it) — the avatar then
 * renders as an empty disc rather than an initial of the word "Opponent".
 */
export interface Identity {
  profile: LobbyPlayerProfile | null;
  name: string;
  placeholder: boolean;
}

export function seatIdentity(seat: Seat | null, fallback: string): Identity {
  if (!seat) return { profile: null, name: fallback, placeholder: true };
  const profile = seatProfile(seat);
  const name = seat.player?.name ?? profile?.displayName?.trim() ?? '';
  return { profile, name: name || fallback, placeholder: !name };
}
