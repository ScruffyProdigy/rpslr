/**
 * How the board refers to the side drawn in the `--you` role.
 *
 * In a match that side is the person holding the phone, so the copy is second
 * person. On a replay there is no "you" — both players are third parties — so
 * the same components name them instead. The third-person forms already exist
 * for the opponent side; this just lets the you-side borrow them.
 */
export interface Voice {
  /** null → second person. A name → third person about that player. */
  you: string | null;
}

/** A player looking at their own match. */
export const PLAYER_VOICE: Voice = { you: null };

/** A watcher looking at someone else's. A blank name is no name. */
export function spectatorVoice(name: string): Voice {
  const trimmed = name.trim();
  return { you: trimmed ? trimmed : null };
}

export function youLabel(voice: Voice): string {
  return voice.you ?? 'You';
}

export function takesRound(voice: Voice, round: number): string {
  return voice.you ? `${voice.you} takes round ${round}` : `You take round ${round}`;
}

export function winsMatch(voice: Voice): string {
  return voice.you ? `${voice.you} wins the match.` : 'You win the match!';
}

export function ranOutOfTime(voice: Voice): string {
  return voice.you
    ? `${voice.you} ran out of time — a move was picked for them`
    : 'You ran out of time — a move was picked for you';
}
