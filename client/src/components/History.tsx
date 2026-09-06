import { useState } from 'react';
import type { MatchState, RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import { MOVE_META, describeOutcome, describeRoundMatchup, opponentMoveFromResult } from '../moves';
import { LobbyReturnButton } from './LobbyReturnButton';
import { PlayerAvatar } from './PlayerAvatar';

/**
 * Rounds so far, as a chip strip: `R1 📄 vs 🤖 [winner]`. Tapping a chip says
 * what beat what; the full per-round detail stays behind a disclosure.
 */
export function History({
  results,
  mySeatKey,
  myPlayerId,
  you,
  opponent,
  lobbyReturnUrl,
}: {
  results: MatchState['results'];
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
  lobbyReturnUrl?: string | null;
}) {
  const [openRound, setOpenRound] = useState<number | null>(null);

  if (results.length === 0) {
    return lobbyReturnUrl ? <LobbyReturnFooter href={lobbyReturnUrl} /> : null;
  }

  const open = results.find((r) => r.round === openRound) ?? null;
  const openMoves = open ? opponentMoveFromResult(open.moves, myPlayerId) : null;

  return (
    <div className="history">
      <h3>Round history</h3>
      <ul className="history-strip">
        {results.map((r) => {
          const verdict = describeOutcome(r.outcome, mySeatKey);
          const { myMove, oppMove } = opponentMoveFromResult(r.moves, myPlayerId);
          const winner = verdict === 'draw' ? null : verdict === 'win' ? you : opponent;
          const picks =
            myMove && oppMove
              ? `${MOVE_META[myMove].label} vs ${MOVE_META[oppMove].label}`
              : 'no picks recorded';
          const said =
            verdict === 'draw' ? 'draw' : verdict === 'win' ? 'you won' : `${opponent.name} won`;
          return (
            <li key={r.round}>
              <button
                className={`history-chip history-chip--${verdict}`}
                aria-label={`Round ${r.round}: ${picks} — ${said}`}
                aria-expanded={openRound === r.round}
                onClick={() => setOpenRound(openRound === r.round ? null : r.round)}
              >
                <span className="history-chip__round" aria-hidden="true">
                  R{r.round}
                </span>
                <span className="history-chip__picks" aria-hidden="true">
                  {myMove && MOVE_META[myMove].emoji}
                  <span className="history-chip__vs">vs</span>
                  {oppMove && MOVE_META[oppMove].emoji}
                </span>
                {winner && (
                  <PlayerAvatar
                    profile={winner.profile}
                    displayName={winner.name}
                    placeholder={winner.placeholder}
                    role={verdict === 'win' ? 'you' : 'opp'}
                    size="xs"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {open && openMoves?.myMove && openMoves.oppMove && (
        <p className="history-strip__detail" role="status">
          {describeRoundMatchup(openMoves.myMove, openMoves.oppMove)}
        </p>
      )}

      <details className="history-full">
        <summary>All rounds</summary>
        <ul>
          {results.map((r) => (
            <HistoryRow key={r.round} result={r} mySeatKey={mySeatKey} myPlayerId={myPlayerId} />
          ))}
        </ul>
      </details>

      {lobbyReturnUrl && <LobbyReturnFooter href={lobbyReturnUrl} />}
    </div>
  );
}

function HistoryRow({
  result,
  mySeatKey,
  myPlayerId,
}: {
  result: RoundResult;
  mySeatKey: string;
  myPlayerId: string;
}) {
  const verdict = describeOutcome(result.outcome, mySeatKey);
  const { myMove, oppMove } = opponentMoveFromResult(result.moves, myPlayerId);
  const verdictLabel = verdict === 'draw' ? 'Draw' : verdict === 'win' ? 'You won' : 'You lost';
  return (
    <li className={`history-row ${verdict}`}>
      <div className="history-row__head">
        <span>Round {result.round}</span>
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
}

function LobbyReturnFooter({ href }: { href: string }) {
  return (
    <div className="history-lobby-return">
      <LobbyReturnButton href={href} />
    </div>
  );
}
