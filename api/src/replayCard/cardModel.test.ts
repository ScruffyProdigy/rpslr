import { describe, expect, it } from 'vitest';
import { buildCardModel, genericCardModel } from './cardModel.js';
import type { MatchState } from '../types.js';

/** A finished best-of-5: Ana (seat 1) 3, Ben (seat 2) 1, four rounds played. */
function finishedState(overrides: Partial<MatchState['match']> = {}): MatchState {
  return {
    match: {
      id: 'm1',
      code: 'RPS-ABCD',
      externalMatchId: 'ext-1',
      lobbyId: null,
      lobbyReturnUrl: null,
      lobbyGraphqlUrl: null,
      lobbyServiceToken: null,
      lobbyPlayerProfiles: {},
      name: 'Duel',
      gameMode: 'duel',
      status: 'finished',
      bestOf: 5,
      currentRound: 5,
      phase: null,
      phaseStartedAt: null,
      phaseDeadline: null,
      endReason: 'played',
      winnerSeatKey: '1',
      createdAt: '2026-09-07T00:00:00.000Z',
      ...overrides,
    },
    seats: [
      {
        id: 's1', matchId: 'm1', seatKey: '1', teamKey: null, role: null, position: 0,
        reservedForLobbyUser: null,
        lobbyProfile: { displayName: 'Ana', avatarUrl: 'https://lobby.test/ana.png' },
        player: { id: 'p1', name: 'Ana', lobbyUserId: 'u1', score: 3, profile: null, expiryStrikes: 0 },
        delays: {},
      },
      {
        id: 's2', matchId: 'm1', seatKey: '2', teamKey: null, role: null, position: 1,
        reservedForLobbyUser: null,
        lobbyProfile: { displayName: 'Ben', avatarUrl: null },
        player: { id: 'p2', name: 'Ben', lobbyUserId: 'u2', score: 1, profile: null, expiryStrikes: 0 },
        delays: {},
      },
    ],
    results: [
      { round: 1, outcome: '1', moves: { p1: 'rock', p2: 'scissors' }, autoPicked: [] },
      { round: 2, outcome: '2', moves: { p1: 'lizard', p2: 'rock' }, autoPicked: [] },
      { round: 3, outcome: 'draw', moves: { p1: 'paper', p2: 'paper' }, autoPicked: [] },
      { round: 4, outcome: '1', moves: { p1: 'robot', p2: 'rock' }, autoPicked: [] },
    ],
    submittedPlayerIds: [],
    currentRoundMoves: {},
    matchWinnerSeatKey: '1',
    serverNow: '2026-09-07T00:10:00.000Z',
  };
}

describe('buildCardModel', () => {
  it('states the result neutrally when nobody is named', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1' });
    expect(model.kind).toBe('match');
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
    expect(model.headline).toBe('Ana vs Ben · 3–1');
    expect(model.cacheable).toBe(true);
  });

  it('puts the winner first and marks them, whichever seat they took', () => {
    const state = finishedState({ winnerSeatKey: '2' });
    state.matchWinnerSeatKey = '2';
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.players.map((p) => p.name)).toEqual(['Ben', 'Ana']);
    expect(model.players[0].winner).toBe(true);
    expect(model.players[0].role).toBe('you');
    expect(model.players[1].role).toBe('opp');
  });

  it('celebrates when the sharer is the winner', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: '1' });
    expect(model.ogTitle).toBe('Ana wins 3–1!');
    expect(model.headline).toBe('Ana wins 3–1');
  });

  it('stays neutral when the sharer lost — a forwarded loss is not a scoreboard', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: '2' });
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
  });

  it('ignores a ?by= that names no seat in the match', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1', by: 'nonsense' });
    expect(model.ogTitle).toBe('Ana beat Ben 3–1 in RPSLR');
  });

  it('describes the match round by round, winner move first', () => {
    const model = buildCardModel(finishedState(), { ref: 'ext-1' });
    expect(model.ogDescription).toBe(
      '1 Rock over Scissors · 2 Rock over Lizard · 3 draw · 4 Robot over Rock',
    );
  });

  it('says a forfeit happened instead of inventing rounds', () => {
    const model = buildCardModel(finishedState({ endReason: 'forfeit-disconnect' }), { ref: 'ext-1' });
    expect(model.ogDescription).toBe('Ana won on forfeit after 4 rounds');
  });

  it('reads a drawn match as a draw', () => {
    const state = finishedState({ winnerSeatKey: null });
    state.matchWinnerSeatKey = 'draw';
    state.seats[0].player!.score = 2;
    state.seats[1].player!.score = 2;
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.ogTitle).toBe('Ana and Ben drew 2–2 in RPSLR');
    expect(model.headline).toBe('Ana vs Ben · 2–2');
    expect(model.players.every((p) => !p.winner)).toBe(true);
  });

  it('falls back to the generic card for an unfinished match', () => {
    const model = buildCardModel(finishedState({ status: 'playing' }), { ref: 'ext-1' });
    expect(model.kind).toBe('generic');
    expect(model.cacheable).toBe(false);
    expect(model.ogTitle).toBe('RPSLR on JoinQuest');
  });

  it('falls back to the generic card when there is no state at all', () => {
    const model = buildCardModel(null, { ref: 'missing' });
    expect(model).toEqual(genericCardModel('missing'));
  });

  it('takes the initial from the display name, and copes with one that has none', () => {
    const state = finishedState();
    state.seats[1].player!.name = '🙂';
    state.seats[1].lobbyProfile = { displayName: '🙂' };
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.players[0].initial).toBe('A');
    expect(model.players[1].initial).toBe('');
  });

  it('truncates a long description on a separator', () => {
    const state = finishedState();
    state.results = Array.from({ length: 40 }, (_, i) => ({
      round: i + 1,
      outcome: '1' as const,
      moves: { p1: 'rock' as const, p2: 'scissors' as const },
      autoPicked: [],
    }));
    const model = buildCardModel(state, { ref: 'ext-1' });
    expect(model.ogDescription.length).toBeLessThanOrEqual(200);
    expect(model.ogDescription.endsWith('…')).toBe(true);
    expect(model.ogDescription).not.toMatch(/ · …$/);
  });
});
