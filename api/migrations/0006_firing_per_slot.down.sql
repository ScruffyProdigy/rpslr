-- Reverting narrows what a seat may hold on a round, so a match already carrying
-- two firings for one seat in one round cannot be rolled back without losing one.
-- The wider constraint is therefore restored as-is and left to fail loudly if the
-- data has moved past it, rather than deleting a spent charge to make room.
ALTER TABLE ability_firings
  DROP CONSTRAINT IF EXISTS ability_firings_match_id_round_seat_id_helper_id_key;

ALTER TABLE ability_firings
  ADD CONSTRAINT ability_firings_match_id_round_seat_id_key
  UNIQUE (match_id, round, seat_id);
