-- JQ-262: how much of a match is spent paused, and what bought each pause.
--
-- The mid-round sub-phase is a pause in a game whose whole texture is
-- simultaneous commitment, so its frequency is a pacing budget. Nothing counted
-- the spend. These views count it.
--
-- A read model, like the rest of JQ-152's telemetry: every fact is already on
-- `ability_firings` and `round_results`, and `sub_phase_actions` (JQ-239) is the
-- wrong denominator — it records seats that *acted*, so a window everyone let
-- expire leaves no row at all. Entry is derived from the firings instead, which
-- is what `entitlementsIn` does.
--
-- Two columns are needed to derive it, and both live in `roster.ts` where SQL
-- cannot read them. They join `helper_catalog`'s existing mirror rather than
-- being seeded here, so a card that changes its disclosure reaches SQL through
-- `syncHelperCatalog` and not through a migration correcting this one.
ALTER TABLE helper_catalog
  -- 'public' | 'secret', and NULL for a passive, which has no firing to disclose.
  -- Unconstrained for the same reason `matches.phase` is: a third value on this
  -- axis (a card firing publicly at its own board) is a roster decision, and a
  -- CHECK here would make it a migration.
  ADD COLUMN IF NOT EXISTS reveal             TEXT,
  -- Whether firing it tells its *own holder* something — `revealDrawFor` in
  -- `helpers/reveals.ts`. Separate from `reveal`: Oracle is secret on that axis
  -- and still opens a window, because the two questions are genuinely different.
  ADD COLUMN IF NOT EXISTS informs_its_holder BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per round that actually paused, and what bought the pause.
--
-- Entry, as the service decides it (`enterSubPhase`), is three conditions:
--
--   1. some firing this round either informs its holder or fires in public —
--      this is `entitlementsIn`, which asks nothing about *when* it was fired
--      (JQ-262 verified that, against the assumption that firing early was free);
--   2. the round resolved, so a firing left stranded by a forfeit bought nothing;
--   3. nobody was auto-picked, because a round that ran out of clock resolves
--      straight from `enforceDeadlines` and never reaches `enterSubPhase`. It has
--      already overrun, and a further allowance would reward the overrun.
--
-- The third is why this reads `round_results` at all rather than the firings
-- alone: without it, every expired round with a charge spent in it would be
-- counted as a pause that never happened.
CREATE OR REPLACE VIEW v_sub_phase_rounds AS
SELECT
  r.match_id,
  r.round,
  -- Not exclusive. A round holding both is still one pause — the rule is one
  -- sub-phase per round — so a match's pause count must come from counting these
  -- rows, never from summing the two causes.
  bool_or(c.informs_its_holder)  AS from_reveal,
  bool_or(c.reveal = 'public')   AS from_public_firing
FROM round_results r
JOIN ability_firings f ON f.match_id = r.match_id AND f.round = r.round
JOIN helper_catalog c  ON c.id = f.helper_id
WHERE jsonb_array_length(r.auto_picked) = 0
GROUP BY r.match_id, r.round
HAVING bool_or(c.informs_its_holder OR c.reveal = 'public');

-- The budget, per finished match: how many of its rounds paused, and why.
--
-- `rounds` is the denominator that matters — "two pauses" means something
-- different in a three-round match and a nine-round one, and the pacing question
-- is about the fraction.
CREATE OR REPLACE VIEW v_sub_phase_budget AS
SELECT
  t.match_id,
  t.game_mode,
  t.rounds,
  COUNT(sp.round)                                        AS sub_phases,
  COUNT(sp.round) FILTER (WHERE sp.from_reveal)          AS from_reveal,
  COUNT(sp.round) FILTER (WHERE sp.from_public_firing)   AS from_public_firing,
  -- Both causes in one round: one pause, two reasons. Counted so the two cause
  -- columns can be reconciled against the total instead of appearing to overrun it.
  COUNT(sp.round) FILTER (WHERE sp.from_reveal AND sp.from_public_firing) AS from_both,
  ROUND(COUNT(sp.round)::numeric / NULLIF(t.rounds, 0), 4) AS paused_round_share
FROM v_match_telemetry t
LEFT JOIN v_sub_phase_rounds sp ON sp.match_id = t.match_id
GROUP BY t.match_id, t.game_mode, t.rounds
ORDER BY sub_phases DESC, t.match_id;

-- Which cards are actually buying the pauses, so "too many pauses" has a lever.
--
-- Only cards that *can* open a window appear. One that cannot is absent rather
-- than a zero row: it is not part of this question, and a roster of zeroes buries
-- the three rows that are.
--
-- `firings` counts every firing; `rounds_paused` counts only those that landed in
-- a round that actually paused. The gap between them is the interesting number —
-- a charge spent in a round that ran out of clock, or alongside another firing in
-- a round already paused, cost the match nothing. The join is therefore LEFT: an
-- inner one would drop those firings and make the two columns say the same thing.
CREATE OR REPLACE VIEW v_sub_phase_sources AS
SELECT
  c.id     AS helper_id,
  c.name,
  c.tier,
  c.reveal,
  c.informs_its_holder,
  c.ability_recharge,
  COUNT(*)                                   AS firings,
  COUNT(DISTINCT (f.match_id, f.round))
    FILTER (WHERE sp.round IS NOT NULL)      AS rounds_paused,
  COUNT(DISTINCT f.match_id)                 AS matches
FROM ability_firings f
JOIN helper_catalog c ON c.id = f.helper_id
LEFT JOIN v_sub_phase_rounds sp ON sp.match_id = f.match_id AND sp.round = f.round
WHERE c.informs_its_holder OR c.reveal = 'public'
GROUP BY c.id, c.name, c.tier, c.reveal, c.informs_its_holder, c.ability_recharge
ORDER BY rounds_paused DESC, c.id;
