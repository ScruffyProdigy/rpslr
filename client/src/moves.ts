import type { Move } from './api';

/** Presentation helpers for the five moves. Pure -> easy to unit test. */
export const MOVE_META: Record<Move, { emoji: string; label: string }> = {
  rock: { emoji: '🪨', label: 'Rock' },
  paper: { emoji: '📄', label: 'Paper' },
  scissors: { emoji: '✂️', label: 'Scissors' },
  lizard: { emoji: '🦎', label: 'Lizard' },
  spock: { emoji: '🖖', label: 'Spock' },
};

export const ALL_MOVES: Move[] = ['rock', 'paper', 'scissors', 'lizard', 'spock'];

/**
 * Outcome is the winning seat key (or 'draw'). Compare against the viewer's
 * seat key to render a verdict.
 */
export function describeOutcome(outcome: string, mySeatKey: string): 'win' | 'loss' | 'draw' {
  if (outcome === 'draw') return 'draw';
  return outcome === mySeatKey ? 'win' : 'loss';
}
