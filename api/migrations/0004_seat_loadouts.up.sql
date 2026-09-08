-- JQ-148: a seat carries the loadout it was provisioned with.
--
-- Accepting a selection and then discarding it leaves duel-helpers playing exactly
-- like duel, so this is the column that makes the mode real.
ALTER TABLE seats
  ADD COLUMN IF NOT EXISTS loadout      JSONB,  -- ["ferrus","chimera"]; NULL is a duel seat
  ADD COLUMN IF NOT EXISTS loadout_roll TEXT;   -- displaced move when both helpers bind one

-- Which ability a seat spent, and in which round.
--
-- Everything else about a match replays from the move list, which is why the engine
-- can stay pure and a restart costs nothing. Firing is the exception: it is a
-- decision rather than a consequence, so a charge spent is only knowable if it was
-- written down. JQ-210 folds these rows the way `computeDelays` folds moves, which
-- makes charge state restart- and replica-safe by construction — but only because
-- the rows are here.
--
-- `target` is the move an ability named. It is not exposed for an unresolved round:
-- Quarantine names the move it fears, and an opponent who could read that would
-- simply play something else.
CREATE TABLE IF NOT EXISTS ability_firings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_id    UUID NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  round      INTEGER NOT NULL,
  helper_id  TEXT NOT NULL,
  target     TEXT,                              -- named move, or NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An ability occupies one slot on the cooldown track, so a seat fires at most one
  -- per round. The constraint is what stops a double-spend racing through.
  UNIQUE (match_id, round, seat_id)
);

CREATE INDEX IF NOT EXISTS idx_ability_firings_match ON ability_firings(match_id);
