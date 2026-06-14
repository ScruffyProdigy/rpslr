import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Move, type MatchState, type Seat, type StatusResponse } from './api';
import { PlayerAvatar } from './components/PlayerAvatar';
import { getEnv, getLobbyLink, buildLobbyReturnLink } from './env';
import { seatDisplayName, seatProfile } from './lib/seatProfile';
import {
  MOVE_META,
  describeOutcome,
  describeRoundMatchup,
  opponentMoveFromResult,
  winsNeeded,
} from './moves';
import { connectMatchSocket, type MatchSocket } from './ws';

const env = getEnv();
const lobbyLink = getLobbyLink();

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lobbyReturnBase, setLobbyReturnBase] = useState<string | null>(null);
  const [externalMatchId, setExternalMatchId] = useState<string | null>(null);
  const lobbyLinked = Boolean(lobbyLink.matchId && lobbyLink.token);
  const lobbyReturnUrl =
    lobbyReturnBase != null
      ? buildLobbyReturnLink(lobbyReturnBase, externalMatchId ?? lobbyLink.matchId)
      : null;

  useEffect(() => {
    api.status().then(setStatus).catch((err) => setStatusError(err.message));
  }, []);

  // Provisioned matches expose lobby.returnUrl before claim (no extra query param).
  useEffect(() => {
    if (!lobbyLink.matchId) return;
    api
      .getState(lobbyLink.matchId)
      .then((s) => {
        if (s.match.lobbyReturnUrl) setLobbyReturnBase(s.match.lobbyReturnUrl);
        if (s.match.externalMatchId) setExternalMatchId(s.match.externalMatchId);
      })
      .catch(() => {});
  }, [lobbyLink.matchId]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>🪨📄✂️🦎🤖 Rock Paper Scissors Lizard Robot</h1>
        {lobbyReturnUrl && (
          <a className="lobby-link" href={lobbyReturnUrl}>
            ← Back to Lobby
          </a>
        )}
      </header>

      {lobbyLinked ? (
        <div className="banner banner--lobby" role="status">
          <strong>Connected via PlayHub Lobby.</strong> You'll be seated in your assigned slot.
        </div>
      ) : (
        status?.standalone && (
          <div className="banner banner--standalone" role="status">
            <strong>Standalone mode.</strong> Not signed in through PlayHub Lobby.
            {lobbyLink.lobbyUser && <> Playing as <strong>{lobbyLink.lobbyUser}</strong>.</>}
          </div>
        )
      )}

      <div className="status-row">
        {status ? (
          <span>
            API: <code>{status.game}</code> v{status.version} · env {status.appEnv}
          </span>
        ) : statusError ? (
          <span className="error">API unreachable: {statusError}</span>
        ) : (
          <span>Connecting to API…</span>
        )}
      </div>

      <Game
        onLobbyReturn={(base, matchId) => {
          if (base) setLobbyReturnBase(base);
          if (matchId) setExternalMatchId(matchId);
        }}
      />

      <footer className="footer">
        Frontend :5174 · API {env.GAME_API_BASE_URL}
        {lobbyReturnUrl && <> · Lobby {lobbyReturnUrl}</>}
      </footer>
    </div>
  );
}

type Phase = 'lobby' | 'playing';

