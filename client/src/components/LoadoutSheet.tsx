import type { Identity } from '../lib/seatProfile';
import { useModalDialog } from '../lib/useModalDialog';
import { cooldownPhrase, MOVE_META } from '../moves';
import type { LoadoutCard, OpeningMark, SeatLoadoutView } from '../loadouts';
import MoveIcon from './MoveIcon';
import { PlayerAvatar } from './PlayerAvatar';
import UiIcon from './UiIcon';

/**
 * Both loadouts, face up.
 *
 * One component for two moments, because they show the same thing. Before round
 * 1 it opens itself and closes on a clock — the reveal. For the rest of the
 * match it opens from either seat card — the check. Nothing about the content
 * differs, and a second component that rendered "the same cards, but later"
 * would be the drift JQ-149 is trying to avoid rather than a separation.
 *
 * Loadouts are public here on purpose. The board already publishes each player's
 * cooldowns to the other — the faded arrows read from exactly that — and helpers
 * decide the opening cooldowns by construction, so hiding a helper would mean
 * hiding a mark. That would delete the strategy layer rather than protect it.
 *
 * A modal, and so nothing on the board moves to make room for it. That is not a
 * stylistic preference: the pentagon is already at its 205px floor on a 390x844
 * phone (JQ-165), and `--board-furniture` is held to the page's real cost by
 * `boardFit.test.ts`, so a persistent row of helper chips could only be paid for
 * out of the tap surface.
 */
export function LoadoutSheet({
  open,
  variant,
  mine,
  theirs,
  you,
  opponent,
  onClose,
}: {
  open: boolean;
  /**
   * `reveal` is the one that opened itself before round 1 and is on a clock;
   * `check` is the player having asked. Only the heading and the button's word
   * differ — a reveal is dismissed by agreeing to start, a check by closing.
   */
  variant: 'reveal' | 'check';
  mine: SeatLoadoutView | null;
  theirs: SeatLoadoutView | null;
  you: Identity;
  opponent: Identity;
  onClose: () => void;
}) {
  const { panelRef, autoFocusRef } = useModalDialog(open, onClose);

  // `duel` brings no loadout on either side, so there is nothing to reveal and
  // no sheet to open. Tested on the data rather than the mode key, which is the
  // repo's convention for "the duel opening is the null loadout".
  if (!open || (!mine && !theirs)) return null;

  const title = variant === 'reveal' ? 'Loadouts revealed' : 'Loadouts';

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
        className="htp-dialog__inner loadout-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="htp-dialog__head">
          <h2 className="htp-dialog__title">{title}</h2>
          <button ref={autoFocusRef} type="button" className="htp-dialog__close" onClick={onClose}>
            {variant === 'reveal' ? 'Start round 1' : 'Close'}
          </button>
        </div>
        {variant === 'reveal' && (
          <p className="loadout-sheet__lead">
            Both were chosen before the match was made, so neither of you could counter the
            other. They are fixed for the whole match.
          </p>
        )}
        <div className="loadout-sheet__sides">
          <LoadoutSide view={mine} identity={you} role="you" heading="You" />
          <LoadoutSide view={theirs} identity={opponent} role="opp" heading={opponent.name} />
        </div>
      </div>
    </div>
  );
}

/** One player's two helpers, and the board they open on. */
function LoadoutSide({
  view,
  identity,
  role,
  heading,
}: {
  view: SeatLoadoutView | null;
  identity: Identity;
  role: 'you' | 'opp';
  heading: string;
}) {
  return (
    <section className={`loadout-side loadout-side--${role}`}>
      <h3 className="loadout-side__head">
        <PlayerAvatar
          profile={identity.profile}
          displayName={identity.name}
          placeholder={identity.placeholder}
          role={role}
          size="xs"
        />
        <span className="loadout-side__name">{heading}</span>
        {view && (
          <span className="loadout-side__price">
            {view.price} mark{view.price === 1 ? '' : 's'}
          </span>
        )}
      </h3>
      {view ? (
        <>
          {view.cards.map((card) => (
            <HelperCard key={card.id} card={card} />
          ))}
          <Opening view={view} />
        </>
      ) : (
        // A seat with no loadout beside one that has them: the opponent has not
        // arrived yet, or a mode where only one side brings helpers ever exists.
        <p className="loadout-side__none">No helpers.</p>
      )}
    </section>
  );
}

/** One helper: what it is, what it costs, and what it does. */
function HelperCard({ card }: { card: LoadoutCard }) {
  return (
    <div className="loadout-card">
      <p className="loadout-card__head">
        <span className="loadout-card__name">{card.name}</span>
        <span className="loadout-card__tier">
          {card.tier} ·{' '}
          {card.markCost === 0 ? (
            // A Trinket is free and binds nothing, which is the whole shape of
            // the tier — saying "0 marks" and stopping would read as a gap.
            'free'
          ) : (
            <>
              {card.markCost} mark{card.markCost === 1 ? '' : 's'}
              {card.boundMove && (
                <>
                  {' on '}
                  <span className="loadout-card__move">
                    <MoveIcon move={card.boundMove} />
                    {MOVE_META[card.boundMove].label}
                  </span>
                </>
              )}
            </>
          )}
        </span>
      </p>
      <p className="loadout-card__blurb">{card.blurb}</p>
    </div>
  );
}

/** The board this loadout opens on, and the roll if one was needed to build it. */
function Opening({ view }: { view: SeatLoadoutView }) {
  return (
    <div className="loadout-opening">
      <p className="loadout-opening__marks">
        {view.opening.length === 0 ? (
          'Opens with all five moves live.'
        ) : (
          <>
            <span className="loadout-opening__label">Opens down:</span>{' '}
            {view.opening.map((mark, i) => (
              <OpeningChip key={mark.move} mark={mark} first={i === 0} />
            ))}
          </>
        )}
      </p>
      {view.displaced && (
        // The first moment either player can learn this. The server rolled it
        // when the match was created and has been holding it ever since — it
        // could not be shown before the reveal, because before the reveal there
        // was nothing to attach it to.
        <p className="loadout-opening__roll">
          Both helpers bind the same move, so the cheaper one&rsquo;s marks were moved: they
          landed on{' '}
          <span className="loadout-card__move">
            <MoveIcon move={view.displaced.move} />
            {MOVE_META[view.displaced.move].label}
          </span>
          .
        </p>
      )}
    </div>
  );
}

/** One move that starts down, with its depth in the same units the board uses. */
function OpeningChip({ mark, first }: { mark: OpeningMark; first: boolean }) {
  return (
    <>
      {!first && <span aria-hidden="true">{' · '}</span>}
      <span className="loadout-opening__chip">
        <MoveIcon move={mark.move} />
        {MOVE_META[mark.move].label}
        <span className="cooldown-pill cooldown-pill--legend" role="img" aria-label={cooldownPhrase(mark.marks)}>
          <UiIcon name="hourglass" /> {mark.marks}
        </span>
      </span>
    </>
  );
}
