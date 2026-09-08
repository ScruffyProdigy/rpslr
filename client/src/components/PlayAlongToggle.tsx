import type { CallSide } from '../lib/usePlayAlong';

/**
 * Watch someone else's match, or play it.
 *
 * Two controls rather than one: whether to call the moves at all, and whose
 * moves to call. The second only exists once the first is on — a watcher has
 * no side, and offering one before they have said they want to play is a
 * question about a decision they have not made yet.
 */
export function PlayAlongToggle({
  on,
  side,
  names,
  onMode,
  onSide,
}: {
  on: boolean;
  side: CallSide;
  /** Both players, in board order, so the choice does not reorder on a flip. */
  names: [string, string];
  onMode: (on: boolean) => void;
  onSide: (side: CallSide) => void;
}) {
  return (
    <div className="play-along">
      <div className="play-along__modes" role="group" aria-label="Replay mode">
        <button
          type="button"
          className="play-along__mode"
          aria-pressed={!on}
          onClick={() => onMode(false)}
        >
          Watch
        </button>
        <button
          type="button"
          className="play-along__mode"
          aria-pressed={on}
          onClick={() => onMode(true)}
        >
          Play along
        </button>
      </div>

      {on && (
        <div className="play-along__sides" role="group" aria-label="Whose moves to call">
          {names.map((name, i) => (
            <button
              key={name + i}
              type="button"
              className="play-along__side"
              aria-pressed={side === i}
              onClick={() => onSide(i as CallSide)}
            >
              Play as {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
