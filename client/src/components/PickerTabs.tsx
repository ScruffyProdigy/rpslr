import type { Identity } from '../lib/seatProfile';
import type { Voice } from '../lib/voice';
import { PlayerAvatar } from './PlayerAvatar';

/** Whose board the pentagon is drawing: yours, or the other player's. */
export type PickerView = 'mine' | 'theirs';

const ORDER: PickerView[] = ['mine', 'theirs'];

/**
 * How a tab names its side.
 *
 * Second person for the you-side in a live match, and a name on a replay, where
 * there is no "you" to be opposite — the same split `Voice` already makes for
 * every other line on the board. A seat the Lobby has told us nothing about yet
 * has no name to use, so it gets the pronoun rather than an initial of the word
 * "Opponent" (JQ-324).
 */
function tabLabel(view: PickerView, you: Identity, opponent: Identity, voice: Voice): string {
  if (view === 'mine') return voice.you ? `${voice.you}'s moves` : 'Your moves';
  return opponent.placeholder ? 'Their moves' : `${opponent.name}'s moves`;
}

/**
 * The two tabs above the board.
 *
 * One tab stop, arrows moving inside it: the board below is the thing a player
 * is reaching for, and a tablist that costs two stops to walk past would put
 * the strip in the way of it every round.
 *
 * The strip is deliberately cheap in height — it is paid for out of a page that
 * had 0.9px of slack on a 390x844 phone, see `--board-furniture` — so the active
 * state is carried by weight and a rule under the tab rather than by a filled
 * pill, and the role colour is an accent on top of that rather than the whole
 * signal (JQ-324, JQ-195).
 */
export function PickerTabs({
  view,
  onView,
  you,
  opponent,
  voice,
  panelId,
}: {
  view: PickerView;
  onView: (view: PickerView) => void;
  you: Identity;
  opponent: Identity;
  voice: Voice;
  /** The board this strip switches, for `aria-controls`. */
  panelId: string;
}) {
  const identities: Record<PickerView, Identity> = { mine: you, theirs: opponent };

  function onKeyDown(e: React.KeyboardEvent) {
    const i = ORDER.indexOf(view);
    // Two tabs, so left and right are the same move — which is what makes the
    // wrap worth having rather than an edge case to get right.
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowLeft'
        ? ORDER[(i + 1) % ORDER.length]
        : e.key === 'Home'
          ? ORDER[0]
          : e.key === 'End'
            ? ORDER[ORDER.length - 1]
            : null;
    if (!next) return;
    e.preventDefault();
    if (next !== view) onView(next);
  }

  return (
    <div className="picker-tabs" role="tablist" aria-label="Whose moves to show" onKeyDown={onKeyDown}>
      {ORDER.map((v) => {
        const active = v === view;
        const identity = identities[v];
        return (
          <button
            key={v}
            type="button"
            role="tab"
            id={`picker-tab-${v}`}
            aria-selected={active}
            aria-controls={panelId}
            // Roving: the open tab is the one the tab order stops on.
            tabIndex={active ? 0 : -1}
            className={['picker-tab', active ? 'picker-tab--active' : ''].filter(Boolean).join(' ')}
            onClick={() => {
              if (!active) onView(v);
            }}
          >
            <PlayerAvatar
              profile={identity.profile}
              displayName={identity.name}
              size="xs"
              role={v === 'mine' ? 'you' : 'opp'}
              placeholder={identity.placeholder}
            />
            <span className="picker-tab__label">{tabLabel(v, you, opponent, voice)}</span>
          </button>
        );
      })}
    </div>
  );
}
