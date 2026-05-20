-- ============================================================
-- 026 — MICROS Live Integration: schema additions
--
-- Adds api_account_name column to micros_connections.
-- This field holds the Oracle MICROS API account name used as
-- the x-app-key header in all BI API calls.
--
-- Prior to this migration, x-app-key was set to org_identifier.
-- After this migration, x-app-key prefers api_account_name when
-- non-empty, falling back to org_identifier.
--
-- Also creates a partial unique index on loc_ref to prevent
-- duplicate rows for the same pilot store when MicrosSyncService
-- calls getOrCreateConnectionId().
-- ============================================================

-- 1. Add api_account_name column
ALTER TABLE micros_connections
  ADD COLUMN IF NOT EXISTS api_account_name text NOT NULL DEFAULT '';

-- 2. Back-fill from org_identifier where blank
UPDATE micros_connections
SET api_account_name = org_identifier
WHERE api_account_name = '' AND org_identifier <> '';

-- 3. Unique index on non-empty loc_ref — prevents duplicate pilot-store rows
--    created by MicrosSyncService.getOrCreateConnectionId().
--    Uses a partial index so rows with loc_ref = '' are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS micros_connections_loc_ref_unique
  ON micros_connections (loc_ref)
  WHERE loc_ref <> '';

-- 4. Index for latest-first queries (used by getMicrosStatus, getMicrosConnection)
CREATE INDEX IF NOT EXISTS micros_connections_created_at_idx
  ON micros_connections (created_at DESC);

-- 5. Index on micros_sync_runs for dashboard freshness queries
CREATE INDEX IF NOT EXISTS micros_sync_runs_started_idx
  ON micros_sync_runs (started_at DESC);

-- 6. Index on micros_sales_daily for time-series lookups
CREATE INDEX IF NOT EXISTS micros_sales_daily_date_idx
  ON micros_sales_daily (connection_id, business_date DESC);

-- 7. Index on micros_labor_daily for date queries
CREATE INDEX IF NOT EXISTS micros_labor_daily_date_idx
  ON micros_labor_daily (connection_id, business_date DESC);
