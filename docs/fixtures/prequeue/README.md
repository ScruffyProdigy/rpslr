# Pre-queue options fixtures

Golden bodies for [`../../prequeue-options-contract.md`](../../prequeue-options-contract.md)
(**v4**, negotiated with the JQ-163 session 2026-09-08).
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

## The roster is 21 choices, and settled

`queue-options.duel-helpers.json` carries 21 helpers, giving 210 loadouts. It is
**generated from `api/src/helpers/roster.ts`** — never hand-edit it. The tier split
moves under JQ-209; regenerate rather than patching by hand. Blind Spot was cut (Ryan, 2026-09-08: its ability
did not look fun), which also removed the only card that needed `exclusionKey`.
That field keeps its specification in contract §2 but has no consumer and is not
to be built.

Nothing about these fixtures is provisional any more.

## Running them

`../../../scripts/stub-lobby.sh <name>` replays a provision fixture against a
locally-running game API, so neither repo needs the other running.
