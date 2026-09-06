import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type Move,
  type MatchState,
  type RoundResult,
  type Seat,
  type StatusResponse,
} from './api';
import { History } from './components/History';
import { LobbyReturnButton } from './components/LobbyReturnButton';
import { MovePicker } from './components/MovePicker';
import { PlayerAvatar } from './components/PlayerAvatar';
import { RevealCard } from './components/RevealCard';
import { getEnv, getLobbyLink, buildLobbyReturnLink, isDebugMode } from './env';
import { seatIdentity } from './lib/seatProfile';
import { useRoundReveal } from './lib/useRoundReveal';
import { opponentMoveFromResult, winningEdgeOf, winsNeeded } from './moves';
import { connectMatchSocket, type MatchSocket } from './ws';

const env = getEnv();
const lobbyLink = getLobbyLink();
// Developer chrome is opt-in; players get a clean screen.
const debug = isDebugMode();

/**
 * Full name on wide screens, "RPSLR" once it stops fitting. Both are hidden from
 * assistive tech so the spoken name stays the same at every width.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark__full" aria-hidden="true">
        Rock · Paper · Scissors · Lizard · Robot
      </span>
      <span className="wordmark__short" aria-hidden="true">
        RPSLR
      </span>
      <span className="sr-only">Rock Paper Scissors Lizard Robot</span>
    </span>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lobbyReturnBase, setLobbyReturnBase] = useState<string | null>(null);
  const [externalMatchId, setExternalMatchId] = useState<string | null>(null);
  const lobbyLinked = Boolean(lobbyLink.matchId && lobbyLink.token);
  // The claim screen owns the whole viewport, so the app header steps aside.
  const [claiming, setClaiming] = useState(lobbyLinked);
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
      {!claiming && (
        <header className="topbar">
          <h1>
            <Wordmark />
          </h1>
          {lobbyReturnUrl && (
            <a className="lobby-link" href={lobbyReturnUrl}>
              ← Back to Lobby
            </a>
          )}
        </header>
      )}

      {debug &&
        (lobbyLinked ? (
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
        ))}

      {debug && (
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
      )}

      <Game
        lobbyReturnUrl={lobbyReturnUrl}
        onClaimingChange={setClaiming}
        onLobbyReturn={(base, matchId) => {
          if (base) setLobbyReturnBase(base);
          if (matchId) setExternalMatchId(matchId);
        }}
      />

      {debug && (
        <footer className="footer">
          Frontend :5174 · API {env.GAME_API_BASE_URL}
          {lobbyReturnUrl && <> · Lobby {lobbyReturnUrl}</>}
        </footer>
      )}
    </div>
  );
}

type Phase = 'lobby' | 'playing';

function Game({
  lobbyReturnUrl,
  onClaimingChange,
  onLobbyReturn,
}: {
  lobbyReturnUrl: string | null;
  onClaimingChange: (claiming: boolean) => void;
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
  const [reconnecting, setReconnecting] = useState(false);
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
      onClose: () => setConnected(false),
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

  // Only surface the bar once we've been down for a beat, so the normal first
  // connect (and any quick blip) doesn't flash it.
  useEffect(() => {
    if (phase !== 'playing' || connected) {
      setReconnecting(false);
      return;
    }
    const timer = setTimeout(() => setReconnecting(true), 1000);
    return () => clearTimeout(timer);
  }, [phase, connected]);

  const claiming = Boolean(lobbyLink.matchId && lobbyLink.token) && phase === 'lobby';
  useEffect(() => {
    onClaimingChange(claiming);
  }, [claiming, onClaimingChange]);

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

  // Every Lobby player's first screen: the seat claim in flight.
  if (claiming) {
    return <ClaimScreen error={error} lobbyReturnUrl={lobbyReturnUrl} />;
  }

  if (phase === 'lobby') {
    return <Lobby busy={busy} error={error} onCreate={handleCreate} onJoin={handleJoin} />;
  }

  const myChosenMove =
    state && myPlayerId
      ? (lockedMove ?? state.currentRoundMoves[myPlayerId] ?? pendingMove)
      : (lockedMove ?? pendingMove);

  return (
    <>
      {reconnecting && (
        <div className="reconnect-bar" role="status">
          Reconnecting…
        </div>
      )}
      <Board
        myPlayerId={myPlayerId!}
        mySeatKey={mySeatKey!}
        state={state}
        connected={connected}
        error={error}
        myChosenMove={myChosenMove}
        onPlay={play}
      />
    </>
  );
}

export function ClaimScreen({
  error,
  lobbyReturnUrl,
}: {
  error: string | null;
  lobbyReturnUrl: string | null;
}) {
  return (
    <div className="claim-screen">
      <p className="claim-screen__mark">
        <Wordmark />
      </p>
      {error ? (
        <>
          <p className="error">{error}</p>
          {lobbyReturnUrl && <LobbyReturnButton href={lobbyReturnUrl} />}
        </>
      ) : (
        <>
          <span className="spinner" aria-hidden="true" />
          <p className="claim-screen__label" role="status">
            Joining your match…
          </p>
        </>
      )}
    </div>
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
      <p className="dev-caption full">Dev mode — real players arrive from the JoinQuest Lobby.</p>
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

/** Stable empty list so the reveal hook can run before the loading return. */
const NO_RESULTS: RoundResult[] = [];

