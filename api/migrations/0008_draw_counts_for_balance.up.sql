-- JQ-255: a capped draw is balance data, and was being thrown away.
--
-- JQ-214 gave a match a round cap and ended a capped one with `end_reason = 'draw'`.
-- `counts_for_balance` (JQ-152) still read `end_reason = 'played'`, so every capped
-- draw fell out of `v_helper_win_rate`, `v_pairing_win_rate` and `v_shape_win_rate`.
--
-- That contradicts what the rule was for. It drops outcomes that say nothing about
-- a loadout — a network dropping out, two seats bringing the same two cards. A
-- capped draw says a great deal: it is what a draw-seeking build (Freeze, Sacrifice,
-- Echo Chamber) produces when it works. Those loadouts were vanishing from the
-- aggregates rather than showing up as strong-at-drawing, and absent reads as fine.
--
-- So the rule widens, and the rates split rather than lying:
--
--   * `won` is untouched. A drawn seat did not win, and nothing here pretends it did.
--   * `win_rate` is now wins over *decisive* matches. Draws are on neither side of
--     it, so a draw is neither a loss for both seats nor half a win for each — the
--     two ways to misprice a draw-lock build, in opposite directions.
--   * `drawn` and `draw_rate` carry the draws, next to the win rate rather than in
--     a view of their own, so one row is a helper's whole record.
--
-- For data written before the cap existed every match is decisive, so `win_rate`
-- means exactly what it meant before and `draw_rate` is 0.
--
-- The views are dropped and rebuilt rather than replaced in place: CREATE OR REPLACE
-- can only append columns, and `decisive`/`drawn` belong beside the counts they
-- qualify rather than after the averages.

DROP VIEW IF EXISTS v_shape_win_rate;
DROP VIEW IF EXISTS v_pairing_win_rate;
DROP VIEW IF EXISTS v_helper_win_rate;
DROP VIEW IF EXISTS v_loadout_outcomes;

-- Seat grain, carrying the match facts a balance query needs — and the one place
-- the "does this count" rule is written down.
CREATE VIEW v_loadout_outcomes AS
SELECT
  s.match_id,
  s.game_mode,
  s.seat_key,
  s.loadout,
  s.helper_lo,
  s.helper_hi,
  s.shape,
  s.won,
  t.end_reason,
  t.rounds,
  t.draws,
  t.is_mirror,
  -- What is excluded, and why: a win by disconnect (`forfeit-*`) is a fact about a
  -- network and an `abandoned` match is a fact about nobody turning up — neither
  -- says anything about a loadout. A mirror says nothing about either loadout,
  -- since both seats brought the same two cards. A seat with no loadout at all
  -- (`duel`) has nothing to attribute.
  --
  -- A capped draw is NOT excluded. It has no winner, but it is a played match
  -- between two present players and it is the outcome a draw-seeking build is
  -- built to reach. Telling a draw apart from a win is the rate columns' job, not
  -- this flag's — see `v_helper_win_rate`.
  (
    s.loadout IS NOT NULL
    AND t.end_reason IN ('played', 'draw')
    AND NOT t.is_mirror
  ) AS counts_for_balance
FROM v_seat_loadouts s
JOIN v_match_telemetry t ON t.match_id = s.match_id;

