import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppConfig } from './config.js';
import type { MatchHub } from './matchHub.js';
import type { GameService } from './service.js';
import { viewSnapshotAs, type MatchSnapshot } from './matchView.js';

/**
 * Bidirectional gameplay transport. This is the platform default for a reason:
 * even though RPS only needs server→client pushes, games in general benefit
 * from a full duplex channel, so the template ships one.
 *
 * Endpoint: GET /api/v1/ws  (WebSocket upgrade)
 *
 * Client → server messages (JSON):
 *   { "type": "subscribe", "ref": "RPS-XXXX", "playerId": "..." }
 *       subscribe to live match state. `playerId` is optional but strongly
 *       encouraged: it is how the server knows this player is present, which is
 *       what separates "disconnected" from "slow" in the idle policy. A socket
 *       that omits it still receives state, it just never counts as presence.
 *   { "type": "move", "playerId": "...", "move": "rock", "round": 3 }
 *       submit a move. `round` is optional; when present a move whose round
 *       has already resolved is refused rather than landing on the next one.
 *   { "type": "fire", "playerId": "...", "helperId": "rust",
 *     "target": "paper", "source": "rock", "round": 3 }
 *       spend an ability charge on the round in progress. `target` and `source`
 *       are per-ability: Quarantine and Rust name one of the opponent's moves,
 *       Thief names one of each (`source` is yours), Sacrifice and Freeze name
 *       none. Its own message rather than a field on `move` because a firing may
 *       precede the pick it hedges against — and because JQ-150's Oracle has to
 *       fire, reveal, and only then be picked against. A firing is final; there
 *       is no withdraw message, by design.
 *   { "type": "ping" }
 *
 * Server → client messages (JSON):
 *   { "type": "state", "state": { ...MatchState } }   on subscribe + every change
 *   { "type": "error", "error": "..." }
 *   { "type": "pong" }
 *
 * State pushes come from the MatchHub, which the service writes to after ANY
 * mutation — so a move sent over REST still updates WS subscribers and vice versa.
 * What the hub carries is a snapshot; each socket projects it for the player it
 * holds presence for, so one seat's unresolved charge state never reaches the
 * other's client.
 */
export const WS_PATH = '/api/v1/ws';

interface ClientMessage {
  type?: string;
  ref?: string;
  playerId?: string;
  move?: string;
  /** Round the client believed it was playing; a stale one is refused. */
  round?: number;
  /** `fire`: which ability, and the move(s) it names. Validated server-side. */
  helperId?: string;
  target?: string;
  source?: string;
}

export function attachWebsocketServer(
  server: Server,
  deps: { service: GameService; hub: MatchHub; config: AppConfig },
): WebSocketServer {
  const { service, hub, config } = deps;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    // Same origin policy as REST CORS (browsers send Origin; tools may not).
    const origin = req.headers.origin;
    if (origin && !config.corsAllowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let unsubscribe: (() => void) | null = null;
    let ref: string | null = null;
    /** Whose presence this socket is holding, so we can release it on close. */
    let presentAs: { ref: string; playerId: string } | null = null;

    const releasePresence = () => {
      if (!presentAs) return;
      const { ref: r, playerId } = presentAs;
      presentAs = null;
      void service.markDisconnected(r, playerId).catch(() => {
        /* presence is best-effort; a failure here must not kill the socket */
      });
    };

    const send = (msg: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    // Projected per socket: `presentAs` is the only seat this connection may see
    // charges for, and an anonymous socket sees none rather than someone else's.
    const sendState = (snapshot: MatchSnapshot) =>
      send({ type: 'state', state: viewSnapshotAs(snapshot, presentAs?.playerId ?? null) });

    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send({ type: 'error', error: 'invalid JSON' });
      }

      try {
        switch (msg.type) {
          case 'subscribe': {
            if (!msg.ref) return send({ type: 'error', error: 'ref is required' });
            ref = msg.ref;
            // Presence is settled before the snapshot is read, so the immediate
            // state below is already projected for this player rather than
            // arriving charge-less and being corrected by the next push.
            if (msg.playerId !== presentAs?.playerId || msg.ref !== presentAs?.ref) {
              releasePresence();
              if (msg.playerId) {
                presentAs = { ref: msg.ref, playerId: msg.playerId };
                await service.markConnected(msg.ref, msg.playerId);
              }
            }
            const state = await service.getState(msg.ref, presentAs?.playerId ?? null);
            unsubscribe?.();
            unsubscribe = hub.subscribe(state.match.id, sendState);
            return send({ type: 'state', state }); // immediate snapshot
          }
          case 'move': {
            if (!ref) return send({ type: 'error', error: 'subscribe before moving' });
            if (!msg.playerId) return send({ type: 'error', error: 'playerId is required' });
            // The resulting state is broadcast via the hub to all subscribers.
            await service.submitMove(ref, msg.playerId, msg.move, msg.round);
            return;
          }
          case 'fire': {
            if (!ref) return send({ type: 'error', error: 'subscribe before firing' });
            if (!msg.playerId) return send({ type: 'error', error: 'playerId is required' });
            // Deliberately not echoed back beyond the state push the hub makes:
            // the firing seat learns its charge is spent from its own projection,
            // and the opponent's projection says nothing at all.
            await service.fireAbility(ref, msg.playerId, {
              helperId: msg.helperId,
              target: msg.target,
              source: msg.source,
              round: msg.round,
            });
            return;
          }
          case 'ping':
            return send({ type: 'pong' });
          default:
            return send({ type: 'error', error: `unknown message type: ${msg.type}` });
        }
      } catch (err) {
        return send({ type: 'error', error: (err as Error).message });
      }
    });

    ws.on('close', () => {
      unsubscribe?.();
      releasePresence();
    });
    ws.on('error', () => {
      unsubscribe?.();
      releasePresence();
    });
  });

  return wss;
}
