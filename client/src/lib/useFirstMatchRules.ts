import { useEffect, useRef, useState } from 'react';
import { hasSeen, markSeen } from './prefs';

/**
 * Opens the how-to-play panels once, on a player's first match ever.
 *
 * It waits for both seats to fill rather than firing on arrival, so it lands
 * at the same moment for everyone: if there was a wait the panels have already
 * been on screen through it, and if there wasn't — the Lobby can seat both
 * players at once — this is the only time the rules get shown at all.
 *
 * Reading holds up the round, since both players commit simultaneously and
 * there is no round timer yet (JQ-156). That is acceptable only because
 * matchmaking pairs newcomers together: both sides are reading, and the
 * panels are short. It would not be if a first-timer could stall a veteran.
 */
/**
 * TEMPORARY (2026-09-06): show the panels on every match, not just a player's
 * first, so the first-run flow can be tried repeatedly without clearing site
 * data. Safe only because nobody is playing yet. Flip back to `false` before
 * real traffic — otherwise every player gets the rules in the face every match.
 */
const ALWAYS_SHOW_RULES = true;

export function useFirstMatchRules(
  allSeated: boolean,
  alwaysShow: boolean = ALWAYS_SHOW_RULES,
): {
  open: boolean;
  setOpen: (open: boolean) => void;
  dismiss: () => void;
} {
  const [open, setOpen] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (!allSeated || fired.current) return;
    fired.current = true;
    if (alwaysShow || !hasSeen('howToPlay')) setOpen(true);
  }, [allSeated, alwaysShow]);

  return {
    open,
    setOpen,
    dismiss: () => {
      markSeen('howToPlay');
      setOpen(false);
    },
  };
}
