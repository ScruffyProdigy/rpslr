/**
 * Who is currently holding a live socket for a match.
 *
 * The idle policy needs to tell "absent" apart from "slow": a player whose
 * connection has been gone past the grace period forfeits without waiting out
 * further rounds, while a player who is merely thinking does not. Nothing else
 * in the server knew who was connected — the WebSocket layer had no player
 * identity at all — so this is that missing piece.
 *
 * In-process and deliberately not persisted, like MatchHub: a restart drops
 * every socket anyway, and everyone reconnects. Same caveat too — a multi-
 * replica deployment would need this backed by a shared store.
 *
 * @see roundPolicy.decidePenalty
 */

interface PlayerPresence {
  /** Open sockets for this player. A player may have several tabs. */
  connections: number;
  /** Epoch ms the last socket closed, or null while any is open. */
  disconnectedSince: number | null;
}

export class PresenceTracker {
  private readonly byMatch = new Map<string, Map<string, PlayerPresence>>();

  constructor(private readonly now: () => number = Date.now) {}

  connect(matchId: string, playerId: string): void {
    const entry = this.entry(matchId, playerId);
    entry.connections += 1;
    entry.disconnectedSince = null;
  }

  disconnect(matchId: string, playerId: string): void {
    const entry = this.entry(matchId, playerId);
    // Guard against a close arriving for a socket already accounted for; going
    // negative would leave the player permanently "connected".
    entry.connections = Math.max(0, entry.connections - 1);
    if (entry.connections === 0 && entry.disconnectedSince === null) {
      entry.disconnectedSince = this.now();
    }
  }

  /**
   * Epoch ms this player's last socket closed, or null if they are connected —
   * or if we have never seen them. Unknown must read as present: a player using
   * the REST endpoints alone has no socket, and must not be forfeited for it.
   */
  disconnectedSince(matchId: string, playerId: string): number | null {
    return this.byMatch.get(matchId)?.get(playerId)?.disconnectedSince ?? null;
  }

  /** Drop a finished match's bookkeeping. */
  forget(matchId: string): void {
    this.byMatch.delete(matchId);
  }

  private entry(matchId: string, playerId: string): PlayerPresence {
    let players = this.byMatch.get(matchId);
    if (!players) {
      players = new Map();
      this.byMatch.set(matchId, players);
    }
    let entry = players.get(playerId);
    if (!entry) {
      entry = { connections: 0, disconnectedSince: null };
      players.set(playerId, entry);
    }
    return entry;
  }
}
