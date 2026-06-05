import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MatchHub } from './matchHub.js';
import { MemoryGameRepository } from './memoryRepository.js';
import { GameService } from './service.js';
import { attachWebsocketServer } from './ws.js';

let server: Server;
let service: GameService;
let baseWsUrl: string;

beforeEach(async () => {
  const config = loadConfig({ GAME_APP_ENV: 'local' } as NodeJS.ProcessEnv);
  const hub = new MatchHub();
  service = new GameService(new MemoryGameRepository(), { hub });
  const app = createApp(service, config);
  server = createServer(app);
  attachWebsocketServer(server, { service, hub, config });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseWsUrl = `ws://127.0.0.1:${port}/api/v1/ws`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function open(): Promise<WebSocket> {
  const ws = new WebSocket(baseWsUrl);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws: WebSocket, msg: unknown) {
  ws.send(JSON.stringify(msg));
}

/** Resolve with the first message whose parsed body satisfies `predicate`. */
function waitFor(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeoutMs);
    const onMessage = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

describe('WebSocket gameplay transport', () => {
  it('pushes a snapshot on subscribe', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice', bestOf: 1 });
    const code = created.state.match.code;

    const ws = await open();
    send(ws, { type: 'subscribe', ref: code });
    const msg = await waitFor(ws, (m) => m.type === 'state');
    expect((msg.state as { match: { code: string } }).match.code).toBe(code);
    ws.close();
  });

  it('broadcasts state to subscribers when a move is played over WS', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice', bestOf: 1 });
    const code = created.state.match.code;
    const hostId = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    const challengerId = joined.you.playerId;

    const host = await open();
    const challenger = await open();
    send(host, { type: 'subscribe', ref: code });
    send(challenger, { type: 'subscribe', ref: code });
    await waitFor(host, (m) => m.type === 'state');
    await waitFor(challenger, (m) => m.type === 'state');

    // Both players move over the socket (bidirectional channel).
    send(host, { type: 'move', playerId: hostId, move: 'rock' });
    send(challenger, { type: 'move', playerId: challengerId, move: 'scissors' });

    // The host receives the resolved, finished state via broadcast.
    const finished = await waitFor(
      host,
      (m) => m.type === 'state' && (m.state as { match: { status: string } }).match.status === 'finished',
    );
    expect((finished.state as { matchWinnerSeatKey: string }).matchWinnerSeatKey).toBe('1');

    host.close();
    challenger.close();
  });

  it('notifies the opponent when only one player has moved', async () => {
    const created = await service.createStandaloneMatch({ hostName: 'Alice', bestOf: 5 });
    const code = created.state.match.code;
    const hostId = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    const challengerId = joined.you.playerId;

    const host = await open();
    const challenger = await open();
    send(host, { type: 'subscribe', ref: code });
    send(challenger, { type: 'subscribe', ref: code });
    await waitFor(host, (m) => m.type === 'state');
    await waitFor(challenger, (m) => m.type === 'state');

    send(host, { type: 'move', playerId: hostId, move: 'rock' });

    const msg = await waitFor(
      challenger,
      (m) =>
        m.type === 'state' &&
        (m.state as { submittedPlayerIds?: string[] }).submittedPlayerIds?.includes(hostId),
    );
    const state = msg.state as { submittedPlayerIds: string[]; currentRoundMoves: Record<string, unknown> };
    expect(state.submittedPlayerIds).toEqual([hostId]);
    expect(state.currentRoundMoves).toEqual({});

    host.close();
    challenger.close();
  });

  it('errors when moving before subscribing', async () => {
    const ws = await open();
    send(ws, { type: 'move', playerId: 'x', move: 'rock' });
    const err = await waitFor(ws, (m) => m.type === 'error');
    expect(err.error).toMatch(/subscribe/);
    ws.close();
  });
});
