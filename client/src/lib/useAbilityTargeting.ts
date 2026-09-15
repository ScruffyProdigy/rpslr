/**
 * The firing walk: idle → name each step → confirm → fire.
 *
 * It lived inside `AbilityRail` until JQ-325, as local state, because the card
 * was the whole surface. The board names the target now, and the rail and the
 * picker are siblings under `Board`, so the walk has to sit above both of them.
 *
 * What it is not: a second ability system. Every legality question still goes to
 * `targetSteps` / `legalTargets` in `abilities.ts`, which mirror the server's
 * `namedMovesFor`, and every charge question still goes to the server's own map.
 * This owns the *walk* — which step is open, what has been named, and when a walk
 * has gone stale — and nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Move } from '../api';
import {
  legalTargets,
  targetSteps,
  type HeldAbility,
  type MarksBySide,
  type TargetStep,
} from '../abilities';
import { MOVE_META } from '../moves';
import type { FiringChoice } from '../components/AbilityRail';

/** The walk as the board needs to draw it. Read-only; every change comes back here. */
export interface Targeting {
  helperId: string;
  /** The roster's name, e.g. "Rust". */
  name: string;
  /** The step being answered, or null once every step has a move. */
  step: TargetStep | null;
  named: Partial<FiringChoice>;
  /**
   * Which board must be open. The open step's side, or — while confirming, when
   * there is no open step — the last one's, so the board does not jump away from
   * the move that is about to be named.
   */
  side: 'own' | 'opponent';
  /** This step's legal moves, in board order. Empty on the confirm step. */
  legal: Move[];
  /** The heading: "Choose one of their moves for Rust". */
  instruction: string;
  /** The step's own words, e.g. "Name a move they have on cooldown." */
  prompt: string;
  /** Why a disallowed move is disallowed, spoken on the node. */
  rejection: (move: Move) => string;
}

/**
 * What the rail says about a walk that has ended.
 *
 * `fired` covers the gap between sending and the server's own `abilities` map
 * catching up — without it the card goes blank for a round-trip after the one
 * action in the game that cannot be taken back. `cancelled` is AC #8: a walk
 * taken away from the player is explained, and nothing is submitted in its place.
 */
export interface TargetingNote {
  helperId: string;
  kind: 'fired' | 'cancelled';
  text: string;
}

export interface AbilityTargeting {
  targeting: Targeting | null;
  note: TargetingNote | null;
  isTargeting: (helperId: string) => boolean;
  start: (ability: HeldAbility) => void;
  name: (move: Move) => void;
  cancel: () => void;
  confirm: () => void;
}

/** The walk's own state. Everything else on `Targeting` is derived from it. */
interface Walk {
  helperId: string;
  name: string;
  /** The round it was started in, so a round that moves on is a plain comparison. */
  round: number;
  named: Partial<FiringChoice>;
}

/** A reason from elsewhere, joined onto "<Name> was not fired — ". */
function asClause(reason: string): string {
  const lowered = reason.charAt(0).toLowerCase() + reason.slice(1);
  return lowered.endsWith('.') ? lowered : `${lowered}.`;
}

/** What each named move did, in the confirm step's own order and words. */
export function namedParts(named: Partial<FiringChoice>): string[] {
  return [
    named.source ? `taking a mark from your ${MOVE_META[named.source].label}` : null,
    named.target ? `naming their ${MOVE_META[named.target].label}` : null,
  ].filter((part): part is string => part !== null);
}

/**
 * Why this walk can no longer be completed, or null while it can.
 *
 * Order matters: the round's own reason outranks the charge's, for the same
 * reason `blockedBecause` puts it first — it is the one the player can act on.
 */
function staleReason(
  walk: Walk,
  ability: HeldAbility | null,
  round: number,
  unavailable: string | null,
  marks: MarksBySide,
): string | null {
  if (walk.round !== round) return 'the round moved on.';
  if (unavailable) return asClause(unavailable);
  // A charge that is no longer ready-and-available: spent, recharging, or this
  // slot has already fired. Asked of the server's map, never recomputed.
  if (!ability || ability.charge.marks !== 0 || !ability.charge.available) {
    return `${walk.name} can no longer fire this round.`;
  }
  // Marks only move between rounds, so this is defensive — but a projection
  // arriving mid-claim can reshape the maps, and a confirm button over a target
  // the server would refuse is exactly what AC #8 is about.
  for (const step of targetSteps(walk.helperId)) {
    const named = walk.named[step.field];
    if (named && !step.allows(named, marks)) return 'that target is no longer legal.';
  }
  return null;
}

