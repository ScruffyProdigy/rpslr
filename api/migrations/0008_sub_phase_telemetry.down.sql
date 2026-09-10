DROP VIEW IF EXISTS v_sub_phase_sources;
DROP VIEW IF EXISTS v_sub_phase_budget;
DROP VIEW IF EXISTS v_sub_phase_rounds;

ALTER TABLE helper_catalog
  DROP COLUMN IF EXISTS informs_its_holder,
  DROP COLUMN IF EXISTS reveal;
