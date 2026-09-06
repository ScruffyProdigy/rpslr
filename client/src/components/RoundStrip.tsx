import { useState } from 'react';
import type { RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import { MOVE_META, describeOutcome, describeRoundMatchup, opponentMoveFromResult } from '../moves';
import { PlayerAvatar } from './PlayerAvatar';

/**
 * The rounds so far as a chip strip — `R1 📄 vs 🤖 [winner]` — with the verb
 * line for whichever chip is tapped. Both the in-match history and the
 * match-end card show the same strip, so it lives on its own rather than
 * inside either of them.
 */
export function RoundStrip({
  results,
  mySeatKey,
  myPlayerId,
  you,
  opponent,
}: {
  results: RoundResult[];
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
}) {
  const [openRound, setOpenRound] = useState<number | null>(null);

  if (results.length === 0) return null;

  const open = results.find((r) => r.round === openRound) ?? null;
  const openMoves = open ? opponentMoveFromResult(open.moves, myPlayerId) : null;

  return (
    <>
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
    </>
  );
}
