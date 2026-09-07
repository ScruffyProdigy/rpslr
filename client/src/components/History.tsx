import type { MatchState, RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import { MOVE_META, describeOutcome, describeRoundMatchup, opponentMoveFromResult } from '../moves';
import { RoundStrip } from './RoundStrip';
import MoveIcon from './MoveIcon';

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
}: {
  results: MatchState['results'];
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
}) {
  if (results.length === 0) return null;

  return (
    <div className="history">
      <h3>Round history</h3>
      <RoundStrip
        results={results}
        mySeatKey={mySeatKey}
        myPlayerId={myPlayerId}
        you={you}
        opponent={opponent}
      />

      <details className="history-full">
        <summary>All rounds</summary>
        <ul>
          {results.map((r) => (
            <HistoryRow key={r.round} result={r} mySeatKey={mySeatKey} myPlayerId={myPlayerId} />
          ))}
        </ul>
      </details>
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
              You <MoveIcon move={myMove} className="history-row__icon" />{' '}
              {MOVE_META[myMove].label}
            </span>
            <span className="history-row__sep">·</span>
            <span>
              Opponent <MoveIcon move={oppMove} className="history-row__icon" />{' '}
              {MOVE_META[oppMove].label}
            </span>
          </p>
          <p className="history-row__matchup">{describeRoundMatchup(myMove, oppMove)}</p>
        </>
      )}
    </li>
  );
}
