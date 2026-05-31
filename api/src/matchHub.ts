import { EventEmitter } from 'node:events';
import type { MatchState } from './types.js';

/**
 * In-process pub/sub for live match updates, keyed by match id (uuid). The
 * service publishes the fresh state after any mutation; WebSocket connections
 * subscribe per match and forward it to the browser.
 *
 * NOTE: this is single-process. For multi-replica deployments, back this with a
 * fan-out (Redis pub/sub, NATS, Postgres LISTEN/NOTIFY). Documented as future
 * work — the interface stays the same.
 */
export type MatchListener = (state: MatchState) => void;

export class MatchHub {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Many sockets may watch a popular match; lift the default listener cap.
    this.emitter.setMaxListeners(0);
  }

  subscribe(matchId: string, listener: MatchListener): () => void {
    this.emitter.on(matchId, listener);
    return () => this.emitter.off(matchId, listener);
  }

  publish(matchId: string, state: MatchState): void {
    this.emitter.emit(matchId, state);
  }

  /** Number of active listeners for a match (handy in tests/metrics). */
  listenerCount(matchId: string): number {
    return this.emitter.listenerCount(matchId);
  }
}
