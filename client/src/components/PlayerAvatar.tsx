import { useEffect, useState } from 'react';
import type { LobbyPlayerProfile } from '../api';
import UiIcon from './UiIcon';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
/** Seat role, not identity: you are blue and the opponent amber every match. */
type AvatarRole = 'you' | 'opp';

const SIZE_CLASS: Record<AvatarSize, string> = {
  xs: 'player-avatar--xs',
  sm: 'player-avatar--sm',
  md: 'player-avatar--md',
  lg: 'player-avatar--lg',
};

export function PlayerAvatar({
  profile,
  displayName,
  size = 'lg',
  role,
  placeholder = false,
  dimmed = false,
  ready = false,
  winner = false,
}: {
  profile: LobbyPlayerProfile | null;
  displayName: string;
  size?: AvatarSize;
  role?: AvatarRole;
  /** Reserved seat with no name yet — an empty disc, not an initial. */
  placeholder?: boolean;
  dimmed?: boolean;
  ready?: boolean;
  /** Took the match — a gold ring and a trophy, over the role colour. */
  winner?: boolean;
}) {
  const url = profile?.avatarUrl?.trim() || null;
  // Lobby avatars come from three sources (starter icon, spirit animal, guest
  // sigil) and none is guaranteed to resolve, so a dead URL falls back too.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  const initial = (displayName.trim()[0] ?? '').toUpperCase();

  return (
    <div
      className={[
        'player-avatar',
        SIZE_CLASS[size],
        role ? `player-avatar--${role}` : '',
        dimmed ? 'player-avatar--dimmed' : '',
        ready ? 'player-avatar--ready' : '',
        winner ? 'player-avatar--winner' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {url && !failed ? (
        <img className="player-avatar__img" src={url} alt="" onError={() => setFailed(true)} />
      ) : placeholder || !initial ? null : (
        <span className="player-avatar__initial">{initial}</span>
      )}
      {ready && <span className="player-avatar__ready-dot" title="Locked in" />}
      {winner && (
        <span className="player-avatar__trophy">
          <UiIcon name="trophy" />
        </span>
      )}
    </div>
  );
}
