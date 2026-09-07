-- JQ-156: server-authoritative round deadlines and the idle policy.
--
-- `phase` is deliberately unconstrained. Only 'pick' exists today, but the
-- planned duel-helpers mode adds 'draft' and 'oracle', and a CHECK here would
-- turn each of those into a migration. The application owns the vocabulary.
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS phase            TEXT,         -- timed segment, NULL when nothing is on the clock
  ADD COLUMN IF NOT EXISTS phase_started_at TIMESTAMPTZ,  -- when `phase` began; with the deadline this gives the full allowance
  ADD COLUMN IF NOT EXISTS phase_deadline   TIMESTAMPTZ,  -- when `phase` expires
  ADD COLUMN IF NOT EXISTS end_reason      TEXT,          -- how the match ended: played | forfeit-* | abandoned
  ADD COLUMN IF NOT EXISTS winner_seat_key TEXT;          -- a forfeit produces a winner without a score

-- Consecutive expiries. Reset to 0 whenever the player submits on time, so this
-- counts a run of silence rather than a lifetime total.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS expiry_strikes INTEGER NOT NULL DEFAULT 0;

-- Which players did not choose their own move this round. Persisted rather than
-- broadcast once, so a player who reconnects after an expiry still learns it
-- happened, and the history strip can show it.
ALTER TABLE round_results
  ADD COLUMN IF NOT EXISTS auto_picked JSONB NOT NULL DEFAULT '[]'::jsonb;
