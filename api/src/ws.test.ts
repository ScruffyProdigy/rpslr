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
let repo: MemoryGameRepository;
let baseWsUrl: string;

beforeEach(async () => {
  const config = loadConfig({ GAME_APP_ENV: 'local' } as NodeJS.ProcessEnv);
  const hub = new MatchHub();
  repo = new MemoryGameRepository();
  service = new GameService(repo, { hub });
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
    await service.claimSeat(code, { seatKey: '2', name: 'Bob' });

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

describe('an unresolved ability firing never reaches the socket', () => {
  it('keeps a secret firing\'s target out of the pushed state until the round resolves', async () => {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 3,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['rust', 'copycat'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'watchful'] }] },
      ],
    });
    const code = created.state.match.code;
    const hostId = created.you.playerId;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    const challengerId = joined.you.playerId;

    const state = await service.getState(code);
    await repo.recordAbilityFiring({
      matchId: state.match.id,
      seatId: state.seats[0].id,
      round: 1,
      helperId: 'rust',
      target: 'paper',
      source: null,
});

    // The opponent's own socket, which is the one that would give the game away.
    const opponent = await open();
    send(opponent, { type: 'subscribe', ref: code });
    const snapshot = await waitFor(opponent, (m) => m.type === 'state');
    expect((snapshot.state as { abilityFirings: unknown[] }).abilityFirings).toEqual([]);
    // Holding Rust is public; the move it named is not, until the round is over.
    expect(JSON.stringify(snapshot)).not.toContain('"target"');

    // Play the round out; now it is history, and history is public.
    await service.submitMove(code, hostId, 'paper');
    const resolved = waitFor(
      opponent,
      (m) =>
        m.type === 'state' &&
        (m.state as { abilityFirings: unknown[] }).abilityFirings.length > 0,
    );
    await service.submitMove(code, challengerId, 'scissors');
    const after = await resolved;
    expect((after.state as { abilityFirings: unknown[] }).abilityFirings).toEqual([
      { round: 1, seatKey: '1', helperId: 'rust', target: 'paper', source: null },
    ]);

    opponent.close();
  });
});


/**
 * JQ-220's disclosure rule, asserted where it actually matters: on the bytes that
 * leave the server. The service-level test proves the projection is computed; this
 * one proves nothing else on the socket carries the secret out anyway.
 */
describe('WebSocket ability firings', () => {
  async function helpersMatch() {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 5,
      seats: [
        // Alice holds the secret card. JQ-209 made Quarantine public, so a fired
        // Quarantine reaches Bob's socket by design and cannot prove this rule.
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['rust', 'poker-face'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['quarantine', 'poker-face'] }] },
      ],
    });
    const code = created.state.match.code;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    return { code, alice: created.you.playerId, bob: joined.you.playerId };
  }

  it('never sends one seat an unresolved firing by the other', async () => {
    const { code, alice, bob } = await helpersMatch();

    const aliceWs = await open();
    const bobWs = await open();
    send(aliceWs, { type: 'subscribe', ref: code, playerId: alice });
    send(bobWs, { type: 'subscribe', ref: code, playerId: bob });
    await waitFor(aliceWs, (m) => m.type === 'state');
    await waitFor(bobWs, (m) => m.type === 'state');

    // Both waiters are armed before the firing goes out: one push fans out to both
    // sockets at once, and a listener attached afterwards would simply miss it.
    const bobPush = waitFor(bobWs, (m) => m.type === 'state');
    const alicePush = waitFor(
      aliceWs,
      (m) =>
        m.type === 'state' &&
        (m.state as { abilities: Record<string, { available: boolean }> }).abilities.rust
          ?.available === false,
    );

    // Alice deepens a cooldown in secret. Bob is about to be pushed the state.
    send(aliceWs, { type: 'fire', playerId: alice, helperId: 'rust', target: 'scissors' });

    const pushed = await bobPush;
    // Asserted on the raw payload: the guess must not be anywhere in it, under any
    // field name. Bob can read Alice's *loadout* — that is public — so the string
    // 'rust' is not the secret; the firing and its target are.
    const raw = JSON.stringify(pushed.state);
    expect(JSON.parse(raw).abilityFirings).toEqual([]);
    expect(raw).not.toContain('"target"');
    // Bob is told about his own charge and only his own.
    expect(Object.keys(JSON.parse(raw).abilities)).toEqual(['quarantine']);

    // Alice's own socket, by contrast, is told her charge is spent.
    expect(await alicePush).toBeTruthy();

    aliceWs.close();
    bobWs.close();
  });

  it('discloses the firing to both seats once the round resolves', async () => {
    const { code, alice, bob } = await helpersMatch();

    const bobWs = await open();
    send(bobWs, { type: 'subscribe', ref: code, playerId: bob });
    await waitFor(bobWs, (m) => m.type === 'state');

    send(bobWs, { type: 'fire', playerId: bob, helperId: 'quarantine', target: 'scissors' });
    await waitFor(
      bobWs,
      (m) =>
        m.type === 'state' &&
        (m.state as { abilities: Record<string, { available: boolean }> }).abilities.quarantine
          ?.available === false,
    );

    // Both hold a scissors-binding Major, so rock is what either can play.
    await service.submitMove(code, alice, 'rock');
    await service.submitMove(code, bob, 'rock');
    // Quarantine fires in public, so Alice is handed the round's window and the
    // round waits on her. She stands on Rock; the firing is disclosed either way.
    await service.submitMove(code, alice, 'rock');

    const resolved = await waitFor(
      bobWs,
      (m) => (m.state as { results: unknown[] }).results?.length === 1,
    );
    expect((resolved.state as { abilityFirings: unknown[] }).abilityFirings).toEqual([
      { round: 1, seatKey: '2', helperId: 'quarantine', target: 'scissors', source: null },
    ]);
    bobWs.close();
  });

  it('refuses a firing the seat has no right to make, without killing the socket', async () => {
    const { code, alice } = await helpersMatch();
    const ws = await open();
    send(ws, { type: 'subscribe', ref: code, playerId: alice });
    await waitFor(ws, (m) => m.type === 'state');

    send(ws, { type: 'fire', playerId: alice, helperId: 'thief', source: 'rock', target: 'rock' });
    const err = await waitFor(ws, (m) => m.type === 'error');
    expect(err.error).toContain("does not hold 'thief'");

    // Still usable afterwards.
    send(ws, { type: 'ping' });
    expect(await waitFor(ws, (m) => m.type === 'pong')).toBeTruthy();
    ws.close();
  });
});

