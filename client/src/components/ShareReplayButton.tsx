import { useState } from 'react';

type ShareState = 'idle' | 'preparing' | 'copied' | 'manual';

/** Long enough for a card the server has to draw; short enough not to feel stuck. */
const IMAGE_TIMEOUT_MS = 4000;

export interface ShareReplayButtonProps {
  url: string;
  /**
   * The story card for this match. Given, the share sheet gets the image as
   * well as the link, which is the only thing Instagram Stories and Snapchat
   * can actually show — neither renders a link preview.
   */
  imageUrl?: string | null;
}

/**
 * Hands someone the match they just played.
 *
 * Four ways down, because the good ones are not always there: the OS share
 * sheet with the story card attached, the sheet with just the link, the
 * clipboard, and — when the page is served over plain http, where both sheets
 * and clipboard are missing — the bare link on screen to be copied by hand.
 * The one outcome not allowed is a button that appears to do nothing.
 */
export function ShareReplayButton({ url, imageUrl = null }: ShareReplayButtonProps) {
  const [state, setState] = useState<ShareState>('idle');

  async function share() {
    const file = imageUrl && canShareFiles() ? await fetchStoryFile(imageUrl, setState) : null;

    if (file && typeof navigator?.share === 'function') {
      try {
        await navigator.share({ files: [file], url, title: 'RPSLR replay' });
        setState('idle');
        return;
      } catch (err) {
        if (isAbort(err)) {
          setState('idle');
          return;
        }
        // A sheet that refused the file may still take the link. Fall through.
      }
    }

    setState('idle');

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'RPSLR replay', url });
        // The sheet reports nothing about what the person chose, so there is
        // nothing honest to confirm. Saying "Shared" here would be a guess.
        return;
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure.
        if (isAbort(err)) return;
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

  // Only where the sheet cannot take the file: everywhere else the sheet is the
  // better route, and offering both would be two buttons that do one thing.
  const showSaveImage = Boolean(imageUrl) && !canShareFiles();

  return (
    <div className="share-replay">
      <div className="share-replay__actions">
        <button className="share-replay__btn" onClick={share} disabled={state === 'preparing'}>
          {state === 'preparing' ? 'Preparing…' : 'Share replay'}
        </button>
        {showSaveImage && imageUrl && (
          /* A plain link, not a blob: the browser knows how to save a PNG, and
             a download it started itself is one it will not block. */
          <a className="share-replay__save" href={imageUrl} download="rpslr-replay.png">
            Save image
          </a>
        )}
      </div>
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

/**
 * Asked with a real file, because Safari answers `canShare({ files })` on the
 * shape of what it is given: a probe with an empty array reports false on a
 * browser that shares files perfectly well.
 */
function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * The card, or null. Every failure here is ordinary — a slow render, a dropped
 * connection, a browser without `File` — and none of them may cost the share:
 * the caller falls back to sharing the link, which is what it did before this
 * existed.
 */
async function fetchStoryFile(
  imageUrl: string,
  setState: (state: ShareState) => void,
): Promise<File | null> {
  setState('preparing');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(imageUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    const file = new File([blob], 'rpslr-replay.png', { type: 'image/png' });
    // Asked again with the real file: the probe above proves the browser shares
    // *some* file, this proves it will share *this* one.
    return navigator.canShare?.({ files: [file] }) ? file : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isAbort(err: unknown): boolean {
  return (err as Error)?.name === 'AbortError';
}