export function Board({
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
  const { reveal, skip } = useRoundReveal(state?.results ?? NO_RESULTS);

  if (!state) return <p>Loading match…</p>;

  const { match, seats, results } = state;
  const mySeat = seats.find((s) => s.seatKey === mySeatKey) ?? null;
  const oppSeat = seats.find((s) => s.seatKey !== mySeatKey) ?? null;
  const you = seatIdentity(mySeat, 'You');
  const opponent = seatIdentity(oppSeat, 'Opponent');
  const finished = match.status === 'finished';
  const allSeated = seats.every((s) => s.player);
  const iWon = state.matchWinnerSeatKey === mySeatKey;
  const youMovedThisRound = Boolean(myChosenMove);
  const submitted =
    state.submittedPlayerIds ?? Object.keys(state.currentRoundMoves ?? {});
  const opponentLockedIn = submitted.some((id) => id !== myPlayerId);
  // Lobby players never see the create card, so round 1 is the only chance to
  // tell them the rules.
  const showRules = !finished && (!allSeated || match.currentRound <= 1);
  const myDelays = mySeat?.delays ?? {};
  const oppDelays = oppSeat?.delays ?? {};
  // Your last two picks, most recent first: explains exactly why each of your
  // moves is on cooldown, without inferring it from the mark count.
  const myRecentMoves = results
    .slice(-2)
    .reverse()
    .map((r) => r.moves[myPlayerId])
    .filter((m): m is Move => Boolean(m));
  const lobbyReturnUrl =
    match.lobbyReturnUrl != null
      ? buildLobbyReturnLink(match.lobbyReturnUrl, match.externalMatchId)
      : null;
  // The deciding round plays out before the match-end banner takes the screen.
  const revealingNow = reveal != null;
  const winner = state.matchWinnerSeatKey == null ? null : iWon ? you : opponent;
  // As the card dissolves, the graph asserts the same fact: the edge the round
  // was won on lights up underneath it. A drawn round has no edge.
  const revealPicks = reveal ? opponentMoveFromResult(reveal.result.moves, myPlayerId) : null;
  const winningEdge =
    reveal?.phase === 'outro' && revealPicks?.myMove && revealPicks.oppMove
      ? winningEdgeOf(revealPicks.myMove, revealPicks.oppMove)
      : null;

  return (
    <div className="board">
      {!match.externalMatchId && (
        <div className="match-head">
          <h2>{match.name}</h2>
          <p className="match-meta">
            Room code: <code className="room-code">{match.code}</code>
          </p>
        </div>
      )}

      {showRules && (
        <p className="rule-note rule-note--board">
          First to {winsNeeded(match.bestOf)} round wins · Lizard &amp; Robot start on cooldown
        </p>
      )}

      <Scoreboard
        seats={seats}
        mySeatKey={mySeatKey}
        submittedPlayerIds={submitted}
        bestOf={match.bestOf}
        pulseSeatKey={reveal && reveal.result.outcome !== 'draw' ? reveal.result.outcome : null}
      />

      {!allSeated && !finished && !revealingNow && (
        <p className="hint">Waiting for all seats to be filled…</p>
      )}

      {finished && !revealingNow ? (
        <div className="match-results">
          {winner && (
            <div className="match-results__winner">
              <PlayerAvatar
                profile={winner.profile}
                displayName={winner.name}
                placeholder={winner.placeholder}
                role={iWon ? 'you' : 'opp'}
                size="lg"
              />
              <span className="match-results__winner-name">{winner.name}</span>
            </div>
          )}
          <div className={`result-banner ${iWon ? 'win' : 'loss'}`}>
            {iWon ? '🏆 You win the match!' : 'You lost the match.'}
          </div>
          {lobbyReturnUrl && <LobbyReturnButton href={lobbyReturnUrl} />}
        </div>
      ) : (
        <div className="moves">
          <p className="round-label">
            {`Round ${match.currentRound} · You ${mySeat?.player?.score ?? 0} – ${
              oppSeat?.player?.score ?? 0
            }`}
          </p>
          {/* The slot is always here even when empty. The pentagon is the tap
              surface, so anything that appears above it mid-decision would
              shift the board under the player's thumb. */}
          <div className="board-status">
            {!youMovedThisRound && opponentLockedIn && !revealingNow && (
              <p className="hint opponent-ready" role="status">
                Opponent has locked in — pick your move!
              </p>
            )}
          </div>
          <MovePicker
            myDelays={myDelays}
            oppDelays={oppDelays}
            myChosenMove={myChosenMove}
            lockedIn={youMovedThisRound}
            opponentLockedIn={opponentLockedIn}
            disabled={!connected || !allSeated || youMovedThisRound || revealingNow}
            round={match.currentRound}
            myRecentMoves={myRecentMoves}
            onPlay={onPlay}
            winningEdge={winningEdge}
            centerSlot={
              reveal ? (
                <RevealCard
                  result={reveal.result}
                  phase={reveal.phase}
                  mySeatKey={mySeatKey}
                  myPlayerId={myPlayerId}
                  you={you}
                  opponent={opponent}
                  onSkip={skip}
                />
              ) : undefined
            }
          />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <History
        results={results}
        mySeatKey={mySeatKey}
        myPlayerId={myPlayerId}
        you={you}
        opponent={opponent}
        lobbyReturnUrl={finished && !revealingNow ? lobbyReturnUrl : null}
      />
    </div>
  );
}

function Scoreboard({
  seats,
  mySeatKey,
  submittedPlayerIds,
  bestOf,
  pulseSeatKey,
}: {
  seats: Seat[];
  mySeatKey: string;
  submittedPlayerIds: string[];
  bestOf: number;
  /** Seat that just took a round — its newest pip pulses once. */
  pulseSeatKey: string | null;
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
          justWon={seat.seatKey === pulseSeatKey}
        />
      ))}
    </div>
  );
}