/**
 * The mid-round sub-phase over the wire (JQ-150, generalised by JQ-239).
 *
 * The design rests on one claim: the opponent's committed move never leaves the
 * server before the round resolves. Asserting it against the socket payload
 * rather than against the service is the point — a state the client chooses not
 * to render is still bytes anyone can read off the connection.
 */
describe('Oracle reveals a move the opponent did not play, and nothing else', () => {
  async function oracleMatch() {
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 3,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'poker-face'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['rust', 'poker-face'] }] },
      ],
    });
    const code = created.state.match.code;
    const joined = await service.claimSeat(code, { seatKey: '2', name: 'Bob' });
    return { code, alice: created.you.playerId, bob: joined.you.playerId };
  }

  it("never puts the opponent's move on either socket before the round resolves", async () => {
    const { code, alice, bob } = await oracleMatch();

    const aliceWs = await open();
    const bobWs = await open();
    send(aliceWs, { type: 'subscribe', ref: code, playerId: alice });
    send(bobWs, { type: 'subscribe', ref: code, playerId: bob });
    await waitFor(aliceWs, (m) => m.type === 'state');
    await waitFor(bobWs, (m) => m.type === 'state');

    // Alice declares Oracle, both lock in, and the round stops.
    send(aliceWs, { type: 'fire', playerId: alice, helperId: 'oracle' });
    send(aliceWs, { type: 'move', playerId: alice, move: 'rock', round: 1 });
    send(bobWs, { type: 'move', playerId: bob, move: 'lizard', round: 1 });

    const hers = await waitFor(
      aliceWs,
      (m) => (m.state as { match: { phase: string } })?.match?.phase === 'react',
    );
    const state = hers.state as {
      entitlement: {
        round: number;
        reveals: { helperId: string; namedMove: string }[];
        incoming: unknown[];
        acted: boolean;
      } | null;
      currentRoundMoves: Record<string, string>;
      abilityFirings: unknown[];
      results: unknown[];
    };

    // She is told a move he did *not* play, and it is a move he could have.
    expect(state.entitlement!.round).toBe(1);
    expect(state.entitlement!.acted).toBe(false);
    // Her claim on the window is her own reveal; nothing was fired publicly at her.
    expect(state.entitlement!.incoming).toEqual([]);
    expect(state.entitlement!.reveals).toHaveLength(1);
    const named = state.entitlement!.reveals[0];
    expect(named.helperId).toBe('oracle');
    expect(named.namedMove).not.toBe('lizard');
    expect(['rock', 'paper', 'robot']).toContain(named.namedMove);
    // Her own pick comes back so she can decide whether to keep it; his does not.
    expect(state.currentRoundMoves).toEqual({ [alice]: 'rock' });
    expect(state.abilityFirings).toEqual([]);
    expect(state.results).toEqual([]);

    // And the payload as bytes: 'lizard' appears only as a delay-map key, never
    // as a value, so there is no reading of it that hands her his move.
    const values = Object.values(state.currentRoundMoves);
    expect(values).not.toContain('lizard');
    expect(JSON.stringify(state.entitlement)).not.toContain('lizard');

    // Bob's own socket is told nothing about the reveal — and, since Oracle is a
    // secret firing, is given no claim on the window either.
    const his = await waitFor(
      bobWs,
      (m) => (m.state as { match: { phase: string } })?.match?.phase === 'react',
    );
    expect((his.state as { entitlement: unknown }).entitlement).toBeNull();
    expect((his.state as { abilityFirings: unknown[] }).abilityFirings).toEqual([]);

    aliceWs.close();
    bobWs.close();
  });

  it("never puts one entitled seat's re-pick on the other's socket", async () => {
    // Two Oracles facing each other is a legal pairing, and JQ-239 makes it the
    // general case: everyone entitled decides at the same moment. Simultaneity is
    // the balance mechanism — a read that could be updated by watching the other
    // seat move would be exactly the certainty the window exists to prevent — so
    // it is asserted on the bytes that leave the server, not on the projection
    // that produces them.
    const created = await service.createStandaloneMatch({
      gameMode: 'duel-helpers',
      hostName: 'Alice',
      bestOf: 3,
      seats: [
        { seatKey: '1', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'poker-face'] }] },
        { seatKey: '2', options: [{ groupKey: 'helpers', optionIds: ['oracle', 'watchful'] }] },
      ],
    });
    const code = created.state.match.code;
    const alice = created.you.playerId;
    const bob = (await service.claimSeat(code, { seatKey: '2', name: 'Bob' })).you.playerId;

    const bobWs = await open();
    send(bobWs, { type: 'subscribe', ref: code, playerId: bob });
    await waitFor(bobWs, (m) => m.type === 'state');

    await service.fireAbility(code, alice, { helperId: 'oracle' });
    await service.fireAbility(code, bob, { helperId: 'oracle' });
    await service.submitMove(code, alice, 'rock');
    const opened = waitFor(
      bobWs,
      (m) => (m.state as { match: { phase: string } })?.match?.phase === 'react',
    );
    await service.submitMove(code, bob, 'rock');
    const before = (await opened).state as Record<string, unknown>;

    // Alice moves off rock. The waiter is registered first, because the publish is
    // synchronous with her commit.
    const next = waitFor(bobWs, (m) => m.type === 'state');
    await service.submitMove(code, alice, 'robot');
    const after = (await next).state as Record<string, unknown>;

    // Nothing he can read has moved. Compared against his own earlier payload
    // rather than scanned for the string 'robot': his reveal names a live move she
    // did not play, drawn against her *original* pick, so it may legitimately be
    // the very move she has just switched to — that staleness is the point.
    expect(after.currentRoundMoves).toEqual({ [bob]: 'rock' });
    expect(after.results).toEqual([]);
    expect(after.entitlement).toEqual(before.entitlement);
    expect((after.entitlement as { acted: boolean }).acted).toBe(false);
    expect(after.abilityFirings).toEqual([]);

    bobWs.close();
  });

  it('tells both sockets what Oracle named, once the round has resolved', async () => {
    const { code, alice, bob } = await oracleMatch();

    const bobWs = await open();
    send(bobWs, { type: 'subscribe', ref: code, playerId: bob });
    await waitFor(bobWs, (m) => m.type === 'state');

    await service.fireAbility(code, alice, { helperId: 'oracle' });
    await service.submitMove(code, alice, 'rock');
    await service.submitMove(code, bob, 'rock');
    // Keeping the pick: the round resolves, and the reveal stops being a secret.
    await service.submitMove(code, alice, 'rock');

    const resolved = await waitFor(
      bobWs,
      (m) => (m.state as { results: unknown[] })?.results?.length === 1,
    );
    const firings = (resolved.state as { abilityFirings: { helperId: string; target: string }[] })
      .abilityFirings;
    expect(firings).toHaveLength(1);
    expect(firings[0].helperId).toBe('oracle');
    // The move it named — a move Bob did not play — is now public to both.
    expect(firings[0].target).not.toBe('rock');
    expect((resolved.state as { entitlement: unknown }).entitlement).toBeNull();

    bobWs.close();
  });
});
