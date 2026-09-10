# Loadout telemetry

Pick rate and win rate per helper and per pairing, for the balance work on
`duel-helpers`. JQ-152.

Asymmetric balance is settled by aggregate win-rate parity across many matches at
similar skill, not at a whiteboard. The design doc's numbers are equilibrium values
that assume both players mix perfectly; real players are readable, which is the
actual game. These views are how a strong helper is told apart from a popular one.

## There is no ingestion step

Nothing is written for telemetry's benefit. Every number below is derived from rows
the match already writes — the loadout on `seats`, the winner and end reason on
`matches`, each round in `round_results`, each charge spent in `ability_firings`.

Two consequences worth knowing:

- The views cover **matches already played**, not just ones played since this
  shipped.
- They cannot drift from what actually happened, because there is no second copy.

The one thing SQL cannot derive is a helper's tier, which is declared in
`api/src/helpers/roster.ts`. That is mirrored into `helper_catalog` by
`syncHelperCatalog`, which runs at the end of `npm run migrate` and again when the
API boots. **Do not hand-edit `helper_catalog`** — the next boot overwrites it.

## What counts as balance data

`v_loadout_outcomes.counts_for_balance` is the only definition, and the win-rate
views are the only things that apply it:

- **Mirrors are excluded.** Both seats bringing the same two helpers says nothing
  about the loadout. `v_match_telemetry.is_mirror` still flags them.
- **Forfeits and abandonments are excluded.** A win by disconnect is a fact about
  a network; an abandoned match is a fact about nobody turning up.
- **Capped draws count** (`end_reason = 'draw'`). A match that reached the round
  cap level has no winner, but it was played by two present players, and it is
  the outcome a draw-seeking loadout is built to reach. Excluding it would hide
  exactly the builds it describes — and absent reads as fine.

### A draw is not half a win, and not a loss

`won` is a fact and stays one: in a capped draw it is `false` for both seats. So
the rate columns do the work instead. Each win-rate view carries:

| Column | Meaning |
|---|---|
| `matches` | every seat-match `counts_for_balance` admits |
| `decisive` | the subset that had a winner |
| `wins` / `drawn` | how those matches split |
| `win_rate` | `wins / decisive` — draws are on **neither** side of it |
| `draw_rate` | `drawn / matches` |
| `avg_draws` | drawn *rounds* per match, which is a different number |

A draw-lock build therefore reads as a normal win rate next to a high draw rate,
rather than as a card that loses half its matches (scoring draws as losses) or one
that trades evenly (averaging them in at 0.5). A helper with draws but no decisive
match has a **NULL** `win_rate`: unmeasured, not bad.

`decisive` is also the honest sample size for `win_rate`. `matches > 30` is the
wrong filter for a draw-heavy card; use `decisive > 30`.

For matches played before the round cap shipped (JQ-214) every match is decisive,
so `win_rate` means what it always meant and `draw_rate` is 0.

`v_helper_pick_rate` deliberately applies none of it: a helper picked into a mirror
or a forfeit was still picked, and popularity is what that view measures. Pick rates are per
seat-loadout and every seat brings two helpers, so they sum to 2.0.

`duel` matches sit in `v_match_telemetry` with NULL loadouts — the null loadout
rather than a special case — so round counts and draw rates can be compared across
the two modes. They contribute nothing to the helper views.

## The queries

```sql
-- Which cards people bring. Every helper appears, including at zero.
SELECT * FROM v_helper_pick_rate;

-- Which cards win. `decisive` is the sample size behind `win_rate`; treat a small
-- one as noise, and read `draw_rate` beside it rather than instead of it.
SELECT * FROM v_helper_win_rate WHERE decisive > 30 ORDER BY win_rate DESC;

-- Which cards draw. A build that plays for the cap lives here, not above.
SELECT * FROM v_helper_win_rate WHERE matches > 30 ORDER BY draw_rate DESC;

-- Win rate per loadout — any two helpers, including two Majors or two Minors.
SELECT * FROM v_pairing_win_rate WHERE decisive > 20 ORDER BY win_rate DESC LIMIT 20;

-- The tier ladder is only sound if these match the design doc's predicted table.
SELECT * FROM v_shape_win_rate;

-- Popular but weak, or unpopular but strong: the two lists that move the roster.
SELECT p.name, p.tier, p.pick_rate, w.win_rate, w.matches
FROM v_helper_pick_rate p
JOIN v_helper_win_rate w USING (helper_id)
ORDER BY w.win_rate DESC NULLS LAST;

-- Quarantine's real value against its perceived value: it is paid for either way.
SELECT helper_id,
       COUNT(*)                                        AS firings,
       COUNT(*) FILTER (WHERE target_hit)              AS hits,
       ROUND(AVG(target_hit::int)::numeric, 3)         AS hit_rate
FROM v_ability_firings
WHERE target IS NOT NULL
GROUP BY helper_id;

-- A charge that is never fired is a Major slot spent on nothing.
SELECT * FROM v_charge_usage ORDER BY firings_per_match NULLS FIRST;

-- Drawn rounds per match, by loadout. Several helpers convert losses into draws,
-- and a rise here is the first sign of a stalling combo.
SELECT pairing, matches, avg_draws FROM v_pairing_win_rate ORDER BY avg_draws DESC;

-- The two modes side by side.
SELECT game_mode, COUNT(*) AS matches, ROUND(AVG(rounds), 2) AS avg_rounds,
       ROUND(AVG(draws), 2) AS avg_draws
FROM v_match_telemetry GROUP BY game_mode;

-- How matches end. 'played' and 'draw' reach the win-rate views; the rest do not.
SELECT end_reason, COUNT(*) FROM v_match_telemetry GROUP BY end_reason;
```

## Running against a local database

```bash
./scripts/db.sh up && ./scripts/db.sh migrate
psql "$(./scripts/db.sh url)" -c 'SELECT * FROM v_helper_pick_rate'
```

## The views

| View | Grain |
|---|---|
| `v_seat_loadouts` | one seat in a finished match: its loadout, helpers, shape, and whether it won |
| `v_match_telemetry` | one finished match: both loadouts and shapes, `is_mirror`, winner, `end_reason`, `rounds`, `draws` |
| `v_loadout_outcomes` | seat grain plus match facts, and `counts_for_balance` |
| `v_helper_pick_rate` | helper |
| `v_helper_win_rate` | helper |
| `v_pairing_win_rate` | unordered helper pair |
| `v_shape_win_rate` | loadout shape |
| `v_ability_firings` | one charge spent, with `target_hit` |
| `v_charge_usage` | ability helper: brought vs fired |

The three win-rate views each carry the same set of columns — `matches`,
`decisive`, `wins`, `drawn`, `win_rate`, `draw_rate` — so a helper, a pairing and a
shape are all read the same way.

`v_match_telemetry` assumes two seats per match, which is what `resolveDuelRound`
already assumes. A mode with more seats would need it widened.

There is no dashboard, by design — these are the queries.
