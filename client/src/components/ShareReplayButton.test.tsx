import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareReplayButton } from './ShareReplayButton';

const URL_ = 'https://rpsls-duel.win/replay/ext-1';

function stub(name: 'share' | 'clipboard' | 'canShare', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

const STORY_ = 'https://rpsls-duel.win/replay/ext-1/story.png';

/** A browser whose share sheet takes files, with the card served behind it. */
function withFileSharing(): { share: ReturnType<typeof vi.fn> } {
  const share = vi.fn().mockResolvedValue(undefined);
  stub('share', share);
  stub('canShare', vi.fn().mockReturnValue(true));
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { status: 200 }),
    ),
  );
  return { share };
}

afterEach(() => {
  stub('share', undefined);
  stub('clipboard', undefined);
  stub('canShare', undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<ShareReplayButton>', () => {
  it('hands the link to the OS share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stub('share', share);
    render(<ShareReplayButton url={URL_} />);

    await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: URL_ }));
  });

  it('copies to the clipboard and says so when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stub('clipboard', { writeText });
    render(<ShareReplayButton url={URL_} />);

    await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('says nothing when the sharer closes the share sheet without sharing', async () => {
    // A dismissed share sheet rejects with AbortError. That is a person
    // changing their mind, not a failure, and must not read as one.
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'AbortError' }),
    );
    stub('share', share);
    render(<ShareReplayButton url={URL_} />);

    await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(screen.queryByText(/couldn|error/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('falls back to the bare link when neither sharing nor copying is available', async () => {
    render(<ShareReplayButton url={URL_} />);
    await userEvent.click(screen.getByRole('button', { name: /share replay/i }));

    // Nothing to copy with, so the link is put on screen to be copied by hand
    // rather than the button silently doing nothing.
    expect(await screen.findByText(URL_)).toBeInTheDocument();
  });

  it('falls back the same way when the clipboard is present but refuses', async () => {
    stub('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    render(<ShareReplayButton url={URL_} />);
    await userEvent.click(screen.getByRole('button', { name: /share replay/i }));

    expect(await screen.findByText(URL_)).toBeInTheDocument();
  });

  describe('with a story card to share', () => {
    // The whole point of JQ-122: Instagram Stories and Snapchat render no link
    // preview, so the file is the only thing that shows.
    it('hands the share sheet the image as well as the link', async () => {
      const { share } = withFileSharing();
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);

      await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
      await waitFor(() => expect(share).toHaveBeenCalled());
      const arg = share.mock.calls[0][0];
      expect(arg.url).toBe(URL_);
      expect(arg.files).toHaveLength(1);
      expect(arg.files[0].type).toBe('image/png');
      expect(fetch).toHaveBeenCalledWith(STORY_, expect.anything());
    });

    it('shares the link alone when the card cannot be fetched', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      stub('share', share);
      stub('canShare', vi.fn().mockReturnValue(true));
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);

      await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
      await waitFor(() => expect(share).toHaveBeenCalled());
      // A slow or missing image costs the image, never the share.
      expect(share.mock.calls[0][0].files).toBeUndefined();
      expect(share.mock.calls[0][0].url).toBe(URL_);
    });

    it('shares the link alone when the sheet refuses the file', async () => {
      const { share } = withFileSharing();
      share.mockRejectedValueOnce(new Error('not supported'));
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);

      await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
      expect(share.mock.calls[1][0].files).toBeUndefined();
    });

    it('says nothing when the sharer dismisses the sheet the card is in', async () => {
      const { share } = withFileSharing();
      share.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);

      await userEvent.click(screen.getByRole('button', { name: /share replay/i }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Copied')).not.toBeInTheDocument();
      expect(screen.queryByText(URL_)).not.toBeInTheDocument();
    });

    it('offers Save image only where the sheet will not take a file', async () => {
      stub('canShare', vi.fn().mockReturnValue(false));
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);
      const save = screen.getByRole('link', { name: /save image/i });
      expect(save).toHaveAttribute('href', STORY_);
      expect(save).toHaveAttribute('download');
    });

    it('hides Save image when the sheet will take the file instead', () => {
      withFileSharing();
      render(<ShareReplayButton url={URL_} imageUrl={STORY_} />);
      expect(screen.queryByRole('link', { name: /save image/i })).not.toBeInTheDocument();
    });

    it('offers nothing extra when there is no card to offer', () => {
      stub('canShare', vi.fn().mockReturnValue(false));
      render(<ShareReplayButton url={URL_} />);
      expect(screen.queryByRole('link', { name: /save image/i })).not.toBeInTheDocument();
    });
  });
});
