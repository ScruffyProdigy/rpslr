# JQ-262 — Mid-round sub-phases are a pacing budget

## The shape of the problem

The game had exactly zero mid-round tells before Oracle. JQ-150 introduced one and
JQ-239 generalised it, so any public firing now opens a window for the seat it acts
against. That is right as protocol and unbudgeted as pacing: every sub-phase is a
pause in a game whose whole texture is simultaneous commitment.

The ticket opened with a mitigating claim, and it does not survive contact with the
service. **It is recorded here because the rest of the reasoning was built on it.**

> `disclosedFirings` publishes a public firing the moment it happens, while the
> phase is still `pick`. So firing Quarantine early discloses before the opponent
> commits and opens no window at all — the budget is spent by misplay, not by
> design.

Entitlement is `entitlementsIn` (`service.ts`), and it asks one question: did a
public firing act against this seat *this round*. There is no clock in it, and
`AbilityFiring` records no time to consult even if there were. Both orders open the
window — pinned at the two extremes a round allows in `subPhase.test.ts`, "firing
order against the opponent's commit".

**The budget is therefore spent by design.** There is no timing skill to teach and
no misplay to blame, which is what makes a written number necessary rather than
merely tidy.

Two corrections to the ticket's own table while it is being rewritten: Quarantine
recharges on **3**, not 4, the same cadence as Oracle; and Oracle is `reveal:
'secret'` — it opens its window by informing its own holder, not as a public
firing. The roster's two public cards are Quarantine and Freeze.

## What the roster can actually spend

Three cards can open a window, and `catalogSync.test.ts` pins that list so a fourth
has to arrive deliberately:

| Card | Path in | Cadence |
| -- | -- | -- |
| Oracle | informs its own holder | opening 0, recharge 3 |
| Quarantine | public firing, at the seat it names | opening 0, recharge 3 |
| Freeze | public firing | once per match |

A pause costs `REACT_MS` = 12s, against a pick allowance of 45s in round 1 and
23.2s after it.

**Played greedily — fire the moment the charge is up — a recharge-3 card buys a
pause every third round.** Two seats firing on the same cadence collide on the same
rounds, and one sub-phase per round means the collision is free. So greedy play
across the whole table costs `ceil(N/3)` pauses in an N-round match: two in a
typical five-round match, about 24s on ~138s of thinking time.

**The ceiling is much worse and nobody has reason to play it.** Four charge slots at
recharge 3 produce 4/3 pauses per round if deliberately staggered, which the
one-per-round rule clamps to *every round paused*. That line is real but it is not
free: holding Oracle means not knowing this round, and holding Quarantine means
leaving a hedge unspent in a round it might have won. Staggering to buy pauses is
paying in tempo for the privilege of slowing the game down.

## The decision

**A third of a match's rounds may pause. Past that, the roster is wrong.**

That number is chosen to sit exactly where greedy play already lands, which is the
point: the common line should not be the one that breaks pacing, and a budget that
the ordinary way of playing already exceeds is a budget nobody will keep. It leaves
a five-round match with two pauses and ~15% more wall clock, which reads as two
beats in a match rather than as a stop-start rhythm.

The measurement is `v_sub_phase_budget.paused_round_share`, per match. The trigger
to act is the **median across finished `duel-helpers` matches exceeding 0.34** —
median rather than mean, because the pathological staggered line is exactly the
outlier a mean would let drag the number without it being how anyone plays.

### On a cap for concurrent sub-phase sources

**No cap. One-per-round is sufficient, and this is now a decision with a review
trigger rather than an assumption.**

Three reasons. Greedy play lands inside the budget on its own. The line that breaks
it costs the player who plays it, in the currency the game already charges in.
And, until now, nobody could tell which was happening — `v_sub_phase_budget` and
`v_sub_phase_sources` are what turn "cap it" from a hunch into a query.

If the trigger does fire, the lever is cadence and card mix, and it belongs to the
card tickets rather than to the engine. Capping *sources* — at most one window-opener
per loadout — would be the blunt instrument, and it is worth naming as the fallback
precisely so it is not reached for first.

### On a top-of-round declare phase

Still not built. It was the assumed fix while firing early was believed to be free,
and it was aimed at a timing skill that turns out not to exist. `Phase` stays a
union and `roundPolicy.ts` still anticipates `'draft'`, so the option is open — but
it should be opened by a measurement, not by a hunch.

## Architecture

A read model, on JQ-152's terms. Nothing is added to the path that plays a match.

### `helper_catalog` grows two columns

`reveal` (`'public' | 'secret'`, NULL for a passive, which has no firing to
disclose) and `informs_its_holder`. Two axes rather than one, because Oracle is
secret and still opens a window. Both are synced from the roster by
`syncHelperCatalog`, so a card that changes disclosure reaches SQL on the next boot
rather than through a migration correcting `0008`.

### Why not `sub_phase_actions`

JQ-239's table looks like the obvious source and is the wrong denominator: it
records seats that **acted**, so a window every entitled seat let expire leaves no
row at all. Entry is derived from the firings instead, the way the service decides
it.

### The three conditions in `v_sub_phase_rounds`

1. Some firing this round informs its holder or fires in public — `entitlementsIn`,
   which asks nothing about when it was fired.
2. The round resolved. A firing stranded by a forfeit bought no pause.
3. `auto_picked` is empty. A round that ran out of clock resolves straight from
   `enforceDeadlines` and never reaches `enterSubPhase` — it has already overrun,
   and a further allowance would reward the overrun.

The third is why the view reads `round_results` at all. Without it, every expired
round with a charge spent in it counts as a pause that never happened.

### Views

* `v_sub_phase_rounds` — one row per round that actually paused, with `from_reveal`
  and `from_public_firing`. Not exclusive: a round holding both is one pause with
  two reasons, so a match's count comes from counting rows and never from summing
  the causes.
* `v_sub_phase_budget` — per finished match: `rounds`, `sub_phases`, the two causes,
  `from_both`, and `paused_round_share`. The share is the number the decision above
  is written against.
* `v_sub_phase_sources` — per card. `firings` and `rounds_paused` are kept apart
  deliberately: the gap between them is a charge spent that bought no pause, and an
  inner join would have hidden it.

## Testing

`subPhaseTelemetry.pg.test.ts`, against a real Postgres on its own schema, plays
five matches through `GameService` + `PgGameRepository`: a reveal-only pause, a
public-firing-only pause, a round with both causes counted once, a secret firing
that costs nothing, and a qualifying firing in a round that ran out of clock and
bought nothing.

Its own file rather than a block in `telemetry.pg.test.ts` — these matches exist to
pause, and adding them to that fixture would move every count it asserts.

## Non-goals

* Retuning Quarantine, Oracle or Freeze. If the trigger fires, the levers are
  cadence and card mix, and they belong to the card tickets.
* A top-of-round declare phase, for the reason above.
* Whether a player *understands* the pause — a HUD question for JQ-149 / JQ-221.
  It is no longer a rules question, because there is no longer a timing skill for a
  HUD to teach.
