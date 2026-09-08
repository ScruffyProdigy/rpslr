# Pre-queue options fixtures

Golden bodies for [`../../prequeue-options-contract.md`](../../prequeue-options-contract.md)
(**v3**, negotiated with the JQ-163 session 2026-09-08).
**These are the specification.** Code is checked against them, never the reverse.
A change here is a contract change: it lands in the lobby repo too, and the
contract version goes up.

Three shapes:

- **Response fixtures** (`game-modes.*`, `queue-options.duel*`) are the exact
  response body the game must produce.
- **Provision fixtures** (`provision.*`) are `{ request, expect }` — the body the
  lobby sends and what the game must do with it. `expect.status` is the HTTP
  status; `expect.reason` is a substring the error must contain, not the whole
  message, so wording can improve without breaking the lobby's tests.
- **Behaviour fixtures** (`queue-options.unavailable.json`) describe a contract
  that has no single body — here, that the roster endpoint does not fail open.

## Two roster fixtures, pending one decision

`exclusionKey` is agreed (contract §2). The only thing still open is Ryan's call on
how Blind Spot is represented, and **both outcomes are already written**:

- `queue-options.duel-helpers.json` — 22 choices, Blind Spot unexploded. Cannot name
  a move, so it is only correct if the card is cut.
- `queue-options.duel-helpers.blind-spot-exploded.json` — 26 choices, five Blind Spot
  variants sharing `exclusionKey: "blind-spot"`. **This is the recommended one.**

Everything else in both is final. Build the picker against the exploded fixture; if
Ryan cuts the card instead, delete that file and nothing else moves.

Both satisfy the degenerate-roster rule: 22 distinct exclusion classes against a
group `max` of 2.

## Running them

`../../../scripts/stub-lobby.sh <name>` replays a provision fixture against a
locally-running game API, so neither repo needs the other running.
