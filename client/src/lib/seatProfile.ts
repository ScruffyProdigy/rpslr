import type { LobbyPlayerProfile, Seat } from '../api';

export function seatProfile(seat: Seat): LobbyPlayerProfile | null {
  return seat.player?.profile ?? seat.lobbyProfile ?? null;
}

export function seatDisplayName(seat: Seat, fallback: string): string {
  const name = seat.player?.name ?? seatProfile(seat)?.displayName?.trim();
  return name || fallback;
}
