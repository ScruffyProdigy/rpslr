import type { LobbyPlayerProfile } from '../api';

type AvatarSize = 'md' | 'lg';

const SIZE_CLASS: Record<AvatarSize, string> = {
  md: 'player-avatar--md',
  lg: 'player-avatar--lg',
};

export function PlayerAvatar({
  profile,
  displayName,
  size = 'lg',
  highlight = false,
  dimmed = false,
  ready = false,
}: {
  profile: LobbyPlayerProfile | null;
  displayName: string;
  size?: AvatarSize;
  highlight?: boolean;
  dimmed?: boolean;
  ready?: boolean;
}) {
  const initial = (displayName.trim()[0] ?? '?').toUpperCase();
  const url = profile?.avatarUrl?.trim();

  return (
    <div
      className={[
        'player-avatar',
        SIZE_CLASS[size],
        highlight ? 'player-avatar--you' : '',
        dimmed ? 'player-avatar--dimmed' : '',
        ready ? 'player-avatar--ready' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden={!displayName}
    >
      {url ? (
        <img className="player-avatar__img" src={url} alt="" />
      ) : (
        <span className="player-avatar__initial">{initial}</span>
      )}
      {ready && <span className="player-avatar__ready-dot" title="Locked in" />}
    </div>
  );
}
