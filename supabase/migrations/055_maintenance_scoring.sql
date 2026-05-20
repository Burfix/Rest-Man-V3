-- 055 — Maintenance Scoring: add service_blocking boolean
-- Spec: ForgeStack Maintenance Scoring Logic v1.0
-- This is the only schema change required for the revised maintenance scoring model.

ALTER TABLE maintenance_logs
  ADD COLUMN IF NOT EXISTS service_blocking BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN maintenance_logs.service_blocking
  IS 'True when this issue is actively blocking service. Drives the -10 severity deduction in maintenance scoring.';
