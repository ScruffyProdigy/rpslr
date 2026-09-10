import { useEffect, useRef, type RefObject } from 'react';

/** Every stop inside a panel a keyboard can land on. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The chrome every modal on this board shares: focus in on open, Escape out,
 * Tab held inside, and focus handed back to whatever opened it.
 *
 * Lifted out of `HowToPlayDialog` when the loadout reveal became the second
 * modal (JQ-149). It is forty lines of keyboard handling with three separate
 * traps in it — the Tab wrap off either end, the recovery when a stray click has
 * left focus outside the panel entirely, and the "opener is `body`" case, which
 * means the dialog opened *itself* and so has nowhere to return to. A second
 * copy would be a second place for those to be got subtly wrong.
 */
export function useModalDialog(
  open: boolean,
  onClose: () => void,
): { panelRef: RefObject<HTMLDivElement>; autoFocusRef: RefObject<HTMLButtonElement> } {
  const panelRef = useRef<HTMLDivElement>(null);
  const autoFocusRef = useRef<HTMLButtonElement>(null);
  // Read through a ref so the effect below runs once per open rather than once
  // per render: a caller may rebuild `onClose` every render, and an effect that
  // depended on it would drag focus back to Close on every tick of the round
  // clock.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    autoFocusRef.current?.focus();

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
      // Back to the control the player left from. Body means the dialog opened
      // itself — a first match's rules, a loadout reveal — so there is nowhere
      // to return to.
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [open]);

  return { panelRef, autoFocusRef };
}
