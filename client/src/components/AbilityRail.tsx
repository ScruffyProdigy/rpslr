import { useState } from 'react';
import type { AbilityMap } from '@game/helpers/abilities';
import type { Loadout } from '@game/helpers/loadout';
import type { Move } from '../api';
import {
  chargeReading,
  heldAbilities,
  legalTargets,
  targetSteps,
  type HeldAbility,
  type MarksBySide,
  type TargetStep,
} from '../abilities';
import { MOVE_META } from '../moves';
import MoveIcon from './MoveIcon';

/** What the rail hands back when a firing is confirmed. */
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
 * above it mid-decision shifts the board under the player's thumb. A card
 * expanding into a target row is exactly that kind of appearance.
 *
 * The rail is your own cards only. `abilities` is the viewing seat's map by
 * construction — a charge that reads unavailable is the tell that says a firing
 * has already happened this round — and the opponent's could only be shown by
 * recomputing it from the public history, which is the one thing this must not
 * do. What their abilities did reaches you in the round account instead.
 */
export function AbilityRail({
  loadout,
  abilities,
  myMarks,
  oppMarks,
  firedThisRound,
  unavailable,
  onFire,
}: {
  /** This seat's two helpers. Null in `duel`, which brings none. */
  loadout: Loadout | null;
  /** The server's charge map for this seat. Never recomputed here. */
  abilities: AbilityMap;
  /** Marks as they stand entering this round — what the server validates against. */
  myMarks: Record<string, number>;
  oppMarks: Record<string, number>;
  /** One firing per seat per round is the repository's rule; this is the local read of it. */
  firedThisRound: boolean;
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
  onFire: (choice: FiringChoice) => void;
}) {
  /** The card being fired, and how far through its steps it is. */
  const [firing, setFiring] = useState<{ id: string; named: Partial<FiringChoice> } | null>(null);

  const held = heldAbilities(loadout, abilities);
  // No rail rather than an empty one: `duel` must render exactly as it does
  // today, and an empty container is still a box the layout has to place.
  if (held.length === 0) return null;

  const marks: MarksBySide = { own: myMarks, opponent: oppMarks };

  return (
    <section className="ability-rail" aria-label="Your abilities">
      {held.map((ability) => (
        <AbilityCard
          key={ability.id}
          ability={ability}
          marks={marks}
          firedThisRound={firedThisRound}
          unavailable={unavailable}
          firing={firing?.id === ability.id ? firing.named : null}
          onStart={() => setFiring({ id: ability.id, named: {} })}
          onName={(field, move) =>
            setFiring((current) =>
              current ? { ...current, named: { ...current.named, [field]: move } } : current,
            )
          }
          onCancel={() => setFiring(null)}
          onConfirm={() => {
            const named = firing?.named ?? {};
            setFiring(null);
            onFire({
              helperId: ability.id,
              target: named.target ?? null,
              source: named.source ?? null,
            });
          }}
        />
      ))}
    </section>
  );
}

/** Why the fire button is unavailable, in the player's words, or null if it isn't. */
function blockedBecause(
  ability: HeldAbility,
  firedThisRound: boolean,
  unavailable: string | null,
): string | null {
  // The round's own reason comes first: it is the one the player can act on, and
  // a charge's state is beside the point when nothing can be sent at all.
  if (unavailable) return unavailable;
  if (ability.charge.marks === null) return 'Spent for the match.';
  if (ability.charge.marks > 0) return 'Still recharging.';
  if (firedThisRound) return 'You have already fired an ability this round.';
  return null;
}

