-- JQ-149: the loadout reveal is a phase, and a phase the players can end.
--
-- The reveal has its own deadline (`matches.phase` = 'loadouts'), and the
-- deadline is generous — reading four helper cards takes about as long as
-- reading the rules, which watched players took a good 30 seconds over. A cap
-- that long is only affordable because it is a cap: when both seats say they
-- have read it, round 1 starts, and nobody waits out a clock they are done with.
--
-- Its own table rather than a column on `matches`, for the same reason
-- `sub_phase_actions` is one: a row per seat is the shape of the question, and
-- the primary key is what makes a second tap idempotent instead of a race.
--
-- Not `sub_phase_actions` with round 0, which was the other way to avoid a
-- migration: that table is the mid-round window's, and JQ-262's pacing views
-- count its rows as pauses. A reveal ack is not a pause in a round.
CREATE TABLE IF NOT EXISTS loadout_acks (
  match_id   UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_id    UUID NOT NULL REFERENCES seats(id)   ON DELETE CASCADE,
  acked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, seat_id)
);
