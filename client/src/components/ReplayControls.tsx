import type { PlaybackSpeed } from '../lib/useReplayPlayback';

/**
 * Transport for a replay. Under reduced motion the play and speed controls are
 * not disabled, they are absent: there is no playback to control, only steps.
 */
export function ReplayControls({
  playing,
  speed,
  stepping,
  atStart,
  atEnd,
  onToggle,
  onPrev,
  onNext,
  onSpeed,
}: {
  playing: boolean;
  speed: PlaybackSpeed;
  stepping: boolean;
  atStart: boolean;
  atEnd: boolean;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSpeed: (speed: PlaybackSpeed) => void;
}) {
  return (
    <div className="replay-controls">
      <button
        className="replay-controls__step"
        onClick={onPrev}
        disabled={atStart}
        aria-label="Previous round"
      >
        <span aria-hidden="true">&lsaquo;</span>
      </button>

      {!stepping && (
        <button
          className="replay-controls__play"
          onClick={onToggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      )}

      <button
        className="replay-controls__step"
        onClick={onNext}
        disabled={atEnd}
        aria-label="Next round"
      >
        <span aria-hidden="true">&rsaquo;</span>
      </button>

      {!stepping && (
        <span className="replay-controls__speed">
          <button
            className="replay-controls__speed-btn"
            aria-label="Normal speed"
            aria-pressed={speed === 1}
            onClick={() => onSpeed(1)}
          >
            1&times;
          </button>
          <button
            className="replay-controls__speed-btn"
            aria-label="Double speed"
            aria-pressed={speed === 2}
            onClick={() => onSpeed(2)}
          >
            2&times;
          </button>
        </span>
      )}
    </div>
  );
}
