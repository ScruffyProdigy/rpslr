DROP TABLE IF EXISTS ability_firings;
ALTER TABLE seats
  DROP COLUMN IF EXISTS loadout_roll,
  DROP COLUMN IF EXISTS loadout;
