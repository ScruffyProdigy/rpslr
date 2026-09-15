import { namedParts, type Targeting } from '../lib/useAbilityTargeting';

/**
 * The centre while an ability is naming a move.
 *
 * It is the whole of the targeting UI's copy, and it is here rather than above
 * the board on purpose: JQ-324 left 3.5px of slack at 375x812, and anything that
 * appears above the pentagon mid-decision shifts the tap surface under a thumb.
 *
 * Like the other two centres it renders into the board's one live region and
 * carries no `role="status"` of its own (JQ-157).
 */
export function TargetingCenter({
  targeting,
  onCancel,
  onConfirm,
}: {
  targeting: Targeting;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const parts = namedParts(targeting.named);
  const cancel = (
    <button type="button" className="picker-center__cancel" onClick={onCancel}>
      Cancel targeting
    </button>
  );

  if (targeting.step) {
    return (
      <div className="picker-center picker-center--targeting">
        <p className="picker-center__targeting">{targeting.instruction}</p>
        {/* The card's own words, not a rewrite of them: this is the only place a
            player is told whether they hold Quarantine or Tripwire. */}
        <p className="picker-center__caption">{targeting.prompt}</p>
        {parts.length > 0 && <p className="picker-center__named">So far: {parts.join(' and ')}.</p>}
        {cancel}
      </div>
    );
  }

  return (
    <div className="picker-center picker-center--targeting">
      <p className="picker-center__targeting">
        Fire {targeting.name}
        {parts.length > 0 ? `, ${parts.join(' and ')}` : ''}?
      </p>
      {/* JQ-220 settled it in the negative: there is no withdraw message, so the
          confirm step says so rather than implying it. Cancel here withdraws an
          *unsent* firing, which is the only kind there is (JQ-221). */}
      <p className="picker-center__final">
        This can't be taken back — the charge is spent whether or not it lands.
      </p>
      <div className="picker-center__targeting-actions">
        <button type="button" className="picker-center__fire" onClick={onConfirm}>
          Fire
        </button>
        {cancel}
      </div>
    </div>
  );
}
