-- Normalize any legacy fifth-move slug to robot (copyright-safe naming).
UPDATE moves SET move = 'robot' WHERE move NOT IN ('rock', 'paper', 'scissors', 'lizard', 'robot');

ALTER TABLE moves DROP CONSTRAINT IF EXISTS moves_move_check;
ALTER TABLE moves ADD CONSTRAINT moves_move_check
  CHECK (move IN ('rock', 'paper', 'scissors', 'lizard', 'robot'));