function WinProgress({
  wins,
  needed,
  justWon,
}: {
  wins: number;
  needed: number;
  justWon: boolean;
}) {
  const capped = Math.min(wins, needed);
  return (
    <div
      className="win-pips"
      role="img"
      aria-label={`${capped} of ${needed} round wins${capped >= needed ? ', match point' : ''}`}
    >
      {Array.from({ length: needed }, (_, i) => {
        const filled = i < capped;
        const pulse = justWon && filled && i === capped - 1;
        return (
          <span
            key={i}
            className={[  'win-pip', filled ? 'filled' : 'empty', pulse ? 'win-pip--pulse' : '' ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

function SeatCard({
  seat,
  mine,
  winsNeeded: needed,
  showVs,
  lockedIn,
  justWon,
}: {
  seat: Seat;
  mine: boolean;
  winsNeeded: number;
  showVs: boolean;
  lockedIn: boolean;
  justWon: boolean;
}) {
  const seated = Boolean(seat.player);
  const reserved = Boolean(seat.reservedForLobbyUser);
  const waiting = !seated && reserved;
  const open = !seated && !reserved;
  const wins = seat.player?.score ?? 0;
  const identity = seatIdentity(seat, open ? 'Open seat' : mine ? 'You' : 'Opponent');

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
          profile={identity.profile}
          displayName={identity.name}
          placeholder={identity.placeholder}
          role={mine ? 'you' : 'opp'}
          dimmed={waiting}
          ready={lockedIn}
        />
        <span className="player-label">
          {mine ? 'You' : seat.role ?? 'Opponent'}
          {seat.teamKey ? ` · ${seat.teamKey}` : ''}
        </span>
        <span className="player-name">{identity.name}</span>
        {waiting && <span className="player-status">on their way</span>}
        <WinProgress wins={wins} needed={needed} justWon={justWon} />
      </div>
      {showVs && <span className="vs">vs</span>}
    </>
  );
}
