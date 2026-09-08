-- JQ-220: Thief names two moves, so a firing needs two columns.
--
-- Every other ability names at most one move — Quarantine's guess, Rust's target —
-- which is why 0004 stored a single `target`. Thief is the exception: it moves a
-- mark rather than adding one, so it names the move of its owner's to take from as
-- well as the opponent's to put it on. Without this column a Thief firing cannot
-- round-trip, and the engine's `Firing.source` would be permanently undefined.
ALTER TABLE ability_firings
  ADD COLUMN IF NOT EXISTS source TEXT;  -- Thief's own-side move; NULL for every other ability
