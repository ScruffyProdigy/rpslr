import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareReplayButton } from './ShareReplayButton';

const URL_ = 'https://rpsls-duel.win/replay/ext-1';

function stub(name: 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

afterEach(() => {
  stub('share', undefined);
  stub('clipboard', undefined);
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
});
