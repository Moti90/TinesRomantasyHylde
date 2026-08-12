-- Fase 7 bid 5: stabil nøgle til upsert af observations
ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS external_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS observations_work_type_ext_uidx
  ON observations (work_id, observation_type, external_key);
