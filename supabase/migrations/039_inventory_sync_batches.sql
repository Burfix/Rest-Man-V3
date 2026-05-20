-- ============================================================
-- 039 — Inventory Sync Batches
-- Audit trail table for MICROS IM inventory sync operations.
-- Tracks each sync run with counts, status, actor, and timing.
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_sync_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid        NOT NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  status           text        NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error', 'partial')),
  source           text        NOT NULL DEFAULT 'micros-im',
  fetched_count    integer     NOT NULL DEFAULT 0,
  inserted_count   integer     NOT NULL DEFAULT 0,
  updated_count    integer     NOT NULL DEFAULT 0,
  failed_count     integer     NOT NULL DEFAULT 0,
  error_message    text,
  request_id       text,
  actor_user_id    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Index: recent batches per site
CREATE INDEX IF NOT EXISTS idx_inventory_sync_batches_site
  ON inventory_sync_batches (site_id, started_at DESC);

-- Index: status filtering
CREATE INDEX IF NOT EXISTS idx_inventory_sync_batches_status
  ON inventory_sync_batches (status);

-- RLS
ALTER TABLE inventory_sync_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "srole_inventory_sync_batches" ON inventory_sync_batches;
CREATE POLICY "srole_inventory_sync_batches"
  ON inventory_sync_batches FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_inventory_sync_batches" ON inventory_sync_batches;
CREATE POLICY "auth_inventory_sync_batches"
  ON inventory_sync_batches FOR SELECT TO authenticated
  USING (true);

-- Also update micros_sync_runs to accept 'inventory' and 'skipped' values
-- that the old sync.ts used
ALTER TABLE micros_sync_runs
  DROP CONSTRAINT IF EXISTS micros_sync_runs_sync_type_check;

ALTER TABLE micros_sync_runs
  ADD CONSTRAINT micros_sync_runs_sync_type_check
  CHECK (sync_type IN ('daily_totals', 'intervals', 'guest_checks', 'labor', 'full', 'inventory'));

ALTER TABLE micros_sync_runs
  DROP CONSTRAINT IF EXISTS micros_sync_runs_status_check;

ALTER TABLE micros_sync_runs
  ADD CONSTRAINT micros_sync_runs_status_check
  CHECK (status IN ('running', 'success', 'error', 'partial', 'skipped'));
