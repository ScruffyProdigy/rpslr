-- JQ-152: pick rate and win rate per helper and per pairing.
--
-- This is a read model, not a write path. Every fact the balance work needs is
-- already recorded: the loadout on `seats` (JQ-147), the winner and end reason on
-- `matches` (JQ-156), every round's outcome and moves in `round_results`, every
-- charge spent in `ability_firings` (JQ-210). Shape, mirror-ness, draw counts and
-- whether Quarantine's named move landed are all functions of those rows.
--
-- Writing a denormalised summary row at match end instead would duplicate facts
-- already written down, could drift from the move list, and would only ever cover
-- matches played after it shipped. These views cover the ones already played.

-- The roster, as SQL can see it. Everything here is derivable from
-- `api/src/helpers/roster.ts` except by SQL, which cannot read TypeScript.
--
-- Deliberately left EMPTY by this migration. `syncHelperCatalog` fills it from the
-- roster at the end of `npm run migrate` and again when the API boots, so the
-- roster stays the single source of truth and a re-priced card (JQ-209) reaches
-- SQL without a migration to correct it.
CREATE TABLE IF NOT EXISTS helper_catalog (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tier              TEXT NOT NULL CHECK (tier IN ('Major', 'Minor', 'Trinket')),
  -- Opening marks the tier costs. Carried so a pair can be ordered by tier
  -- without SQL keeping its own opinion about which tier outranks which.
  mark_cost         INTEGER NOT NULL,
  bound_move        TEXT,                  -- NULL for a Trinket
  load_kind         TEXT NOT NULL CHECK (load_kind IN ('passive', 'ability')),
  ability_opening   INTEGER,               -- NULL unless load_kind = 'ability'
  ability_recharge  INTEGER,               -- NULL for a once-per-match charge
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per seat in a finished match.
--
-- A `duel` seat has no loadout. That is the null loadout rather than a special
-- case, so it stays in the view and simply carries NULLs — which is what lets the
-- two modes be compared on one path.
CREATE OR REPLACE VIEW v_seat_loadouts AS
SELECT
  m.id                AS match_id,
  m.game_mode,
  m.end_reason,
  s.id                AS seat_id,
  s.seat_key,
  s.position,
  s.loadout,
  s.loadout ->> 0     AS helper_1,
  s.loadout ->> 1     AS helper_2,
  -- Order-independent identity for a pairing: {a,b} and {b,a} are one loadout.
  LEAST(s.loadout ->> 0, s.loadout ->> 1)     AS helper_lo,
  GREATEST(s.loadout ->> 0, s.loadout ->> 1)  AS helper_hi,
  -- The dearer helper names the shape first, so 'Major+Minor' has one spelling.
  CASE
    WHEN c1.id IS NULL OR c2.id IS NULL THEN NULL
    WHEN c1.mark_cost >= c2.mark_cost THEN c1.tier || '+' || c2.tier
    ELSE c2.tier || '+' || c1.tier
  END                 AS shape,
  m.winner_seat_key IS NOT NULL AND m.winner_seat_key = s.seat_key AS won
FROM matches m
JOIN seats s              ON s.match_id = m.id
LEFT JOIN helper_catalog c1 ON c1.id = s.loadout ->> 0
LEFT JOIN helper_catalog c2 ON c2.id = s.loadout ->> 1
WHERE m.status = 'finished';

-- One row per finished match. Two seats, which is what `resolveDuelRound` assumes.
CREATE OR REPLACE VIEW v_match_telemetry AS
WITH ranked AS (
  SELECT v.*, ROW_NUMBER() OVER (PARTITION BY v.match_id ORDER BY v.position) AS rn
  FROM v_seat_loadouts v
),
rounds AS (
  SELECT
    match_id,
    COUNT(*)                                     AS rounds,
    COUNT(*) FILTER (WHERE outcome = 'draw')     AS draws
  FROM round_results
  GROUP BY match_id
)
SELECT
  m.id            AS match_id,
  m.code,
  m.game_mode,
  m.end_reason,
  m.winner_seat_key,
  m.created_at,
  a.seat_key      AS seat_a_key,
  a.loadout       AS seat_a_loadout,
  a.shape         AS seat_a_shape,
  b.seat_key      AS seat_b_key,
  b.loadout       AS seat_b_loadout,
  b.shape         AS seat_b_shape,
  COALESCE(r.rounds, 0) AS rounds,
  -- Several helpers convert losses into draws. A rise here is the first sign of a
  -- stalling combo, which is why it is a column rather than something to derive.
  COALESCE(r.draws, 0)  AS draws,
  -- Both seats brought the same two helpers. Says nothing about the loadout, so
  -- the win-rate views drop it — but it is flagged rather than deleted, so it can
  -- be counted deliberately.
  COALESCE(
    a.loadout IS NOT NULL AND b.loadout IS NOT NULL
      AND a.helper_lo = b.helper_lo AND a.helper_hi = b.helper_hi,
    FALSE
  )               AS is_mirror
FROM matches m
JOIN ranked a ON a.match_id = m.id AND a.rn = 1
JOIN ranked b ON b.match_id = m.id AND b.rn = 2
LEFT JOIN rounds r ON r.match_id = m.id
WHERE m.status = 'finished';

-- Seat grain again, now carrying the match facts a balance query needs — and the
-- one place the "does this count" rule is written down.
CREATE OR REPLACE VIEW v_loadout_outcomes AS
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
  -- SUPERSEDED by 0008_draw_counts_for_balance.up.sql (JQ-255). An applied
  -- migration is not edited, so what follows is left as it ran — but it is no
  -- longer the rule in force, and neither are the three win-rate views below it,
  -- which 0008 rebuilds. Read 0008 for the current definition.
  --
  -- What it said, and why it was wrong: a win by disconnect is a fact about a
  -- network, not about a loadout; a mirror is a fact about neither. True of both,
  -- and the reason the rule exists. But JQ-214 then gave a capped match
  -- `end_reason = 'draw'`, and `= 'played'` silently swept those out too — and a
  -- capped draw is exactly what a draw-seeking build produces when it works.
  (s.loadout IS NOT NULL AND t.end_reason = 'played' AND NOT t.is_mirror) AS counts_for_balance
FROM v_seat_loadouts s
JOIN v_match_telemetry t ON t.match_id = s.match_id;

-- How often a card is brought. Popularity, not strength — deliberately counting
-- mirrors and forfeits, because a helper picked into either was still picked.
--
-- The denominator is seat-loadouts and every seat brings two helpers, so these
-- rates sum to 2.0.
CREATE OR REPLACE VIEW v_helper_pick_rate AS
WITH picks AS (
  SELECT h.helper_id
  FROM v_seat_loadouts s,
       LATERAL jsonb_array_elements_text(s.loadout) AS h(helper_id)
  WHERE s.loadout IS NOT NULL
),
total AS (
  SELECT COUNT(*) AS seats FROM v_seat_loadouts WHERE loadout IS NOT NULL
)
SELECT
  c.id   AS helper_id,
  c.name,
  c.tier,
  COUNT(p.helper_id) AS times_picked,
  ROUND(COUNT(p.helper_id)::numeric / NULLIF((SELECT seats FROM total), 0), 4) AS pick_rate
FROM helper_catalog c
LEFT JOIN picks p ON p.helper_id = c.id
GROUP BY c.id, c.name, c.tier
ORDER BY times_picked DESC, c.id;

-- Strength. Every helper appears even at zero matches: a card nobody brings is a
-- balance finding, and it disappears from a view built by grouping the played rows.
CREATE OR REPLACE VIEW v_helper_win_rate AS
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

-- Win rate per loadout: any two helpers, including two Majors and two Minors.
-- Only pairings actually played appear — an unobserved pairing is absent rather
-- than a 0% one.
CREATE OR REPLACE VIEW v_pairing_win_rate AS
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

-- The tier ladder is only sound if observed shape win rates match the design
-- doc's predicted table. This is the view that settles it.
CREATE OR REPLACE VIEW v_shape_win_rate AS
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

-- Every charge spent, and what it bought.
--
-- Quarantine names the move it fears and is paid for either way, so its perceived
-- value and its real value are different numbers. `target_hit` is the difference:
-- the named move against the move the opponent actually played that round.
CREATE OR REPLACE VIEW v_ability_firings AS
SELECT
  f.match_id,
  m.game_mode,
  s.seat_key,
  f.helper_id,
  c.name              AS helper_name,
  f.round,
  f.target,
  opp.move            AS opponent_move,
  CASE WHEN f.target IS NULL OR opp.move IS NULL THEN NULL ELSE f.target = opp.move END
                      AS target_hit,
  rr.outcome          AS round_outcome,
  rr.outcome = s.seat_key AS won_round
FROM ability_firings f
JOIN matches m       ON m.id = f.match_id
JOIN seats s         ON s.id = f.seat_id
LEFT JOIN helper_catalog c ON c.id = f.helper_id
-- A firing in a round that never resolved (the match was forfeited under it) has
-- no opponent move to compare against, and lands here as NULL rather than a miss.
LEFT JOIN round_results rr ON rr.match_id = f.match_id AND rr.round = f.round
LEFT JOIN LATERAL (
  SELECT rr.moves ->> p.id::text AS move
  FROM seats os
  JOIN players p ON p.seat_id = os.id
  WHERE os.match_id = f.match_id AND os.id <> f.seat_id
  LIMIT 1
) opp ON TRUE
WHERE m.status = 'finished';

-- Whether a charge was spent at all, and how soon.
--
-- The denominator is matches the card was *brought* into, which is why the catalog
-- carries `load_kind`: a charge that is never fired is a card that costs a Major
-- slot and does nothing, and only the brought count makes that visible.
CREATE OR REPLACE VIEW v_charge_usage AS
WITH brought AS (
  SELECT h.helper_id, COUNT(*) AS matches_brought
  FROM v_seat_loadouts s,
       LATERAL jsonb_array_elements_text(s.loadout) AS h(helper_id)
  WHERE s.loadout IS NOT NULL
  GROUP BY h.helper_id
),
per_seat AS (
  SELECT f.helper_id, f.match_id, f.seat_id,
         COUNT(*) AS firings, MIN(f.round) AS first_round
  FROM ability_firings f
  JOIN matches m ON m.id = f.match_id AND m.status = 'finished'
  GROUP BY f.helper_id, f.match_id, f.seat_id
)
SELECT
  c.id   AS helper_id,
  c.name,
  c.ability_opening,
  c.ability_recharge,
  COALESCE(b.matches_brought, 0)        AS matches_brought,
  COUNT(ps.seat_id)                     AS matches_fired,
  COALESCE(SUM(ps.firings), 0)          AS firings,
  ROUND(COALESCE(SUM(ps.firings), 0)::numeric / NULLIF(b.matches_brought, 0), 3)
                                        AS firings_per_match,
  ROUND(AVG(ps.first_round), 2)         AS avg_first_round
FROM helper_catalog c
LEFT JOIN brought b  ON b.helper_id = c.id
LEFT JOIN per_seat ps ON ps.helper_id = c.id
WHERE c.load_kind = 'ability'
GROUP BY c.id, c.name, c.ability_opening, c.ability_recharge, b.matches_brought
ORDER BY c.id;
