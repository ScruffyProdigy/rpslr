import { useEffect, useRef } from 'react';
import { roundCap, winsNeeded } from '../moves';
import { HowToPlayGraph } from './HowToPlayGraph';
import UiIcon from './UiIcon';

/**
 * The rules, in three panels. Mounted bare while the match waits for the
 * opponent — the one stretch of dead time a player has, and until now the one
 * the game spent saying nothing — and inside a dialog from the header's `?`
 * for the rest of the match.
 */
export function HowToPlay({ bestOf }: { bestOf: number }) {
  const needed = winsNeeded(bestOf);
  const cap = roundCap(bestOf);
  return (
    <div className="htp">
      <section className="htp-panel">
        <h3 className="htp-panel__title">What beats what</h3>
        <HowToPlayGraph />
      </section>

      <section className="htp-panel">
        <h3 className="htp-panel__title">Cooldowns</h3>
        <p className="htp-panel__lead">
          <span className="cooldown-pill">
            <UiIcon name="hourglass" /> 2
          </span>
        </p>
        <p className="htp-panel__body">
          Play a move and it rests for two rounds — you can't throw the same thing twice in a row.
          Lizard and Robot start the match on cooldown.
        </p>
        <p className="htp-panel__body htp-panel__body--aside">
          The board shows the opponent's cooldowns too: an attack they can't make this round is
          drawn as a faded arrow.
        </p>
      </section>

      <section className="htp-panel">
        <h3 className="htp-panel__title">First to {needed}</h3>
        <p className="htp-panel__lead">
          <span className="win-pips" aria-hidden="true">
            {Array.from({ length: needed }, (_, i) => (
              <span key={i} className={`win-pip ${i < needed - 1 ? 'filled' : 'empty'}`} />
            ))}
          </span>
        </p>
        <p className="htp-panel__body">
          Win {needed} rounds and the match is yours. A drawn round scores for neither of you and
          the match plays on — up to {cap} rounds, after which whoever is ahead takes it.
        </p>
      </section>
    </div>
  );
}

/** Every stop inside the panel a keyboard can land on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The same panels in a modal.
 *
 * A plain overlay rather than `<dialog>`: the element keeps its own open state
 * in the DOM, and if it ever closes without telling React — `close` and
 * `cancel` do not fire in every engine we run in — `open` stays true, the next
 * `?` tap writes the same state, nothing re-renders, and the button is dead
 * for the rest of the match. Here React holds the only copy of that state and
 * every way out goes through `onClose`.
 *
 * The trap `<dialog>` would have given for free is written out below. Screen
 * readers already treat the background as inert on `aria-modal`; the keyboard
 * was the part still owing, and Tab could walk straight out onto the board
 * behind (JQ-157).
 */
export function HowToPlayDialog({
  bestOf,
  open,
  onClose,
}: {
  bestOf: number;
  open: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Read through a ref so the effect below runs once per open rather than once
  // per render: `onClose` is rebuilt every render by useFirstMatchRules, and an
  // effect that depended on it would drag focus back to Close on every tick of
  // the round clock.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) {
        e.preventDefault();
        return;
      }
      // Off either end — or from anywhere outside the panel, which is where a
      // stray click can leave you — comes back round instead of out.
      const edge = e.shiftKey ? stops[0] : stops[stops.length - 1];
      const wrap = e.shiftKey ? stops[stops.length - 1] : stops[0];
      if (document.activeElement === edge || !panel.contains(document.activeElement)) {
        e.preventDefault();
        wrap.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Back to the `?` button the player left from. Body means the panels
      // opened themselves on a first match, so there is nowhere to return to.
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="htp-dialog"
      onClick={(e) => {
        // The backdrop is this element; the panel is a child of it.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="htp-dialog__inner"
        role="dialog"
        aria-modal="true"
        aria-label="How to play"
      >
        <div className="htp-dialog__head">
          <h2 className="htp-dialog__title">How to play</h2>
          <button ref={closeRef} type="button" className="htp-dialog__close" onClick={onClose}>
            Close
          </button>
        </div>
        <HowToPlay bestOf={bestOf} />
      </div>
    </div>
  );
}
