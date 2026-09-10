-- JQ-238: one firing per ability *slot* per round, not one per seat.
--
-- 0004 wrote `UNIQUE (match_id, round, seat_id)` and justified it as "an ability
-- occupies one slot on the cooldown track, so a seat fires at most one per round".
-- That is true only of a loadout holding one ability. A loadout with two charge
-- cards has two slots, each with its own opening and its own recharge, and the
-- engine has always been plural: `PlayedRound.firedA` is an array and `fireEffects`
-- composes whatever it is handed.
--
-- Narrowed rather than dropped. The index is doing a second job the in-process
-- check cannot: it is what stops a double-tap racing through two connections from
-- spending the same charge twice, since both connections pass the check and only one
-- insert survives. Adding helper_id keeps that guarantee at the right granularity.
ALTER TABLE ability_firings
  DROP CONSTRAINT IF EXISTS ability_firings_match_id_round_seat_id_key;

ALTER TABLE ability_firings
  ADD CONSTRAINT ability_firings_match_id_round_seat_id_helper_id_key
  UNIQUE (match_id, round, seat_id, helper_id);
