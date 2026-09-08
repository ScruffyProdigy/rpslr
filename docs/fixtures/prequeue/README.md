# Pre-queue options fixtures

Golden bodies for [`../../prequeue-options-contract.md`](../../prequeue-options-contract.md)
(**v2**, negotiated with the JQ-163 session 2026-09-08).
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

## Provisional: the roster is still 22 choices

`queue-options.duel-helpers.json` carries Blind Spot as **one** choice. Under a
pre-queue pick it needs to name a move, and the agreed direction is to explode it
into one choice per move — which would make this 26. Two things are unsettled
(contract §7): Ryan's call on the representation, and JQ-163's agreement on an
`exclusionKey` so the lobby can stop a player selecting two Blind Spot variants.

Lock the manifest and provision fixtures now; expect this one to gain four entries.

## Running them

`../../../scripts/stub-lobby.sh <name>` replays a provision fixture against a
locally-running game API, so neither repo needs the other running.
