/**
 * Everything the card says, worked out once from the match and handed to the
 * SVG and the meta tags alike. Pure: no fetching, no rendering, no Express.
 */
import type { Move } from '../game.js';
import type { MatchState, RoundResult, Seat } from '../types.js';

export type CardKind = 'match' | 'generic';

export interface CardPlayer {
  seatKey: string;
  name: string;
  score: number;
  /** Left seat wears --you, right seat wears --opp, as on the board. */
  role: 'you' | 'opp';
  avatarUrl: string | null;
  /** Filled in later by the avatar fetcher; null until then. */
  avatarDataUri: string | null;
  initial: string;
  winner: boolean;
}

export interface CardModel {
  kind: CardKind;
  ref: string;
  /** Drawn on the image. */
  headline: string;
  ogTitle: string;
  ogDescription: string;
  /** Empty for kind 'generic'; exactly two entries, winner first, for 'match'. */
  players: CardPlayer[];
  /** false for generic and unfinished — those must not be cached by a platform. */
  cacheable: boolean;
}

const MAX_DESCRIPTION = 200;
const SEPARATOR = ' · ';
/** En dash: a score is a range, not a subtraction. */
const DASH = '–';

export function genericCardModel(ref: string): CardModel {
  return {
    kind: 'generic',
    ref,
    headline: 'RPSLR on JoinQuest',
    ogTitle: 'RPSLR on JoinQuest',
    ogDescription:
      'Rock, paper, scissors, lizard, robot — every move goes on cooldown after you play it.',
    players: [],
    cacheable: false,
  };
}

export function buildCardModel(
  state: MatchState | null,
  opts: { ref: string; by?: string | null },
): CardModel {
  if (!state || state.match.status !== 'finished') return genericCardModel(opts.ref);

  const seats = [...state.seats].sort((a, b) => a.position - b.position);
  if (seats.length !== 2 || seats.some((s) => !s.player)) return genericCardModel(opts.ref);

  const winnerSeatKey = state.matchWinnerSeatKey ?? state.match.winnerSeatKey;
  const decided = winnerSeatKey !== null && winnerSeatKey !== 'draw';

  // Winner first, so the eye lands on the name the title leads with. A draw
  // keeps seat order, because there is no one to lead with.
  const ordered = decided
    ? [...seats].sort(
        (a, b) => Number(b.seatKey === winnerSeatKey) - Number(a.seatKey === winnerSeatKey),
      )
    : seats;

  const players: CardPlayer[] = ordered.map((seat, index) => {
    const name = displayName(seat);
    return {
      seatKey: seat.seatKey,
      name,
      score: seat.player?.score ?? 0,
      role: index === 0 ? 'you' : 'opp',
      avatarUrl:
        seat.lobbyProfile?.avatarUrl?.trim() || seat.player?.profile?.avatarUrl?.trim() || null,
      avatarDataUri: null,
      initial: initialOf(name),
      winner: decided && seat.seatKey === winnerSeatKey,
    };
  });

  const [first, second] = players;
  const score = `${first.score}${DASH}${second.score}`;
  // ?by= names the sharer, not the winner. A sharer who lost gets the neutral
  // card: a link forwarded after a loss should not announce the loss.
  const celebrate = decided && opts.by != null && opts.by === winnerSeatKey;
  const neutralHeadline = `${first.name} vs ${second.name} · ${score}`;

  return {
    kind: 'match',
    ref: opts.ref,
    headline: celebrate ? `${first.name} wins ${score}` : neutralHeadline,
    ogTitle: !decided
      ? `${first.name} and ${second.name} drew ${score} in RPSLR`
      : celebrate
        ? `${first.name} wins ${score}!`
        : `${first.name} beat ${second.name} ${score} in RPSLR`,
    ogDescription: describeRounds(state, ordered, first.name, decided),
    players,
    cacheable: true,
  };
}

function displayName(seat: Seat): string {
  return (
    seat.lobbyProfile?.displayName?.trim() ||
    seat.player?.profile?.displayName?.trim() ||
    seat.player?.name?.trim() ||
    'Challenger'
  );
}

/** Empty when the name opens with something that has no letter form. */
function initialOf(name: string): string {
  const first = name.trim()[0] ?? '';
  const upper = first.toUpperCase();
  return /\p{Letter}|\p{Number}/u.test(upper) ? upper : '';
}

function describeRounds(
  state: MatchState,
  seats: Seat[],
  winnerName: string,
  decided: boolean,
): string {
  if (state.match.endReason && state.match.endReason !== 'played') {
    const rounds = state.results.length;
    const who = decided ? winnerName : 'Nobody';
    return `${who} won on forfeit after ${rounds} round${rounds === 1 ? '' : 's'}`;
  }

  return truncate(state.results.map((result) => describeRound(result, seats)).join(SEPARATOR));
}

function describeRound(result: RoundResult, seats: Seat[]): string {
  if (result.outcome === 'draw') return `${result.round} draw`;
  const winner = seats.find((s) => s.seatKey === result.outcome);
  const loser = seats.find((s) => s.seatKey !== result.outcome);
  const winnerMove = moveOf(result, winner);
  const loserMove = moveOf(result, loser);
  if (!winnerMove || !loserMove) return `${result.round} decided`;
  return `${result.round} ${label(winnerMove)} over ${label(loserMove)}`;
}

function moveOf(result: RoundResult, seat: Seat | undefined): Move | undefined {
  const playerId = seat?.player?.id;
  return playerId ? result.moves[playerId] : undefined;
}

function label(move: Move): string {
  return move[0].toUpperCase() + move.slice(1);
}

/** Cuts on a separator so the line never ends mid-round. */
function truncate(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text;
  const room = MAX_DESCRIPTION - 1;
  const cut = text.lastIndexOf(SEPARATOR, room);
  const head = cut > 0 ? text.slice(0, cut) : text.slice(0, room).trimEnd();
  return `${head}…`;
}
