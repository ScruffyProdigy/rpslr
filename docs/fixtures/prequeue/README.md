# Pre-queue options fixtures

Golden bodies for the contract in [`../../prequeue-options-contract.md`](../../prequeue-options-contract.md).
**These are the specification.** Code is checked against them, never the reverse.
A change here is a contract change: it lands in the lobby repo too, and the
contract version goes up.

Two shapes:

- **Response fixtures** (`game-modes.*`, `queue-options.*`, `status.*`) are the
  exact response body the game must produce.
- **Provision fixtures** (`provision.*`) are `{ request, expect }` — the body the
  lobby sends and what the game must do with it. `expect.status` is the HTTP
  status; `expect.reason` is the substring the error must contain, not the whole
  message, so wording can improve without breaking the lobby's tests.

`../../../scripts/stub-lobby.sh <name>` replays a provision fixture against a
locally-running game API, so neither repo needs the other running.
