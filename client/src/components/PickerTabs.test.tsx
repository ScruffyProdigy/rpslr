import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PickerTabs } from './PickerTabs';
import { PLAYER_VOICE, spectatorVoice } from '../lib/voice';
import type { Identity } from '../lib/seatProfile';

const YOU: Identity = { profile: null, name: 'Ada', placeholder: false };
const THEM: Identity = { profile: null, name: 'Robin', placeholder: false };

function renderTabs(over: Partial<Parameters<typeof PickerTabs>[0]> = {}) {
  const onView = over.onView ?? vi.fn();
  const utils = render(
    <PickerTabs
      view={over.view ?? 'mine'}
      onView={onView}
      you={over.you ?? YOU}
      opponent={over.opponent ?? THEM}
      voice={over.voice ?? PLAYER_VOICE}
      panelId={over.panelId ?? 'move-board-panel'}
    />,
  );
  return { ...utils, onView };
}

describe('<PickerTabs> names both sides (JQ-324)', () => {
  it('puts your moves first, and opens on them', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveTextContent(/your moves/i);
    expect(tabs[1]).toHaveTextContent(/Robin's moves/i);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('names both players on a replay, where there is no you', () => {
    renderTabs({ voice: spectatorVoice('Ada') });
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent(/Ada's moves/i);
    expect(tabs[1]).toHaveTextContent(/Robin's moves/i);
  });

  it('falls back to "their moves" for a seat with no name yet', () => {
    renderTabs({ opponent: { profile: null, name: 'Opponent', placeholder: true } });
    expect(screen.getAllByRole('tab')[1]).toHaveTextContent(/their moves/i);
  });

  it('points both tabs at the board they switch', () => {
    renderTabs();
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'move-board-panel');
    }
  });
});

describe('<PickerTabs> switching (JQ-324)', () => {
  it('asks for the other view on a tap', async () => {
    const { onView } = renderTabs();
    await userEvent.click(screen.getAllByRole('tab')[1]);
    expect(onView).toHaveBeenCalledWith('theirs');
  });

  it('does not ask again for the view already open', async () => {
    const { onView } = renderTabs();
    await userEvent.click(screen.getAllByRole('tab')[0]);
    expect(onView).not.toHaveBeenCalled();
  });

  it('moves between tabs with the arrow keys', async () => {
    const { onView } = renderTabs();
    screen.getAllByRole('tab')[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onView).toHaveBeenCalledWith('theirs');
  });

  it('wraps around, so either arrow reaches the other tab', async () => {
    const { onView } = renderTabs();
    screen.getAllByRole('tab')[0].focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(onView).toHaveBeenCalledWith('theirs');
  });

  it('takes Home and End to the ends', async () => {
    const { onView } = renderTabs({ view: 'theirs' });
    screen.getAllByRole('tab')[1].focus();
    await userEvent.keyboard('{Home}');
    expect(onView).toHaveBeenCalledWith('mine');
  });
});

describe('<PickerTabs> is reachable and readable (JQ-324)', () => {
  // A tablist is one tab stop: the arrows move within it, so a keyboard does
  // not have to walk past a control to reach the board.
  it('keeps only the open tab in the tab order', () => {
    renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  });

  it('says which side is open without relying on colour', () => {
    renderTabs({ view: 'theirs' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveClass('picker-tab--active');
    expect(tabs[0]).not.toHaveClass('picker-tab--active');
  });

  it('carries each player’s avatar, silently', () => {
    const { container } = renderTabs();
    const avatars = container.querySelectorAll('.player-avatar');
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });

  it('labels the strip, so the two tabs are heard as a pair', () => {
    renderTabs();
    expect(screen.getByRole('tablist')).toHaveAccessibleName(/whose moves/i);
  });
});