-- Strength. Every helper appears even at zero matches: a card nobody brings is a
-- balance finding, and it disappears from a view built by grouping the played rows.
--
-- `matches` counts everything the flag admits; `decisive` is the subset that had a
-- winner, and is `win_rate`'s denominator. A helper with draws but no decisive
-- match has a NULL win rate rather than a 0 — absent, because it is unmeasured,
-- rather than a card that loses.
CREATE VIEW v_helper_win_rate AS
WITH counted AS (
  SELECT h.helper_id, o.won, o.draws, o.end_reason
  FROM v_loadout_outcomes o,
       LATERAL jsonb_array_elements_text(o.loadout) AS h(helper_id)
  WHERE o.counts_for_balance
)
SELECT
  c.id   AS helper_id,
  c.name,
  c.tier,
  COUNT(p.helper_id)                                       AS matches,
  COUNT(*) FILTER (WHERE p.end_reason <> 'draw')           AS decisive,
  COUNT(*) FILTER (WHERE p.won)                            AS wins,
  COUNT(*) FILTER (WHERE p.end_reason = 'draw')            AS drawn,
  ROUND(
    COUNT(*) FILTER (WHERE p.won)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE p.end_reason <> 'draw'), 0), 4
  )                                                        AS win_rate,
  ROUND(
    COUNT(*) FILTER (WHERE p.end_reason = 'draw')::numeric
      / NULLIF(COUNT(p.helper_id), 0), 4
  )                                                        AS draw_rate,
  -- Drawn *rounds* per match, which is a different number: a match can be full of
  -- them and still be decided. A rise here is the first sign of a stalling combo.
  ROUND(AVG(p.draws), 2)                                   AS avg_draws
FROM helper_catalog c
LEFT JOIN counted p ON p.helper_id = c.id
GROUP BY c.id, c.name, c.tier
ORDER BY win_rate DESC NULLS LAST, c.id;

-- Win rate per loadout: any two helpers, including two Majors and two Minors.
-- Only pairings actually played appear — an unobserved pairing is absent rather
-- than a 0% one.
CREATE VIEW v_pairing_win_rate AS
SELECT
  o.helper_lo,
  o.helper_hi,
  c1.name || ' + ' || c2.name AS pairing,
  o.shape,
  COUNT(*)                                              AS matches,
  COUNT(*) FILTER (WHERE o.end_reason <> 'draw')        AS decisive,
  COUNT(*) FILTER (WHERE o.won)                         AS wins,
  COUNT(*) FILTER (WHERE o.end_reason = 'draw')         AS drawn,
  ROUND(
    COUNT(*) FILTER (WHERE o.won)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE o.end_reason <> 'draw'), 0), 4
  )                                                     AS win_rate,
  ROUND(
    COUNT(*) FILTER (WHERE o.end_reason = 'draw')::numeric / COUNT(*), 4
  )                                                     AS draw_rate,
  ROUND(AVG(o.draws), 2)                                AS avg_draws
FROM v_loadout_outcomes o
LEFT JOIN helper_catalog c1 ON c1.id = o.helper_lo
LEFT JOIN helper_catalog c2 ON c2.id = o.helper_hi
WHERE o.counts_for_balance
GROUP BY o.helper_lo, o.helper_hi, c1.name, c2.name, o.shape
ORDER BY matches DESC, o.helper_lo, o.helper_hi;

-- The tier ladder is only sound if observed shape win rates match the design
-- doc's predicted table. This is the view that settles it — and a shape that
-- draws its way to parity is a different finding from one that wins its way
-- there, which is why `draw_rate` sits next to `win_rate` here too.
CREATE VIEW v_shape_win_rate AS
SELECT
  o.shape,
  COUNT(*)                                              AS matches,
  COUNT(*) FILTER (WHERE o.end_reason <> 'draw')        AS decisive,
  COUNT(*) FILTER (WHERE o.won)                         AS wins,
  COUNT(*) FILTER (WHERE o.end_reason = 'draw')         AS drawn,
  ROUND(
    COUNT(*) FILTER (WHERE o.won)::numeric
      / NULLIF(COUNT(*) FILTER (WHERE o.end_reason <> 'draw'), 0), 4
  )                                                     AS win_rate,
  ROUND(
    COUNT(*) FILTER (WHERE o.end_reason = 'draw')::numeric / COUNT(*), 4
  )                                                     AS draw_rate,
  ROUND(AVG(o.rounds), 2)                               AS avg_rounds,
  ROUND(AVG(o.draws), 2)                                AS avg_draws
FROM v_loadout_outcomes o
WHERE o.counts_for_balance
GROUP BY o.shape
ORDER BY matches DESC, o.shape;
