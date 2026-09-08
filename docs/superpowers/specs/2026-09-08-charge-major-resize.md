# Resizing the four underpriced charge Majors

**Status:** Proposal — needs Ryan's sign-off
**Blocks:** JQ-147 sub-task 1.6 (no charge Major is implemented until this closes)
**Source:** [RPSLR — Helpers mode design](https://app.notion.com/p/3d3c637d78a5816a82e5d0090b5c986c),
"Majors" and "Numbers"

## The problem, in the design doc's own numbers

A sustained edge is worth about **5×** the same edge used once. The exchange rate
is roughly **1pp of match win per 0.01 of round value** when sustained from round 3;
a one-off swing of +0.10 buys about +1.9pp.

| | Value | Match win |
| --- | --- | --- |
| Good Old Rock (passive) | +0.204 in rounds where Rock is live | ≈ 9–10pp |
| Oracle (charge) | ≈ +0.5 one-shot | ≈ +9pp ✓ |
| **Rust, Freeze, Thief, Sacrifice** | ≈ +0.2 one-shot | **≈ +3.7pp ✗** |

So Oracle is correctly sized and the other four are worth roughly **40%** of what a
Major should be. The target for each is **≈ +9pp**, which means either a one-shot
swing of about **+0.5 round value**, or conversion to a passive earning about
**+0.09 per round**.

The lever available is the game's own currency. From the design doc: 2 live vs 3
live is **−0.383**, and 4 live vs 3 is **+0.156**. A card that both gains you a live
move and costs them one is worth about **+0.54** for that round — which is the
target, almost exactly. That is the shape three of the four proposals below take.

## Recommendations

Each card keeps its identity and its one-shot decision — the interesting part — and
grows in magnitude rather than in frequency or bookkeeping.

### Thief — recommended: move *all* marks, not one

> **Now:** Once per match, move one mark from one of your moves onto one of theirs.
> **Proposed:** Once per match, move **all** the marks from one of your moves onto
> one of theirs.

A one-mark swing is nearly nothing. Moving the whole stack clears one of your
cooldowns outright *and* buries one of theirs — you go to 4 live, they go to 2, for
about **+0.54**. It hits the target without a new mechanic, and "take the whole
thing" is a better read of the name than "take a bit".

Cheapest to implement of the four: it is already a mark adjustment.

### Rust — recommended: 4 marks, not 2

> **Now:** Once per match, add 2 marks to a move they currently have live.
> **Proposed:** Once per match, add **4** marks to a move they currently have live.

2 marks removes a move for about two rounds; 4 removes it for four, which in a
best-of-5 is most of the match. The card becomes "delete a move from their board"
rather than "delay one", which is a clearer identity as well as a bigger number.

Precedent exists in the roster: Quarantine already applies 4 marks when it catches
a move, so the magnitude is not novel.

### Sacrifice — recommended: freeze them while you reset

> **Now:** Once per match, declare the round a draw before picking; clear all your marks.
> **Proposed:** Once per match, declare the round a draw before picking; clear all
> your marks, **and their marks do not decrement this round.**

Clearing your own marks alone buys a 5-live round against their 3, but they recover
normally, so the advantage is gone almost immediately. Holding their marks still
while you reset converts it from a blip into a real tempo swing — you enter the next
round with everything live and they enter it no better off than they were.

The 5-live position looks alarming against the doc's warning that live-move count is
the most dangerous category, but it lasts one round and Trinket + Trinket already
opens 5, 4, 3 — so it is precedented, not new ground.

### Freeze — recommended: two rounds, not one

> **Now:** Once per match, their marks don't decrement this round.
> **Proposed:** Once per match, their marks don't decrement **for two rounds**.

The plainest scaling of the four, and deliberately so: Freeze is the card whose
effect is hardest to read at a glance, so it should get bigger without also getting
more complicated. Two rounds roughly doubles it to ≈ +7.4pp — the only one of the
four that lands slightly under target.

**Fallback if it measures short:** their marks don't decrement this round *and*
yours decrement twice. That reaches the target but makes the card do two things.
Prefer the simple version and let telemetry decide.

### Note: Sacrifice and Freeze now overlap

Both freeze the opponent's decrement. That is a deliberate cost of these two
proposals and worth a look before sign-off — if the overlap reads as samey, the
alternative for Sacrifice is to leave it at "clear your marks" and instead let it be
used **twice** per match, which keeps it distinct at the price of a second decision.

## What still has to be computed

**These magnitudes are reasoned from the design doc's published values, not solved.**
The doc's own table was computed; these proposals are not, and should not be
implemented as though they were.

Two of the numbers above lean on the −0.383 and +0.156 rows, which is sound, but the
compound cases (a card that changes both players' live counts in the same round, or
holds a state across two rounds) need the actual solver.

**Blocker for anyone doing that:** `client/src/roundValue.ts` solves a round exactly,
but it is **hardcoded to 3×3** — three live moves each. It cannot express the
2-live, 4-live or 5-live positions every one of these proposals turns on, so the
table in the design doc did not come from it. Generalising it to n×m (or finding
whatever produced the original numbers) is a prerequisite for verifying any of this.

That is worth doing regardless of this document: with 231 loadouts and a tier ladder
that only holds if a tier step really is worth 3pp, a solver that can only see the
baseline position is going to be needed sooner or later.

## Sign-off

- [ ] Thief → move all marks
- [ ] Rust → 4 marks
- [ ] Sacrifice → clear yours, freeze theirs (or: twice per match instead)
- [ ] Freeze → two rounds
- [ ] Accept the Sacrifice/Freeze overlap, or pick the alternative
- [ ] Decide whether the solver is generalised before or after these ship

Once signed off: update the Majors table in the Notion design doc, the `blurb`
values in `docs/fixtures/prequeue/queue-options.duel-helpers.json`, and then write
the plan for JQ-147 sub-task 1.6.
