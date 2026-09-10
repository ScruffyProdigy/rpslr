import type { AbilityFiring } from '@game/types';
import type { MatchState, RoundResult } from '../api';
import { describeFiring } from '../abilities';
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
  firings = NO_FIRINGS,
  mySeatKey,
  myPlayerId,
  you,
  opponent,
}: {
  results: MatchState['results'];
  /**
   * Abilities spent in rounds that have resolved, for both seats.
   *
   * This is where the round account lives (JQ-221). History already lists both
   * seats' rounds, is durable three rounds later — which a reveal card on a timer
   * cannot be — and grows at exactly the moment a firing stops being secret: the
   * server withholds the round in progress, because Quarantine names the move it
   * fears and an opponent who could read that would simply play something else.
   */
  firings?: readonly AbilityFiring[];
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
            <HistoryRow
              key={r.round}
              result={r}
              firings={firings.filter((f) => f.round === r.round)}
              mySeatKey={mySeatKey}
              myPlayerId={myPlayerId}
            />
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Stable identity so the default prop cannot re-render the strip every tick. */
const NO_FIRINGS: readonly AbilityFiring[] = [];

function HistoryRow({
  result,
  firings,
  mySeatKey,
  myPlayerId,
}: {
  result: RoundResult;
  /** Only this round's, and only from a round that has resolved. */
  firings: readonly AbilityFiring[];
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
      {firings.length > 0 && (
        <ul className="history-row__firings">
          {firings.map((firing) => (
            <li
              key={`${firing.seatKey}-${firing.helperId}`}
              className={`history-row__firing history-row__firing--${
                firing.seatKey === mySeatKey ? 'mine' : 'theirs'
              }`}
            >
              {describeFiring(firing, mySeatKey)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
