-- Normalize any legacy fifth-move slug to robot (copyright-safe naming).
ALTER TABLE moves DROP CONSTRAINT IF EXISTS moves_move_check;
UPDATE moves SET move = 'robot' WHERE move IN ('spock') OR move NOT IN ('rock', 'paper', 'scissors', 'lizard', 'robot');
ALTER TABLE moves ADD CONSTRAINT moves_move_check
  CHECK (move IN ('rock', 'paper', 'scissors', 'lizard', 'robot'));
