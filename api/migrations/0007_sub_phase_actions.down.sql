DROP TABLE IF EXISTS sub_phase_actions;

UPDATE matches SET phase = 'oracle' WHERE phase = 'react';
