import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { rulesForSeats, type SeatLoadout } from '@game/replayBoard';
import {
  api,
  type Move,
  type MatchState,
  type RoundResult,
  type Seat,
  type StatusResponse,
} from './api';
import { AbilityRail, type FiringChoice } from './components/AbilityRail';
import { History } from './components/History';
import { HowToPlay, HowToPlayDialog } from './components/HowToPlay';
import { LobbyReturnButton } from './components/LobbyReturnButton';
import { MatchEndCard } from './components/MatchEndCard';
import { MovePicker } from './components/MovePicker';
import { SubPhasePrompt } from './components/SubPhasePrompt';
import { RoundTimer } from './components/RoundTimer';
import { PlayerAvatar } from './components/PlayerAvatar';
import { RevealCard } from './components/RevealCard';
import { getEnv, getLobbyLink, buildLobbyReturnLink, isDebugMode } from './env';
import { seatIdentity } from './lib/seatProfile';
import { useRoundDeadline, type RoundDeadline } from './lib/useRoundDeadline';
import { useFirstMatchRules } from './lib/useFirstMatchRules';
import { useRoundReveal } from './lib/useRoundReveal';
import { buildReplayUrl, buildStoryImageUrl, replayRef } from './lib/replayLink';
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
/** A seat that brought no helpers — the duel opening, and the `b` side we ignore. */
const NO_LOADOUT: SeatLoadout = { loadout: null, loadoutRoll: null };

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
  // The rules are reachable for the whole match, not just the wait before it,
  // and open themselves once on a player's very first match.
  const [bestOf, setBestOf] = useState(5);
  const [allSeated, setAllSeated] = useState(false);
  const rules = useFirstMatchRules(allSeated);
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
          <div className="topbar__actions">
            {/* Back to Lobby comes first: its ← used to sit directly right of
                the ? and point at it, so the arrow read as that button's
                label. The rules button is last, and says what it does. */}
            {lobbyReturnUrl && (
              <a className="lobby-link" href={lobbyReturnUrl}>
                {/* Same short/full swap as the wordmark, for the same reason:
                    at 390px the full label leaves the topbar row 7.7px of
                    slack, so a slightly larger text setting wrapped it to two
                    lines. The spoken name stays "Back to Lobby" at every
                    width. */}
                <span aria-hidden="true">←</span>{' '}
                <span className="lobby-link__full" aria-hidden="true">
                  Back to Lobby
                </span>
                <span className="lobby-link__short" aria-hidden="true">
                  Lobby
                </span>
                <span className="sr-only">Back to Lobby</span>
              </a>
            )}
            <button
              type="button"
              className="rules-btn"
              aria-label="How to play"
              onClick={() => rules.setOpen(true)}
            >
              <span className="rules-btn__mark" aria-hidden="true">
                ?
              </span>
              <span className="rules-btn__label" aria-hidden="true">
                How to play
              </span>
            </button>
          </div>
        </header>
      )}

      <HowToPlayDialog bestOf={bestOf} open={rules.open} onClose={rules.dismiss} />

      {debug &&
        (lobbyLinked ? (
          <div className="banner banner--lobby" role="status">
            <strong>Connected via JoinQuest Lobby.</strong> You'll be seated in your assigned slot.
          </div>
        ) : (
          status?.standalone && (
            <div className="banner banner--standalone" role="status">
              <strong>Standalone mode.</strong> Not signed in through JoinQuest Lobby.
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
        onBestOf={setBestOf}
        onAllSeated={setAllSeated}
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
  onBestOf,
  onAllSeated,
  onLobbyReturn,
}: {
  lobbyReturnUrl: string | null;
  onClaimingChange: (claiming: boolean) => void;
  /** So the header's how-to-play panel can say "first to 3" and mean it. */
  onBestOf: (bestOf: number) => void;
  /** Both seats filled — the cue for the first-match rules to open themselves. */
  onAllSeated: (allSeated: boolean) => void;
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
    const socket = connectMatchSocket(ref, myPlayerId, {
      onState: setState,
      onError: (message) => {
        setPendingMove(null);
        // Losing the race to the deadline is the expected outcome of the
        // auto-commit, not something to shout about in red.
        if (!isLateMoveConflict(message)) setError(message);
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
  }, [phase, ref, myPlayerId]);

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

  const matchBestOf = state?.match.bestOf;
  useEffect(() => {
    if (matchBestOf) onBestOf(matchBestOf);
  }, [matchBestOf, onBestOf]);

  const everySeatFilled = Boolean(state?.seats.every((s) => s.player));
  useEffect(() => {
    onAllSeated(everySeatFilled);
  }, [everySeatFilled, onAllSeated]);

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
    // The double-commit guard has to stay for the pick phase, so the sub-phase
    // re-pick is an explicit exception rather than a loosening of it: an entitled
    // seat's move is *replaced* there, and re-sending the one they had is how they
    // say "keep it".
    const repicking = mayRepick(state);
    if (!repicking && (lockedMove || state.currentRoundMoves[myPlayerId] || pendingMove)) return;
    setError(null);
    // Otherwise the picker would keep showing the pick being replaced: the locked
    // move wins over the pending one when the board decides what you chose.
    if (repicking) setLockedMove(null);
    setPendingMove(move);
    const round = state.match.currentRound;
    const sent = socketRef.current?.sendMove(myPlayerId, move, round);
    if (sent) return;
    // Socket not ready — REST still publishes to the opponent over the hub.
    try {
      const next = await api.submitMove(ref, myPlayerId, move, round);
      setState(next);
      setLockedMove(next.currentRoundMoves[myPlayerId] ?? move);
      setPendingMove(null);
    } catch (err) {
      setPendingMove(null);
      if (!isLateMoveConflict((err as Error).message)) setError((err as Error).message);
    }
  }

  /**
   * Spend a charge on the round being played.
   *
   * Socket first with the REST route as fallback, exactly as `play` does — either
   * path publishes to the opponent through the hub. Optimistic only in the one
   * respect that matters for a second tap: the rail closes immediately, so the
   * one-per-round rule is not left to a round-trip to enforce.
   */
  async function fire(choice: FiringChoice) {
    if (!myPlayerId || !state || !ref) return;
    setError(null);
    const round = state.match.currentRound;
    const sent = socketRef.current?.sendFire(myPlayerId, choice, round);
    if (sent) return;
    try {
      setState(await api.fireAbility(ref, myPlayerId, { ...choice, round }));
    } catch (err) {
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
        onFire={fire}
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

/**
 * The move we auto-committed arrived after the server had already picked for
 * us. Both repositories reject the duplicate with this message and the server's
 * pick stands, which is the designed outcome — surfacing it as a red error at
 * the exact moment the round resolves would be alarming and useless.
 *
 * Matched on the message because that is all the transport carries; the string
 * is fixed in `api/src/repository.ts` callers and asserted in the API tests.
 */
function isLateMoveConflict(message: string): boolean {
  return (
    message.includes('move already submitted for this round') ||
    message.includes('round has already moved on') ||
    message.includes('match is already finished')
  );
}

/**
 * Whether this viewer may replace their pick in the round's sub-phase.
 *
 * Every clause is load-bearing. `entitlement` is seat-private, so its presence is
 * what separates a seat that may re-pick from one whose move `submitMove` refuses
 * ("your move is locked while the round resolves"). The round check is why
 * `Entitlement` carries a round: a claim that outlived its sub-phase must not
 * reopen the next round's pick. And `acted` is the server's own record of having
 * answered — inferred nowhere, because a seat that re-picked the move it already
 * had is indistinguishable from one that has not answered.
 */
function mayRepick(state: MatchState): boolean {
  const claim = state.entitlement;
  return (
    state.match.phase === 'react' &&
    claim != null &&
    claim.round === state.match.currentRound &&
    !claim.acted
  );
}

/**
 * Why the round will not take a firing right now, or null when it will.
 *
 * Each reason is one the player can act on — wait, reconnect, watch the round
 * out — which is why they are not collapsed into a single disabled flag. The
 * The sub-phase case is not cosmetic: `fireAbility` refuses during it ("the round
 * is already resolving" — non-cascading, or a public firing inside a window would
 * open another and the round would never close), so the rail must not offer what
 * the server will refuse, and must not blame the network for it.
 */
function firingUnavailable({
  connected,
  allSeated,
  revealingNow,
  match,
}: {
  connected: boolean;
  allSeated: boolean;
  revealingNow: boolean;
  match: MatchState['match'];
}): string | null {
  if (!connected) return 'Reconnecting — you can fire once the board is back.';
  if (!allSeated) return 'Waiting for your opponent.';
  if (match.phase === 'react') return 'The round is resolving.';
  if (revealingNow) return 'Wait for the round to finish.';
  return null;
}

export function Board({
  myPlayerId,
  mySeatKey,
  state,
  connected,
  error,
  myChosenMove,
  onPlay,
  onFire,
}: {
  myPlayerId: string;
  mySeatKey: string;
  state: MatchState | null;
  connected: boolean;
  error: string | null;
  myChosenMove: Move | null;
  onPlay: (move: Move) => void;
  onFire?: (choice: FiringChoice) => void;
}) {
  const { reveal, skip } = useRoundReveal(state?.results ?? NO_RESULTS);
  const roundDeadline = useRoundDeadline(state);

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
  // tell them the rules. Before the opponent arrives the how-to-play panels
  // say all of this and more, so the one-liner would only repeat them.
  const showRules = !finished && allSeated && match.currentRound <= 1;
  const myDelays = mySeat?.delays ?? {};
  const oppDelays = oppSeat?.delays ?? {};
  // The holder may replace their pick; the opponent's stays locked while the
  // round resolves, so the picker must not offer them a tap the server refuses.
  const repicking = mayRepick(state);
  const resolvingWithoutMe = match.phase === 'react' && !repicking;
  // Your last two picks, most recent first: explains exactly why each of your
  // moves is on cooldown, without inferring it from the mark count.
  const myRecentMoves = results
    .slice(-2)
    .reverse()
    .map((r) => r.moves[myPlayerId])
    .filter((m): m is Move => Boolean(m));
  // The marks your loadout opened on, so a cooldown with no pick behind it is
  // only blamed on the opening where this match actually had one (JQ-207).
  const myOpeningDelays = rulesForSeats(mySeat ?? NO_LOADOUT, NO_LOADOUT)[0].initialDelays;
  const lobbyReturnUrl =
    match.lobbyReturnUrl != null
      ? buildLobbyReturnLink(match.lobbyReturnUrl, match.externalMatchId)
      : null;
  // The one share action that belongs inside the game: the match these two
  // just played. Only once it is over — a replay of a live match would hand
  // the other player's picks to anyone with the link.
  const shareRef = finished ? replayRef(match) : null;
  const replayUrl = shareRef ? buildReplayUrl(shareRef, undefined, { by: mySeatKey }) : null;
  // Instagram Stories and Snapchat render no link preview, so the share sheet
  // is handed the card itself as well as the link (JQ-122).
  const storyImageUrl = shareRef
    ? buildStoryImageUrl(shareRef, undefined, { by: mySeatKey })
    : null;
  // The deciding round plays out before the match-end banner takes the screen.
  const revealingNow = reveal != null;
  // As the card dissolves, the graph asserts the same fact: the edge the round
  // was won on lights up underneath it. A drawn round has no edge.
  const revealPicks = reveal ? opponentMoveFromResult(reveal.result.moves, myPlayerId) : null;
  const winningEdge =
    reveal?.phase === 'outro' && revealPicks?.myMove && revealPicks.oppMove
      ? winningEdgeOf(revealPicks.myMove, revealPicks.oppMove)
      : null;

  if (finished && !revealingNow) {
    return (
      <div className="board">
        <MatchEndCard
          iWon={iWon}
          drawn={state.matchWinnerSeatKey == null}
          you={you}
          opponent={opponent}
          myScore={mySeat?.player?.score ?? 0}
          oppScore={oppSeat?.player?.score ?? 0}
          results={results}
          mySeatKey={mySeatKey}
          myPlayerId={myPlayerId}
          lobbyReturnUrl={lobbyReturnUrl}
          endReason={match.endReason}
          replayUrl={replayUrl}
          storyImageUrl={storyImageUrl}
        />
      </div>
    );
  }

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
        deadline={allSeated && !revealingNow ? roundDeadline : null}
      />

      {!allSeated && !revealingNow ? (
        <div className="pre-match">
          <p className="hint" role="status">
            While you wait — here's how it works.
          </p>
          <HowToPlay bestOf={match.bestOf} />
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
            {resolvingWithoutMe && (
              <p className="hint" role="status">
                Both locked in — the round is resolving.
              </p>
            )}
          </div>
          <MovePicker
            myDelays={myDelays}
            oppDelays={oppDelays}
            myChosenMove={myChosenMove}
            lockedIn={youMovedThisRound && !repicking}
            opponentLockedIn={opponentLockedIn}
            disabled={
              !connected || !allSeated || (youMovedThisRound && !repicking) || revealingNow
            }
            round={match.currentRound}
            myRecentMoves={myRecentMoves}
            myOpeningDelays={myOpeningDelays}
            onPlay={onPlay}
            secondsLeft={roundDeadline.secondsLeft}
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
          {error && (
            <p className="error error--picker" role="alert">
              {error}
            </p>
          )}
          {/* Below the pentagon, both of them. The board-status slot above it is
              sized for a one-liner, and the tap surface must not move under a
              thumb mid-decision — which is exactly when these appear. */}
          <SubPhasePrompt
            entitlement={state.entitlement}
            round={match.currentRound}
            myMove={state.currentRoundMoves[myPlayerId] ?? null}
            onKeep={onPlay}
          />
          {onFire && !finished && (
            <AbilityRail
              loadout={mySeat?.loadout ?? null}
              abilities={state.abilities}
              myMarks={myDelays}
              oppMarks={oppDelays}
              unavailable={firingUnavailable({ connected, allSeated, revealingNow, match })}
              onFire={onFire}
            />
          )}
        </div>
      )}

      <History
        results={results}
        firings={state.abilityFirings}
        mySeatKey={mySeatKey}
        myPlayerId={myPlayerId}
        you={you}
        opponent={opponent}
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
  deadline,
}: {
  seats: Seat[];
  mySeatKey: string;
  submittedPlayerIds: string[];
  bestOf: number;
  /** Seat that just took a round — its newest pip pulses once. */
  pulseSeatKey: string | null;
  /** Round clock, or null when none is running. */
  deadline: RoundDeadline | null;
}) {
  const needed = winsNeeded(bestOf);
  return (
    <div className="scoreboard">
      {seats.map((seat, i) => (
        <Fragment key={seat.id}>
          <SeatCard
            seat={seat}
            mine={seat.seatKey === mySeatKey}
            winsNeeded={needed}
            lockedIn={Boolean(seat.player && submittedPlayerIds.includes(seat.player.id))}
            justWon={seat.seatKey === pulseSeatKey}
          />
          {/* Between the two seat cards, which are already 201px tall — so the
              clock costs no page height, and the board is 111px over on a
              390x844 phone as it is (JQ-165). It also reads as what it is:
              one clock belonging to the round, not to either player. */}
          {i < seats.length - 1 && (
            <span className="vs-slot">
              <span className="vs">vs</span>
              {deadline && <RoundTimer deadline={deadline} />}
            </span>
          )}
        </Fragment>
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
  lockedIn,
  justWon,
}: {
  seat: Seat;
  mine: boolean;
  winsNeeded: number;
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
    </>
  );
}
