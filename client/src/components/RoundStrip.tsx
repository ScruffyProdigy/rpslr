import { useState } from 'react';
import type { RoundResult } from '../api';
import type { Identity } from '../lib/seatProfile';
import { PLAYER_VOICE, type Voice } from '../lib/voice';
import { MOVE_META, describeOutcome, describeRoundMatchup, opponentMoveFromResult } from '../moves';
import { PlayerAvatar } from './PlayerAvatar';
import MoveIcon from './MoveIcon';

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
  voice = PLAYER_VOICE,
  activeRound = null,
  onSelectRound,
}: {
  results: RoundResult[];
  mySeatKey: string;
  myPlayerId: string;
  you: Identity;
  opponent: Identity;
  /** How to refer to the you-side: second person, or by name on a replay. */
  voice?: Voice;
  /** Round the strip should mark as the one on screen, if any. */
  activeRound?: number | null;
  /** When set, a chip jumps the replay to that round instead of expanding. */
  onSelectRound?: (round: number) => void;
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
            verdict === 'draw'
              ? 'draw'
              : verdict === 'win'
                ? voice.you
                  ? `${voice.you} won`
                  : 'you won'
                : `${opponent.name} won`;
          return (
            <li key={r.round}>
              <button
                className={[
                  'history-chip',
                  `history-chip--${verdict}`,
                  activeRound === r.round ? 'history-chip--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`Round ${r.round}: ${picks} — ${said}`}
                aria-expanded={onSelectRound ? undefined : openRound === r.round}
                aria-current={activeRound === r.round ? 'true' : undefined}
                onClick={() =>
                  onSelectRound
                    ? onSelectRound(r.round)
                    : setOpenRound(openRound === r.round ? null : r.round)
                }
              >
                <span className="history-chip__round" aria-hidden="true">
                  R{r.round}
                </span>
                <span className="history-chip__picks" aria-hidden="true">
                  {myMove && <MoveIcon move={myMove} className="history-chip__icon" />}
                  <span className="history-chip__vs">vs</span>
                  {oppMove && <MoveIcon move={oppMove} className="history-chip__icon" />}
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

      {/* Always rendered, empty when no chip is open (JQ-194).
          This is the third instance of the mount-with-content shape JQ-157
          found unreliable, and the one with the best excuse: it appears in
          answer to a deliberate tap, so a player who misses the announcement
          has the chip's own label to fall back on. It is still cheaper to make
          it reliable than to write down why it need not be — the region costs
          one empty paragraph, collapsed to nothing by `:empty` in the
          stylesheet, and the verb line then arrives as a change to a region the
          tap did not create. */}
      <p className="history-strip__detail" role="status">
        {open && openMoves?.myMove && openMoves.oppMove
          ? describeRoundMatchup(openMoves.myMove, openMoves.oppMove)
          : ''}
      </p>
    </>
  );
}
