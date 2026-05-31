-- Rock Paper Scissors — initial schema (generalized seating model).
-- This lives in the GAME's own database (port 5433), never Lobby's (5432).
--
-- The model is intentionally generic so it scales beyond 2 players:
--   match -> seats (with optional team + role, optionally reserved for a
--   specific Lobby user) -> a player claims a seat.
-- RPS uses the "duel" mode (2 seats: a, b). The same tables describe chess
-- (white/black) or a MOBA (two teams of five) without schema changes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS matches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,          -- short self-serve join code
  external_match_id  TEXT UNIQUE,                   -- Lobby's matchId (nullable in standalone)
  name               TEXT NOT NULL,
  game_mode          TEXT NOT NULL DEFAULT 'duel',
  status             TEXT NOT NULL DEFAULT 'waiting'
                       CHECK (status IN ('waiting', 'playing', 'finished')),
  best_of            INTEGER NOT NULL DEFAULT 3,
  current_round      INTEGER NOT NULL DEFAULT 1,
  config             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seats are the slot template for a match. A seat may be reserved for a
-- specific Lobby user (set by a Lobby-pushed assignment); in standalone mode
-- the reservation is NULL and any arriving player may claim an open seat.
CREATE TABLE IF NOT EXISTS seats (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id                 UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_key                 TEXT NOT NULL,            -- 'a','b' | 'white' | 'radiant-mid'
  team_key                 TEXT,                     -- nullable team grouping
  role                     TEXT,                     -- nullable human role/label
  position                 INTEGER NOT NULL,         -- stable ordering
  reserved_for_lobby_user  TEXT,                     -- nullable Lobby user id
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, seat_key)
);

-- A player occupies exactly one seat (UNIQUE seat_id). lobby_user_id is set
-- when the player arrived through Lobby; NULL in standalone mode.
CREATE TABLE IF NOT EXISTS players (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_id        UUID NOT NULL UNIQUE REFERENCES seats(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  lobby_user_id  TEXT,
  score          INTEGER NOT NULL DEFAULT 0,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, lobby_user_id)
);

CREATE TABLE IF NOT EXISTS moves (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  move       TEXT NOT NULL CHECK (move IN ('rock', 'paper', 'scissors', 'lizard', 'spock')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, round, player_id)
);

CREATE TABLE IF NOT EXISTS round_results (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  outcome    TEXT NOT NULL,                          -- winning seat_key, or 'draw'
  moves      JSONB NOT NULL,                         -- { playerId: move }
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (match_id, round)
);

CREATE INDEX IF NOT EXISTS idx_seats_match ON seats(match_id);
CREATE INDEX IF NOT EXISTS idx_players_match ON players(match_id);
CREATE INDEX IF NOT EXISTS idx_moves_match_round ON moves(match_id, round);
CREATE INDEX IF NOT EXISTS idx_round_results_match ON round_results(match_id);