function Game({
  onLobbyReturn,
}: {
  onLobbyReturn?: (returnUrl: string | null, externalMatchId: string | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>('lobby');
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mySeatKey, setMySeatKey] = useState<string | null>(null);
  const [ref, setRef] = useState<string | null>(null);
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pendingMove, setPendingMove] = useState<Move | null>(null);
  const [lockedMove, setLockedMove] = useState<Move | null>(null);
  const socketRef = useRef<MatchSocket | null>(null);
  const claimedRef = useRef(false);

  const enterMatch = useCallback(
    (result: { state: MatchState; you: { playerId: string; seatKey: string } }) => {
      setState(result.state);
      setMyPlayerId(result.you.playerId);
      setMySeatKey(result.you.seatKey);
      setRef(result.state.match.code);
      setPhase('playing');
      onLobbyReturn?.(result.state.match.lobbyReturnUrl, result.state.match.externalMatchId);
    },
    [onLobbyReturn],
  );

  // Lobby-linked entry: auto-claim the reserved seat using the signed token.
  // Guard against double-invocation (React StrictMode / re-renders) so we don't
  // fire two claims and trip a spurious "seat already taken".
  useEffect(() => {
    if (!lobbyLink.matchId || !lobbyLink.token) return;
    if (claimedRef.current) return;
    claimedRef.current = true;
    setBusy(true);
    api
      .claimSeatWithToken(lobbyLink.matchId, lobbyLink.token)
      .then(enterMatch)
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  }, [enterMatch]);

  // Live updates over WebSocket (replaces polling). Opens once we're in a match.
  useEffect(() => {
    if (phase !== 'playing' || !ref) return;
    const socket = connectMatchSocket(ref, {
      onState: setState,
      onError: (message) => {
        setPendingMove(null);
        setError(message);
      },
      onOpen: () => setConnected(true),
    });
    socketRef.current = socket;
    return () => {
      setConnected(false);
      socket.close();
      socketRef.current = null;
    };
  }, [phase, ref]);

  // Remember our pick for this round once the server lists us in submittedPlayerIds.
  useEffect(() => {
    if (!myPlayerId || !state) return;
    const submitted = state.submittedPlayerIds ?? [];
    if (!submitted.includes(myPlayerId)) return;
    const echoed = state.currentRoundMoves[myPlayerId];
    if (echoed) setLockedMove(echoed);
    else if (pendingMove) setLockedMove(pendingMove);
    setPendingMove(null);
  }, [state, myPlayerId, pendingMove]);

  useEffect(() => {
    if (state?.match.lobbyReturnUrl || state?.match.externalMatchId) {
      onLobbyReturn?.(state.match.lobbyReturnUrl, state.match.externalMatchId);
    }
  }, [state?.match.lobbyReturnUrl, state?.match.externalMatchId, onLobbyReturn]);

  const currentRound = state?.match.currentRound;
  useEffect(() => {
    setLockedMove(null);
    setPendingMove(null);
  }, [currentRound]);

  const submittedKey = state?.submittedPlayerIds?.join(',') ?? '';
  const matchStatus = state?.match.status;

  // If we're waiting on the opponent, poll so a missed WS push can't stall the match.
  useEffect(() => {
    if (phase !== 'playing' || !ref || !myPlayerId || !state) return;
    const submitted = state.submittedPlayerIds ?? Object.keys(state.currentRoundMoves ?? {});
    const mineSubmitted = submitted.includes(myPlayerId) || Boolean(lockedMove || pendingMove);
    const oppSubmitted = submitted.some((id) => id !== myPlayerId);
    if (!mineSubmitted || oppSubmitted || matchStatus === 'finished') return;

    const timer = setInterval(() => {
      api.getState(ref).then(setState).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [phase, ref, myPlayerId, submittedKey, matchStatus, lockedMove, pendingMove, state]);

  async function handleCreate(name: string, hostName: string) {
    setBusy(true);
    setError(null);
    try {
      // best 3 of 5 is fixed by the game mode; server applies the default.
      enterMatch(await api.createMatch({ name, hostName }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(code: string, playerName: string) {
    setBusy(true);
    setError(null);
    try {
      enterMatch(await api.claimSeat(code.trim().toUpperCase(), { playerName }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function play(move: Move) {
    if (!myPlayerId || !state || !ref) return;
    if (lockedMove || state.currentRoundMoves[myPlayerId] || pendingMove) return;
    setError(null);
    setPendingMove(move);
    const sent = socketRef.current?.sendMove(myPlayerId, move);
    if (sent) return;
    // Socket not ready — REST still publishes to the opponent over the hub.
    try {
      const next = await api.submitMove(ref, myPlayerId, move);
      setState(next);
      setLockedMove(next.currentRoundMoves[myPlayerId] ?? move);
      setPendingMove(null);
    } catch (err) {
      setPendingMove(null);
      setError((err as Error).message);
    }
  }

  // While the Lobby token claim is in flight, show a connecting state.
  if (lobbyLink.matchId && lobbyLink.token && phase === 'lobby') {
    return <p className="hint">{error ? <span className="error">{error}</span> : 'Joining your Lobby match…'}</p>;
  }

  if (phase === 'lobby') {
    return <Lobby busy={busy} error={error} onCreate={handleCreate} onJoin={handleJoin} />;
  }

  const myChosenMove =
    state && myPlayerId
      ? (lockedMove ?? state.currentRoundMoves[myPlayerId] ?? pendingMove)
      : (lockedMove ?? pendingMove);

  return (
    <Board
      myPlayerId={myPlayerId!}
      mySeatKey={mySeatKey!}
      state={state}
      connected={connected}
      error={error}
      myChosenMove={myChosenMove}
      onPlay={play}
    />
  );
}

function Lobby({
  busy,
  error,
  onCreate,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, hostName: string) => void;
  onJoin: (code: string, playerName: string) => void;
}) {
  const defaultName = lobbyLink.lobbyUser ?? '';
  const [hostName, setHostName] = useState(defaultName || 'Player 1');
  const [matchName, setMatchName] = useState('Friendly Match');
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState(defaultName || 'Player 2');

  return (
    <div className="grid">
      <section className="card">
        <h2>Create a match</h2>
        <label>
          Your name
          <input value={hostName} onChange={(e) => setHostName(e.target.value)} />
        </label>
        <label>
          Match name
          <input value={matchName} onChange={(e) => setMatchName(e.target.value)} />
        </label>
        <p className="rule-note">First to 3 round wins · Lizard &amp; Robot start on cooldown</p>
        <button disabled={busy} onClick={() => onCreate(matchName, hostName)}>
          Create match
        </button>
      </section>

      <section className="card">
        <h2>Join a match</h2>
        <label>
          Room code
          <input placeholder="RPS-XXXX" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
        </label>
        <label>
          Your name
          <input value={joinName} onChange={(e) => setJoinName(e.target.value)} />
        </label>
        <button disabled={busy || !joinCode} onClick={() => onJoin(joinCode, joinName)}>
          Join match
        </button>
      </section>

      {error && <p className="error full">{error}</p>}
    </div>
  );
}

function Board({
  myPlayerId,
  mySeatKey,
  state,
  connected,
  error,
  myChosenMove,
  onPlay,
}: {
  myPlayerId: string;
  mySeatKey: string;
  state: MatchState | null;
  connected: boolean;
  error: string | null;
  myChosenMove: Move | null;
  onPlay: (move: Move) => void;
}) {
  if (!state) return <p>Loading match…</p>;

  const { match, seats, results } = state;
  const finished = match.status === 'finished';
  const allSeated = seats.every((s) => s.player);
  const iWon = state.matchWinnerSeatKey === mySeatKey;
  const youMovedThisRound = Boolean(myChosenMove);
  const submitted =
    state.submittedPlayerIds ?? Object.keys(state.currentRoundMoves ?? {});
  const opponentLockedIn = submitted.some((id) => id !== myPlayerId);
  const myDelays = seats.find((s) => s.seatKey === mySeatKey)?.delays ?? {};
  const oppDelays = seats.find((s) => s.seatKey !== mySeatKey)?.delays ?? {};
  const lobbyReturnUrl =
    match.lobbyReturnUrl != null
      ? buildLobbyReturnLink(match.lobbyReturnUrl, match.externalMatchId)
      : null;

  return (
    <div className="board">
      <div className={`match-head${match.externalMatchId ? ' match-head--lobby' : ''}`}>
        {!match.externalMatchId && (
          <div>
            <h2>{match.name}</h2>
            <p className="match-meta">
              Room code: <code className="room-code">{match.code}</code>
            </p>
          </div>
        )}
        <span className={`live ${connected ? 'on' : 'off'}`} title="WebSocket connection">
          {connected ? '● live' : '○ connecting'}
        </span>
      </div>

      <Scoreboard
        seats={seats}
        mySeatKey={mySeatKey}
        submittedPlayerIds={submitted}
        bestOf={match.bestOf}
      />

      {!allSeated && !finished && <p className="hint">Waiting for all seats to be filled…</p>}

      {finished ? (
        <div className="match-results">
          <div className={`result-banner ${iWon ? 'win' : 'loss'}`}>
            {iWon ? '🏆 You win the match!' : 'You lost the match.'}
          </div>
          {lobbyReturnUrl && <LobbyReturnButton href={lobbyReturnUrl} />}
        </div>
      ) : (
        <div className="moves">
          <p className="round-label">Round {match.currentRound}</p>
          {!youMovedThisRound && opponentLockedIn && (
            <p className="hint opponent-ready">Opponent has locked in — pick your move!</p>
          )}
          <div className="move-circle-wrap">
            <MoveCircle
              myDelays={myDelays}
              oppDelays={oppDelays}
              myChosenMove={myChosenMove}
              lockedIn={youMovedThisRound}
              disabled={!connected || !allSeated || youMovedThisRound}
              onPlay={onPlay}
            />
          </div>
          <p className="dot-legend">
            <span className="legend-ring mine" aria-hidden="true" />
            you can play · <span className="legend-ring opp" aria-hidden="true" />
            opponent can play · <span className="dot mine">●</span> your cooldown ·{' '}
            <span className="dot opp">●</span> opponent cooldown
          </p>
          {youMovedThisRound && myChosenMove && (
            <p className="choice-locked" role="status">
              <span className="choice-locked__pick">
                {MOVE_META[myChosenMove].emoji} {MOVE_META[myChosenMove].label}
              </span>
              {' '}locked in —{' '}
              {opponentLockedIn ? 'revealing round…' : 'waiting for opponent…'}
            </p>
          )}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <History
        results={results}
        mySeatKey={mySeatKey}
        myPlayerId={myPlayerId}
        lobbyReturnUrl={finished ? lobbyReturnUrl : null}
      />
    </div>
  );
}

function LobbyReturnButton({ href }: { href: string }) {
  return (
    <a className="lobby-return-btn" href={href}>
      ← Back to Lobby
    </a>
  );
}

// Pentagon layout where each move beats the next two clockwise, so the "beats"
// arrows form the classic RPSLR pentagon + pentagram.
const CIRCLE_ORDER: Move[] = ['rock', 'scissors', 'lizard', 'paper', 'robot'];
const CIRCLE_SIZE = 380;
const CIRCLE_R = 128;
const ARROW_INSET = 58; // pull arrow endpoints off the buttons
// One vertex sits at the top, so the pentagon's bounding box is taller below center
// than above; nudge the layout center down so the shape reads centered in the square.
const CIRCLE_CENTER_Y = CIRCLE_SIZE / 2 + 12;

function circleNodePos(i: number) {
  const angle = (-90 + i * 72) * (Math.PI / 180); // start at top, go clockwise
  const cx = CIRCLE_SIZE / 2;
  return {
    x: cx + CIRCLE_R * Math.cos(angle),
    y: CIRCLE_CENTER_Y + CIRCLE_R * Math.sin(angle),
  };
}

const CIRCLE_EDGES: Array<{ from: number; to: number }> = (() => {
  const edges: Array<{ from: number; to: number }> = [];
  for (let i = 0; i < CIRCLE_ORDER.length; i++) {
    edges.push({ from: i, to: (i + 1) % CIRCLE_ORDER.length });
    edges.push({ from: i, to: (i + 2) % CIRCLE_ORDER.length });
  }
  return edges;
})();

function MoveCircle({
  myDelays,
  oppDelays,
  myChosenMove,
  lockedIn,
  disabled,
  onPlay,
}: {
  myDelays: Record<string, number>;
  oppDelays: Record<string, number>;
  myChosenMove: Move | null;
  lockedIn: boolean;
  disabled: boolean;
  onPlay: (move: Move) => void;
}) {
  return (
    <div
      className={`move-circle ${lockedIn ? 'move-circle--locked' : ''}`}
      style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
    >
      <svg
        className="move-arrows"
        width={CIRCLE_SIZE}
        height={CIRCLE_SIZE}
        viewBox={`0 0 ${CIRCLE_SIZE} ${CIRCLE_SIZE}`}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="rps-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#f5c518" />
          </marker>
        </defs>
        {CIRCLE_EDGES.map(({ from, to }, k) => {
          const a = circleNodePos(from);
          const b = circleNodePos(to);
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          return (
            <line
              key={k}
              x1={a.x + ux * ARROW_INSET}
              y1={a.y + uy * ARROW_INSET}
              x2={b.x - ux * ARROW_INSET}
              y2={b.y - uy * ARROW_INSET}
              stroke="#f5c518"
              strokeWidth={2}
              strokeOpacity={0.7}
              markerEnd="url(#rps-arrow)"
            />
          );
        })}
      </svg>
      {CIRCLE_ORDER.map((m, i) => {
        const pos = circleNodePos(i);
        const myDelay = myDelays[m] ?? 0;
        const oppDelay = oppDelays[m] ?? 0;
        const onCooldown = myDelay > 0;
        const selected = myChosenMove === m;
        const dimmed = lockedIn && !selected;
        const myAllowed = !lockedIn && myDelay === 0;
        const oppAllowed = !lockedIn && oppDelay === 0;
        return (
          <button
            key={m}
            className={[
              'move-btn',
              'circle',
              onCooldown ? 'cooldown' : '',
              myAllowed ? 'my-allowed' : '',
              oppAllowed ? 'opp-allowed' : '',
              selected ? 'selected' : '',
              dimmed ? 'dimmed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ left: pos.x, top: pos.y }}
            disabled={disabled || onCooldown}
            onClick={() => onPlay(m)}
            aria-label={MOVE_META[m].label}
            aria-pressed={selected}
            title={
              selected
                ? `${MOVE_META[m].label} — your choice this round`
                : onCooldown
                  ? `${MOVE_META[m].label} on cooldown: ${myDelay} delay mark(s)`
                  : lockedIn
                    ? 'Choice already locked in'
                    : MOVE_META[m].label
            }
          >
            {selected && <span className="choice-check" aria-hidden="true">✓</span>}
            <span className="delay-badge opp" title="opponent's cooldown this round">
              {oppDelay > 0 ? '•'.repeat(oppDelay) : ''}
            </span>
            <span className="emoji">{MOVE_META[m].emoji}</span>
            <span className="move-name">{MOVE_META[m].label}</span>
            <span className="delay-badge mine" title="your cooldown this round">
              {onCooldown ? '•'.repeat(myDelay) : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Scoreboard({
  seats,
  mySeatKey,
  submittedPlayerIds,
  bestOf,
}: {
  seats: Seat[];
  mySeatKey: string;
  submittedPlayerIds: string[];
  bestOf: number;
}) {
  const needed = winsNeeded(bestOf);
  return (
    <div className="scoreboard">
      {seats.map((seat, i) => (
        <SeatCard
          key={seat.id}
          seat={seat}
          mine={seat.seatKey === mySeatKey}
          winsNeeded={needed}
          showVs={i < seats.length - 1}
          lockedIn={Boolean(seat.player && submittedPlayerIds.includes(seat.player.id))}
        />
      ))}
    </div>
  );
}

function WinProgress({ wins, needed }: { wins: number; needed: number }) {
  const capped = Math.min(wins, needed);
  return (
    <div
      className="win-pips"
      role="img"
      aria-label={`${capped} of ${needed} round wins${capped >= needed ? ', match point' : ''}`}
    >
      {Array.from({ length: needed }, (_, i) => (
        <span key={i} className={`win-pip ${i < capped ? 'filled' : 'empty'}`} aria-hidden="true" />
      ))}
    </div>
  );
}

function SeatCard({
  seat,
  mine,
  winsNeeded: needed,
  showVs,
  lockedIn,
}: {
  seat: Seat;
  mine: boolean;
  winsNeeded: number;
  showVs: boolean;
  lockedIn: boolean;
}) {
  const profile = seatProfile(seat);
  const seated = Boolean(seat.player);
  const reserved = Boolean(seat.reservedForLobbyUser);
  const waiting = !seated && reserved;
  const open = !seated && !reserved;
  const wins = seat.player?.score ?? 0;
  const name = seated
    ? seat.player!.name
    : waiting
      ? seatDisplayName(seat, 'Opponent')
      : 'Open seat';

  return (
    <>
      <div
        className={[
          'player',
          mine ? 'you' : '',
          open ? 'waiting' : '',
          waiting ? 'player--reserved' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <PlayerAvatar
          profile={profile}
          displayName={name}
          highlight={mine}
          dimmed={waiting}
          ready={lockedIn}
        />
        <span className="player-label">
          {mine ? 'You' : seat.role ?? 'Opponent'}
          {seat.teamKey ? ` · ${seat.teamKey}` : ''}
        </span>
        <span className="player-name">{name}</span>
        {waiting && <span className="player-status">Joining…</span>}
        <WinProgress wins={wins} needed={needed} />
      </div>
      {showVs && <span className="vs">vs</span>}
    </>
  );
}

export function History({
  results,
  mySeatKey,
  myPlayerId,
  lobbyReturnUrl,
}: {
  results: MatchState['results'];
  mySeatKey: string;
  myPlayerId: string;
  lobbyReturnUrl?: string | null;
}) {
  if (results.length === 0) return lobbyReturnUrl ? <LobbyReturnFooter href={lobbyReturnUrl} /> : null;
  return (
    <div className="history">
      <h3>Round history</h3>
      <ul>
        {results.map((r) => {
          const verdict = describeOutcome(r.outcome, mySeatKey);
          const { myMove, oppMove } = opponentMoveFromResult(r.moves, myPlayerId);
          const verdictLabel =
            verdict === 'draw' ? 'Draw' : verdict === 'win' ? 'You won' : 'You lost';
          return (
            <li key={r.round} className={`history-row ${verdict}`}>
              <div className="history-row__head">
                <span>Round {r.round}</span>
                <span className="verdict">{verdictLabel}</span>
              </div>
              {myMove && oppMove && (
                <>
                  <p className="history-row__picks">
                    <span>
                      You {MOVE_META[myMove].emoji} {MOVE_META[myMove].label}
                    </span>
                    <span className="history-row__sep">·</span>
                    <span>
                      Opponent {MOVE_META[oppMove].emoji} {MOVE_META[oppMove].label}
                    </span>
                  </p>
                  <p className="history-row__matchup">{describeRoundMatchup(myMove, oppMove)}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {lobbyReturnUrl && <LobbyReturnFooter href={lobbyReturnUrl} />}
    </div>
  );
}

function LobbyReturnFooter({ href }: { href: string }) {
  return (
    <div className="history-lobby-return">
      <LobbyReturnButton href={href} />
    </div>
  );
}
