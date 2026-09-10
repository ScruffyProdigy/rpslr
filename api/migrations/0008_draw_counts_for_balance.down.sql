-- Back to JQ-152's definitions: `end_reason = 'played'` only, and a win rate over
-- every counted match. Dropped and rebuilt rather than replaced, because going back
-- removes `decisive`, `drawn` and `draw_rate`, which CREATE OR REPLACE cannot do.
DROP VIEW IF EXISTS v_shape_win_rate;
DROP VIEW IF EXISTS v_pairing_win_rate;
DROP VIEW IF EXISTS v_helper_win_rate;
DROP VIEW IF EXISTS v_loadout_outcomes;

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
  (s.loadout IS NOT NULL AND t.end_reason = 'played' AND NOT t.is_mirror) AS counts_for_balance
FROM v_seat_loadouts s
JOIN v_match_telemetry t ON t.match_id = s.match_id;

CREATE VIEW v_helper_win_rate AS
WITH played AS (
  SELECT h.helper_id, o.won, o.draws
  FROM v_loadout_outcomes o,
       LATERAL jsonb_array_elements_text(o.loadout) AS h(helper_id)
  WHERE o.counts_for_balance
)
SELECT
  c.id   AS helper_id,
  c.name,
  c.tier,
  COUNT(p.helper_id)                         AS matches,
  COUNT(*) FILTER (WHERE p.won)              AS wins,
  ROUND(
    COUNT(*) FILTER (WHERE p.won)::numeric / NULLIF(COUNT(p.helper_id), 0), 4
  )                                          AS win_rate,
  ROUND(AVG(p.draws), 2)                     AS avg_draws
FROM helper_catalog c
LEFT JOIN played p ON p.helper_id = c.id
GROUP BY c.id, c.name, c.tier
ORDER BY win_rate DESC NULLS LAST, c.id;

CREATE VIEW v_pairing_win_rate AS
SELECT
  o.helper_lo,
  o.helper_hi,
  c1.name || ' + ' || c2.name AS pairing,
  o.shape,
  COUNT(*)                                                       AS matches,
  COUNT(*) FILTER (WHERE o.won)                                  AS wins,
  ROUND(COUNT(*) FILTER (WHERE o.won)::numeric / COUNT(*), 4)    AS win_rate,
  ROUND(AVG(o.draws), 2)                                         AS avg_draws
FROM v_loadout_outcomes o
LEFT JOIN helper_catalog c1 ON c1.id = o.helper_lo
LEFT JOIN helper_catalog c2 ON c2.id = o.helper_hi
WHERE o.counts_for_balance
GROUP BY o.helper_lo, o.helper_hi, c1.name, c2.name, o.shape
ORDER BY matches DESC, o.helper_lo, o.helper_hi;

CREATE VIEW v_shape_win_rate AS
SELECT
  o.shape,
  COUNT(*)                                                    AS matches,
  COUNT(*) FILTER (WHERE o.won)                               AS wins,
  ROUND(COUNT(*) FILTER (WHERE o.won)::numeric / COUNT(*), 4) AS win_rate,
  ROUND(AVG(o.rounds), 2)                                     AS avg_rounds,
  ROUND(AVG(o.draws), 2)                                      AS avg_draws
FROM v_loadout_outcomes o
WHERE o.counts_for_balance
GROUP BY o.shape
ORDER BY matches DESC, o.shape;
