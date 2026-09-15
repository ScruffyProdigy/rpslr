import { chargeReading, type HeldAbility } from '../abilities';
import type { Move } from '../api';
import type { AbilityTargeting } from '../lib/useAbilityTargeting';

/** What a confirmed firing hands back. */
export interface FiringChoice {
  helperId: string;
  target: Move | null;
  source: Move | null;
}

/**
 * Your own ability cards, below the pentagon.
 *
 * Below rather than above for the reason the board-status slot exists: the
 * pentagon is the tap surface for the whole round, and anything that appears
 * above it mid-decision shifts the board under the player's thumb.
 *
 * The rail is your own cards only. `abilities` is the viewing seat's map by
 * construction — a charge that reads unavailable is the tell that says a firing
 * has already happened this round — and the opponent's could only be shown by
 * recomputing it from the public history, which is the one thing this must not
 * do. What their abilities did reaches you in the round account instead.
 *
 * Since JQ-325 it no longer holds the naming walk. Starting a firing hands the
 * board a target mode; this keeps the cards, the charge words, and the line that
 * says what happened to a walk that ended.
 */
export function AbilityRail({
  held,
  unavailable,
  targeting,
}: {
  /** This seat's cards, built once by `Board` and shared with the walk. */
  held: readonly HeldAbility[];
  /**
   * Why the round will not accept a firing right now, or null when it will.
   *
   * A reason rather than a boolean, because there are four of them and they are
   * not interchangeable: a disconnected board, a round already resolving, an
   * opponent who has not arrived, and a reveal playing out. Flattening them to
   * `disabled` told a player mid-Oracle that they were reconnecting, which was
   * both wrong and unactionable.
   */
  unavailable: string | null;
  targeting: AbilityTargeting;
}) {
  // No rail rather than an empty one: `duel` must render exactly as it does
  // today, and an empty container is still a box the layout has to place.
  if (held.length === 0) return null;

  return (
    <section className="ability-rail" aria-labelledby="ability-rail-owner">
      {/* Whose cards these are, in a word, because the board above them may be
          the opponent's. Visible from 360px up and spoken at every width — the
          rail's height budget is measured in `boardFit.test.ts`, and a 320px
          phone has 8.1px of room where the line wants 27.6 (JQ-325). */}
      <h2 className="ability-rail__owner" id="ability-rail-owner">
        Your abilities
      </h2>
      {held.map((ability) => (
        <AbilityCard
          key={ability.id}
          ability={ability}
          unavailable={unavailable}
          naming={targeting.isTargeting(ability.id)}
          note={targeting.note?.helperId === ability.id ? targeting.note.text : null}
          onStart={() => targeting.start(ability)}
        />
      ))}
      {/* What became of a firing, spoken once for the whole rail.
          Permanent and empty rather than mounted with its text: a region that
          arrives already full is the case JQ-157 found screen readers least
          reliable about, and this one carries the sentence a player most needs —
          the charge they just spent, or the one the round took away from them.
          Visually hidden, because the line inside the card is already saying it
          in the place the eye is looking, and because an empty flex child with a
          box would cost the rail a gap it has measured and does not have. */}
      <p className="sr-only ability-rail__say" role="status">
        {targeting.note?.text ?? ''}
      </p>
    </section>
  );
}

/** Why the fire button is unavailable, in the player's words, or null if it isn't. */
function blockedBecause(ability: HeldAbility, unavailable: string | null): string | null {
  // The round's own reason comes first: it is the one the player can act on, and
  // a charge's state is beside the point when nothing can be sent at all.
  if (unavailable) return unavailable;
  if (ability.charge.marks === null) return 'Spent for the match.';
  if (ability.charge.marks > 0) return 'Still recharging.';
  // Charged, and unavailable anyway: this ability already fired this round.
  //
  // Read off the server's own map rather than tracked locally, and per ability
  // rather than per seat — JQ-238 made the rule one firing per *slot*, so a seat
  // that brought two charge helpers may fire both. `chargesNow` suppresses only
  // the fired card's availability, which is exactly that rule expressed as data,
  // and it survives a reload where local state would not.
  if (!ability.charge.available) return `You have already fired ${ability.name} this round.`;
  return null;
}

function AbilityCard({
  ability,
  unavailable,
  naming,
  note,
  onStart,
}: {
  ability: HeldAbility;
  unavailable: string | null;
  /** True while this card's walk is open on the board. */
  naming: boolean;
  /** What became of a walk that ended this round, or null. */
  note: string | null;
  onStart: () => void;
}) {
  const charge = chargeReading(ability.charge);
  const blocked = blockedBecause(ability, unavailable);

  return (
    <article
      className={`ability-card ability-card--${charge.kind}`}
      role="group"
      // The possessive is the point: with the opponent's board open above it,
      // an unlabelled card under their pentagon can read as theirs (JQ-325).
      aria-label={`Your ${ability.name} — ${charge.label}`}
    >
      <header className="ability-card__head">
        <h3 className="ability-card__name">{ability.name}</h3>
        {/* The word, not the tint, is the state (JQ-195). The pips repeat it. */}
        <p className={`ability-card__charge ability-card__charge--${charge.kind}`}>
          {charge.label}
        </p>
      </header>
      <p className="ability-card__blurb">{ability.blurb}</p>

      {naming ? (
        <p className="ability-card__naming">Naming a target on the board</p>
      ) : (
        <>
          <button
            type="button"
            className="ability-card__fire"
            disabled={blocked !== null}
            onClick={onStart}
          >
            Fire {ability.name}
          </button>
          {/* The note outranks the blocked line while it holds: "Rust fired,
              naming their Scissors" is the same fact as "you have already fired
              Rust this round" and says more, and two lines saying one thing is
              the rail's height spent twice. */}
          {note ? (
            <p className="ability-card__note">{note}</p>
          ) : (
            blocked && <p className="ability-card__blocked">{blocked}</p>
          )}
        </>
      )}
    </article>
  );
}
