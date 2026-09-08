import { useState } from 'react';

type ShareState = 'idle' | 'copied' | 'manual';

/**
 * Hands someone the link to the match they just played.
 *
 * Three ways down, because the good ones are not always there: the OS share
 * sheet on a phone, the clipboard on a desktop, and — when the page is served
 * over plain http, where both are missing — the bare link on screen to be
 * copied by hand. The one outcome not allowed is a button that appears to do
 * nothing.
 */
export function ShareReplayButton({ url }: { url: string }) {
  const [state, setState] = useState<ShareState>('idle');

  async function share() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'RPSLR replay', url });
        // The sheet reports nothing about what the person chose, so there is
        // nothing honest to confirm. Saying "Shared" here would be a guess.
        return;
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure.
        if ((err as Error)?.name === 'AbortError') return;
        // Anything else falls through to the clipboard.
      }
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        setState('copied');
        return;
      } catch {
        /* No clipboard permission — show the link instead. */
      }
    }

    setState('manual');
  }

  return (
    <div className="share-replay">
      <button className="share-replay__btn" onClick={share}>
        Share replay
      </button>
      {/* Polite, not assertive: this confirms an action the person just took,
          and should wait its turn rather than interrupt what is being read. */}
      <span className="share-replay__status" role="status" aria-live="polite">
        {state === 'copied' && 'Copied'}
      </span>
      {state === 'manual' && (
        <p className="share-replay__manual">
          Copy this link: <span className="share-replay__url">{url}</span>
        </p>
      )}
    </div>
  );
}
