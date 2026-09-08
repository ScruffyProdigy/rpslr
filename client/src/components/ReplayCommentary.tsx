import { useCallback, useState } from 'react';
import {
  RULE_CARDS,
  calloutsFor,
  narrateRound,
  type Callout,
  type RuleCardId,
} from '../commentary';
import type { Replay, ReplayFrame } from '../replay';

/**
 * The running commentary under the board.
 *
 * Three things, in the order a watcher needs them: the rule that just became
 * visible (if this is the round it first shows up on), the sentence describing
 * the round, and the notes that sentence does not have room for.
 *
 * All the words come from `commentary.ts`; this component decides only *when*
 * they appear. That split is deliberate — the copy is a first draft awaiting a
 * Content pass, and rewriting it should not mean touching React.
 */
export function ReplayCommentary({
  frame,
  replay,
  card,
  settled,
}: {
  frame: ReplayFrame;
  replay: Replay;
  /** The rule this round is the first to demonstrate, or null. */
  card: RuleCardId | null;
  /**
   * The reveal card has landed. Until it has, the round's result is the
   * card's to give — the same gate the scoreline and the winning edge use.
   */
  settled: boolean;
}) {
  const [dismissed, setDismissed] = useState<RuleCardId[]>([]);
  const dismiss = useCallback((id: RuleCardId) => {
    setDismissed((cur) => (cur.includes(id) ? cur : [...cur, id]));
  }, []);

  const showCard = card !== null && !dismissed.includes(card);
  // Held back rather than not computed: `settled` is false only while a round
  // is still playing itself out, and everything below reads its outcome.
  const callouts: Callout[] = settled ? calloutsFor(frame, replay) : [];

  return (
    <div className="replay-commentary">
      {showCard && (
        <aside className="replay-rule-card">
          <h2 className="replay-rule-card__title">{RULE_CARDS[card].title}</h2>
          <p className="replay-rule-card__body">{RULE_CARDS[card].body}</p>
          <button
            type="button"
            className="replay-rule-card__dismiss"
            onClick={() => dismiss(card)}
          >
            Got it
          </button>
        </aside>
      )}

      {/*
        One live region, mounted for the whole replay rather than per round: a
        region that appears at the same moment its text does is announced
        unreliably, and the narration is the one thing on this page a watcher
        who cannot see the board has.
      */}
      <div className="replay-commentary__say" role="status">
        <p className="replay-commentary__line">{settled ? narrateRound(frame, replay) : ''}</p>
        {callouts.length > 0 && (
          <ul className="replay-commentary__notes">
            {callouts.map((c) => (
              <li key={`${c.kind}:${c.text}`} className={`replay-note replay-note--${c.kind}`}>
                {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