export function useAbilityTargeting({
  held,
  marks,
  round,
  unavailable,
  onFire,
}: {
  /** This seat's cards, as `heldAbilities` builds them. */
  held: readonly HeldAbility[];
  /** Both sides' marks entering this round — what every target rule reads. */
  marks: MarksBySide;
  round: number;
  /** `firingUnavailable`'s answer: why the round will not take a firing, or null. */
  unavailable: string | null;
  onFire: (choice: FiringChoice) => void;
}): AbilityTargeting {
  const [walk, setWalk] = useState<Walk | null>(null);
  const [note, setNote] = useState<(TargetingNote & { round: number }) | null>(null);

  const ability = walk ? (held.find((a) => a.id === walk.helperId) ?? null) : null;
  const stale = walk ? staleReason(walk, ability, round, unavailable, marks) : null;

  // Declared before the staleness effect on purpose: both run in the same commit
  // when a round change makes a walk stale, and this one has to clear the *old*
  // round's note before that one writes the new round's.
  useEffect(() => {
    setNote((current) => (current && current.round !== round ? null : current));
  }, [round]);

  useEffect(() => {
    if (!walk || !stale) return;
    setWalk(null);
    setNote({
      helperId: walk.helperId,
      kind: 'cancelled',
      text: `${walk.name} was not fired — ${stale}`,
      round,
    });
  }, [walk, stale, round]);

  const targeting = useMemo((): Targeting | null => {
    if (!walk || !ability || stale) return null;
    const steps = targetSteps(walk.helperId);
    const step = steps.find((s) => walk.named[s.field] == null) ?? null;
    const side = step?.side ?? steps[steps.length - 1]?.side ?? 'own';
    return {
      helperId: walk.helperId,
      name: walk.name,
      step,
      named: walk.named,
      side,
      legal: step ? legalTargets(walk.helperId, step, marks) : [],
      instruction: step
        ? `Choose one of ${step.side === 'own' ? 'your' : 'their'} moves for ${walk.name}`
        : `Fire ${walk.name}?`,
      prompt: step?.prompt ?? '',
      rejection: step ? step.rejection : () => '',
    };
  }, [walk, ability, stale, marks]);

  const start = useCallback(
    (card: HeldAbility) => {
      setNote(null);
      setWalk({ helperId: card.id, name: card.name, round, named: {} });
    },
    [round],
  );

  const name = useCallback((move: Move) => {
    setWalk((current) => {
      if (!current) return current;
      // Asked of the walk's own state rather than of a step captured in a
      // closure, so two taps landing in one commit cannot both answer the same
      // step.
      const step = targetSteps(current.helperId).find((s) => current.named[s.field] == null);
      if (!step) return current;
      return { ...current, named: { ...current.named, [step.field]: move } };
    });
  }, []);

  const cancel = useCallback(() => {
    // No note: a cancel the player asked for needs no explanation, and the view
    // they came from is restored simply by the walk going away.
    setWalk(null);
  }, []);

  const confirm = useCallback(() => {
    if (!walk) return;
    onFire({
      helperId: walk.helperId,
      target: walk.named.target ?? null,
      source: walk.named.source ?? null,
    });
    const parts = namedParts(walk.named);
    setWalk(null);
    setNote({
      helperId: walk.helperId,
      kind: 'fired',
      text: `${walk.name} fired${parts.length > 0 ? `, ${parts.join(' and ')}` : ''}.`,
      round,
    });
  }, [walk, onFire, round]);

  const isTargeting = useCallback(
    (helperId: string) => targeting?.helperId === helperId,
    [targeting],
  );

  const shown = useMemo(
    (): TargetingNote | null =>
      note ? { helperId: note.helperId, kind: note.kind, text: note.text } : null,
    [note],
  );

  return { targeting, note: shown, isTargeting, start, name, cancel, confirm };
}
