ALTER TABLE round_results DROP COLUMN IF EXISTS auto_picked;
ALTER TABLE players DROP COLUMN IF EXISTS expiry_strikes;
ALTER TABLE matches
  DROP COLUMN IF EXISTS winner_seat_key,
  DROP COLUMN IF EXISTS end_reason,
  DROP COLUMN IF EXISTS phase_deadline,
  DROP COLUMN IF EXISTS phase;
