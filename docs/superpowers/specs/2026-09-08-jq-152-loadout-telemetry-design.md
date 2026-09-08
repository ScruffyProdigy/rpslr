# JQ-152 — Loadout telemetry: pick rate and win rate per helper and per pairing

## The shape of the problem

Asymmetric balance is settled by aggregate win-rate parity across many matches, not
at a whiteboard. Without instrumentation there is no way to tell a strong helper
from a popular one.

Everything the ticket asks to record is **already written down**. JQ-147 put the
loadout on `seats.loadout`; JQ-156 put the winner and end reason on `matches`;
`round_results` holds every round's outcome and moves; JQ-210's `ability_firings`
holds every charge spent, its round, and the move it named. Loadout *shape*,
mirror-ness, draw counts and whether Quarantine's named move was hit are all
functions of those rows.

So this is a **read model, not a write path**. Nothing is added to the code that
plays a match. The alternative — a denormalised `match_telemetry` row written at
match end — would duplicate facts already recorded, could drift from the move list,
and would only cover matches played after it shipped.

## Architecture

### 1. `helper_catalog` — the roster, in SQL

SQL can derive everything except a helper's tier, which lives only in
`api/src/helpers/roster.ts`. Migration `0005` creates an empty
`helper_catalog(id, name, tier, mark_cost, bound_move, load_kind, ability_opening,
ability_recharge)` — a faithful mirror of a roster row minus the player-facing
blurb.

It is **seeded from the roster, not by the migration**: `syncHelperCatalog(pool)`
upserts every row the roster names and deletes every row it no longer names. It
runs at the end of `npm run migrate` and again when the API boots. The roster
therefore stays the single source of truth, and JQ-209's pricing pass needs no
migration to correct the catalog — the change reaches SQL on the next boot.

`mark_cost` is carried so SQL can order a pair by tier without a rank function of
its own; `load_kind` is carried because "was the charge spent" needs the *brought*
denominator, and only the roster knows which helpers have a charge to spend.

### 2. Views

All views are restricted to `status = 'finished'`. Two seats per match is assumed,
which is what `resolveDuelRound` already assumes.

| View | Grain | Purpose |
|---|---|---|
| `v_seat_loadouts` | seat | the loadout a seat brought, its two helpers, its shape, and whether it won |
| `v_match_telemetry` | match | both loadouts and shapes, `is_mirror`, winner, `end_reason`, `rounds`, `draws`. `duel` appears here with NULL loadouts, so the two modes are comparable on the same path |
| `v_loadout_outcomes` | seat | `v_seat_loadouts` + match facts + `counts_for_balance`, the single place the exclusion rule lives |
| `v_helper_pick_rate` | helper | times brought ÷ seat-loadouts played; every helper appears, including at zero |
| `v_helper_win_rate` | helper | matches, wins, win rate, average draws per match |
| `v_pairing_win_rate` | unordered helper pair | win rate and average draws per loadout |
| `v_shape_win_rate` | shape | observed win rate per shape, to diff against the design doc's predicted table |
| `v_ability_firings` | firing | helper, round, named move, and `target_hit` — the named move against the opponent's actual move that round |
| `v_charge_usage` | ability helper | brought vs fired vs firings, and the average round of a first firing |

### 3. What counts as balance data

Two rules, both applied once in `v_loadout_outcomes.counts_for_balance`:

- **Mirrors are excluded.** Both seats bringing the same two helpers says nothing
  about the loadout. `v_match_telemetry.is_mirror` still flags them, so they can be
  counted deliberately.
- **Only `end_reason = 'played'` counts.** A win by disconnect is a fact about a
  network, not a loadout. `v_match_telemetry` keeps every finished match, so
  forfeit and abandonment rates stay visible.

`v_helper_pick_rate` deliberately does *not* apply either rule: a helper picked
into a mirror was still picked, and popularity is what that view measures.

Pick rates are per seat-loadout and every seat brings two helpers, so they sum to
2.0 rather than 1.0.

## Testing

- `catalogSync.test.ts` — pure: the derived rows are exactly the roster, field for
  field, with no row invented and none dropped.
- `telemetry.pg.test.ts` — plays scripted `duel-helpers` and `duel` matches through
  `GameService` + `PgGameRepository` and asserts the views: pick rate, a known
  pairing's win rate, shape classification, a mirror excluded from win rate but
  flagged, a Quarantine hit and a miss, and a drawn round counted. It skips itself
  when `DATABASE_URL` is unset, so local `npm test` is unchanged; CI already runs
  Postgres on 5433 with migrations applied, so it runs there for real.

## Non-goals

- No dashboard. `docs/telemetry.md` carries the queries.
- No per-player skill rating.
- No new writes on the match path.
