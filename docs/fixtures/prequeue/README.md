# Pre-queue options fixtures

Golden request and response bodies for JoinQuest's **pre-queue options** capability.
**These are the specification.** Code is checked against them, never the reverse.

## Where the prose lives — not here

- **The wire contract** is JoinQuest platform documentation, not RPSLR documentation:
  the lobby repo's developer integration guide, **§13 Pre-queue options**. That is
  where an external game author looks, and there should be exactly one copy of it.
- **The epic plan and decisions** are in Notion:
  [RPSLR — Helpers mode epic plan (JQ-146)](https://app.notion.com/p/3d5c637d78a581688334e58da61c049a).
- **The design rationale** is in Notion:
  [RPSLR — Helpers mode design](https://app.notion.com/p/3d3c637d78a5816a82e5d0090b5c986c).

These files stay in the repo because they are **executable**: JQ-148's byte-for-byte
test reads them, and a golden file that is not next to the test it feeds is a file
that drifts. It already did once, when JQ-209 moved the tier split.

## Shapes

- **Response fixtures** (`game-modes.*`, `queue-options.duel*`) are the exact
  response body the game must produce.
- **Provision fixtures** (`provision.*`) are `{ request, expect }` — the body the
  lobby sends and what the game must do with it. `expect.reason` is a substring the
  error must contain, not the whole message, so wording can improve without breaking
  the lobby's tests. Four are rejections; `provision.valid.json` is the one success.
- **Behaviour fixtures** (`queue-options.unavailable.json`) describe a contract with
  no single body — here, that the roster endpoint does not fail open.

## The roster fixture is generated

`queue-options.duel-helpers.json` is generated from `api/src/helpers/roster.ts`.
**Do not hand-edit it.** Regenerate when the roster moves; the byte-for-byte test in
JQ-148 is what keeps the two honest.

## Running them

`../../../scripts/stub-lobby.sh <name>` replays a provision fixture against a
locally-running game API; `--all` runs every one and checks its expectation. Neither
repo needs the other running.