function AbilityCard({
  ability,
  marks,
  firedThisRound,
  unavailable,
  firing,
  onStart,
  onName,
  onCancel,
  onConfirm,
}: {
  ability: HeldAbility;
  marks: MarksBySide;
  firedThisRound: boolean;
  unavailable: string | null;
  /** The moves named so far, or null when this card is not being fired. */
  firing: Partial<FiringChoice> | null;
  onStart: () => void;
  onName: (field: 'target' | 'source', move: Move) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const charge = chargeReading(ability.charge);
  const blocked = blockedBecause(ability, firedThisRound, unavailable);
  const steps = targetSteps(ability.id);
  // The first step not yet answered. Undefined once every step has a move, which
  // is what puts the card on its confirm step.
  const step = firing ? steps.find((s) => firing[s.field] == null) : undefined;

  return (
    <article
      className={`ability-card ability-card--${charge.kind}`}
      role="group"
      aria-label={`${ability.name} — ${charge.label}`}
    >
      <header className="ability-card__head">
        <h3 className="ability-card__name">{ability.name}</h3>
        {/* The word, not the tint, is the state (JQ-195). The pips repeat it. */}
        <p className={`ability-card__charge ability-card__charge--${charge.kind}`}>
          {charge.label}
        </p>
      </header>
      <p className="ability-card__blurb">{ability.blurb}</p>

      {!firing && (
        <>
          <button
            type="button"
            className="ability-card__fire"
            disabled={blocked !== null}
            onClick={onStart}
          >
            Fire {ability.name}
          </button>
          {blocked && <p className="ability-card__blocked">{blocked}</p>}
        </>
      )}

      {firing && step && (
        <TargetRow
          step={step}
          marks={marks}
          onPick={(move) => onName(step.field, move)}
          onCancel={onCancel}
        />
      )}

      {firing && !step && (
        <ConfirmRow ability={ability} named={firing} onCancel={onCancel} onConfirm={onConfirm} />
      )}
    </article>
  );
}

/** One step of naming: five chips, only the legal ones clickable. */
function TargetRow({
  step,
  marks,
  onPick,
  onCancel,
}: {
  step: TargetStep;
  marks: MarksBySide;
  onPick: (move: Move) => void;
  onCancel: () => void;
}) {
  const legal = legalTargets('', step, marks);
  return (
    <div className="ability-target">
      <p className="ability-target__prompt">{step.prompt}</p>
      <ul className="ability-target__moves">
        {(Object.keys(MOVE_META) as Move[]).map((move) => {
          const allowed = legal.includes(move);
          // The reason rides on the button itself rather than a tooltip, so it is
          // spoken: an illegal target must be refusable *and* explicable.
          const reasonId = allowed ? undefined : `why-not-${step.field}-${move}`;
          return (
            <li key={move}>
              <button
                type="button"
                className="ability-target__move"
                disabled={!allowed}
                aria-describedby={reasonId}
                onClick={() => onPick(move)}
              >
                <MoveIcon move={move} />
                <span>{MOVE_META[move].label}</span>
              </button>
              {reasonId && (
                <span id={reasonId} className="sr-only">
                  {step.rejection(move)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" className="ability-card__cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/**
 * The last step before the charge is gone.
 *
 * It states that the firing cannot be taken back, because it cannot: JQ-220 left
 * no withdraw message, by design. Cancel here withdraws an *unsent* firing, which
 * is the only kind there is.
 */
function ConfirmRow({
  ability,
  named,
  onCancel,
  onConfirm,
}: {
  ability: HeldAbility;
  named: Partial<FiringChoice>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const parts = [
    named.source ? `taking a mark from your ${MOVE_META[named.source].label}` : null,
    named.target ? `naming their ${MOVE_META[named.target].label}` : null,
  ].filter(Boolean);

  return (
    <div className="ability-confirm">
      <p className="ability-confirm__what">
        Fire {ability.name}
        {parts.length > 0 ? `, ${parts.join(' and ')}` : ''}?
      </p>
      <p className="ability-confirm__final">
        This can't be taken back — the charge is spent whether or not it lands.
      </p>
      <div className="ability-confirm__actions">
        <button type="button" className="ability-confirm__go" onClick={onConfirm}>
          Fire
        </button>
        <button type="button" className="ability-card__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
