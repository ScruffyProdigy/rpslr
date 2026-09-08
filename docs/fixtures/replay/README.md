# Replay reconstruction fixtures

A recorded `duel-helpers` match, kept so the frontend's replay can be checked
against the server that produced it (JQ-207).

## Why it exists

The replay page rebuilds every round's board from the finished match's payload
alone — `results[]`, both loadouts, and the abilities spent. Nothing in that
payload says what the board *was*, so the only honest check is to write down what
the server itself held while the match was being played, and compare the rebuild
against it afterwards.

`duel-helpers.json` therefore carries two things:

- `state` — the finished match exactly as `GET /api/v1/matches/:ref` serves it.
- `boards` — the marks every seat carried into each round, read off the server
  before that round resolved.

The loadouts in it are the hard case rather than a representative one. Grudge,
Small Mercy and Echo Chamber all put marks on the *other* player's moves, which is
precisely what the old per-seat replay could not see, and Bookend prices the
opening pick differently from every other round. A reconstruction that quietly
fell back to `duel`'s fixed constants fails on round 2 and never recovers.

## Regenerating

```
cd api && npm run golden:helpers-replay
```

Unlike `helpers/__fixtures__/duelGolden.json`, this is **not** a byte-identity
contract — it is a sample match carrying generated ids, and re-capturing it after
a deliberate rules change is routine. Say so in the commit message either way.

## Who reads it

- `client/src/replayFixture.test.ts` — replays it through `buildReplay` and
  asserts each frame's board is the one the server recorded.
