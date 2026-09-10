-- JQ-239: the round sub-phase, generalised — and the marker it needs.
--
-- The rule is "the round resolves as soon as *every* entitled player has acted".
-- The server cannot derive that: a seat that re-picks the move it already had is
-- indistinguishable from one that has not answered at all, so acting has to be
-- written down. JQ-150 approximated it by waiting the clock out whenever more than
-- one player was entitled, which is correct but always costs the full allowance.
--
-- Keyed per (match, round, seat), so re-picking twice in one window is one act.
CREATE TABLE IF NOT EXISTS sub_phase_actions (
  match_id UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat_id  UUID        NOT NULL REFERENCES seats(id)   ON DELETE CASCADE,
  round    INTEGER     NOT NULL,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, round, seat_id)
);

-- The phase was named after the one card that could open it. A match caught
-- mid-sub-phase by the deploy keeps its window rather than resolving on a phase
-- name nothing answers to any more.
UPDATE matches SET phase = 'react' WHERE phase = 'oracle';
