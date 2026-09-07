import type { MatchState, Move } from './api';
import { getWebSocketUrl } from './env';

/**
 * Thin WebSocket client for live match updates. Subscribes to a match and
 * receives a `state` message on subscribe and after every change; can also send
 * moves over the same socket. Reconnects with backoff and re-subscribes.
 */
type StateHandler = (state: MatchState) => void;
type ErrorHandler = (message: string) => void;

export interface MatchSocket {
  /** Returns false if the socket is not connected (caller should use REST fallback). */
  sendMove: (playerId: string, move: Move, round: number) => boolean;
  close: () => void;
}

export function connectMatchSocket(
  ref: string,
  /**
   * Who this socket belongs to. The server counts it as presence, which is what
   * tells the idle policy that a silent player is thinking rather than gone.
   * Null before a seat is claimed; the socket still receives state.
   */
  playerId: string | null,
  handlers: {
    onState: StateHandler;
    onError?: ErrorHandler;
    onOpen?: () => void;
    /** Fired on an unexpected drop, before the backoff retry. */
    onClose?: () => void;
  },
): MatchSocket {
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let retry = 0;

  const connect = () => {
    ws = new WebSocket(getWebSocketUrl());

    ws.onopen = () => {
      retry = 0;
      ws?.send(JSON.stringify({ type: 'subscribe', ref, playerId }));
      handlers.onOpen?.();
    };

    ws.onmessage = (event) => {
      let msg: { type?: string; state?: MatchState; error?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'state' && msg.state) handlers.onState(msg.state);
      else if (msg.type === 'error' && msg.error) handlers.onError?.(msg.error);
    };

    ws.onclose = () => {
      if (closedByCaller) return;
      handlers.onClose?.();
      // Exponential backoff capped at 5s.
      retry += 1;
      const delay = Math.min(5000, 250 * 2 ** retry);
      setTimeout(connect, delay);
    };

    ws.onerror = () => ws?.close();
  };

  connect();

  return {
    sendMove(playerId: string, move: Move, round: number) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Naming the round keeps a move that arrives after its round resolved
        // from landing on the next one.
        ws.send(JSON.stringify({ type: 'move', playerId, move, round }));
        return true;
      }
      return false;
    },
    close() {
      closedByCaller = true;
      ws?.close();
    },
  };
}
