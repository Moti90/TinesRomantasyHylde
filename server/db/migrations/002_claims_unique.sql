-- Fase 7 bid 4: unique key til upsert af claims
CREATE UNIQUE INDEX IF NOT EXISTS claims_work_type_key_uidx
  ON claims (work_id, claim_type, claim_key);
