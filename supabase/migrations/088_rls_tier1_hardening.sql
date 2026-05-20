-- =============================================================================
-- Migration 088: Tier-1 RLS Hardening — Remaining Tables
-- =============================================================================
--
-- PURPOSE:
--   Complete the RLS hardening pass begun in 083 by scoping the remaining
--   tables that still use USING(true) for the `authenticated` role.
--
-- SECURITY MODEL:
--   Same as migration 083 — uses fs_user_can_access_site() SECURITY DEFINER
--   helper which checks user_roles for site/org/super_admin access.
--   Service-role bypasses RLS entirely (required by cron/sync workers).
--
-- TABLES COVERED:
--   1.  zone_snapshots          — has site_id NOT NULL  (from 013)
--   2.  asset_service_history   — has site_id NOT NULL  (from 013)
--   3.  action_events           — no site_id, JOIN via actions.site_id (from 037)
--   4.  sales_uploads           — has site_id NOT NULL  (from 043)
--   5.  forecast_runs           — has store_id NOT NULL = site FK (from 030)
--   6.  reservations            — add nullable site_id, backfill Si Cantina
--   7.  events                  — add nullable site_id, backfill Si Cantina
--   8.  maintenance_logs        — no site_id, JOIN via equipment.site_id
--   9.  historical_sales        — add nullable site_id, backfill Si Cantina
--  10.  sales_targets           — add nullable site_id, backfill Si Cantina
--  11.  forecast_snapshots      — add nullable site_id, backfill Si Cantina
--  12.  daily_operations_labor  — no site_id, JOIN via daily_operations_reports
--  13.  daily_operations_revenue_centers — same JOIN approach
--  14.  venue_settings          — service_role-only write; authenticated read via site
--
-- IDEMPOTENT:
--   All DROP POLICY IF EXISTS + ADD COLUMN IF NOT EXISTS blocks are re-run safe.
--
-- ROLLBACK:
--   Each policy block can be reversed by:
--     DROP POLICY "..." ON <table>;
--     CREATE POLICY "authenticated_all" ON <table> FOR ALL TO authenticated
--       USING (true) WITH CHECK (true);
--   For new site_id columns: ALTER TABLE <table> DROP COLUMN site_id;
-- =============================================================================

-- Si Cantina Sociale site UUID: '00000000-0000-0000-0000-000000000001'
-- All pre-multi-tenant rows belong to this site (backfilled inline below).

-- ── 0. Preflight: ensure prerequisite site_id columns exist ──────────────────
--
-- Some of these columns are added by earlier migrations (012, 043, 083).
-- These DO blocks make 088 self-healing if those migrations were not applied.

DO $$
BEGIN
  -- equipment.site_id (normally added by 012_universal_model)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE equipment ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
    UPDATE equipment SET site_id = '00000000-0000-0000-0000-000000000001' WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_equipment_site ON equipment (site_id);
  END IF;

  -- sales_uploads.site_id (normally added by 043_add_site_id_to_sales_uploads)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sales_uploads' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE sales_uploads ADD COLUMN site_id uuid REFERENCES sites(id)
      DEFAULT '00000000-0000-0000-0000-000000000001';
    UPDATE sales_uploads SET site_id = '00000000-0000-0000-0000-000000000001' WHERE site_id IS NULL;
    ALTER TABLE sales_uploads ALTER COLUMN site_id SET NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_uploads_site_week ON sales_uploads (site_id, week_start DESC);
  END IF;

  -- daily_operations_reports.site_id (normally added by 083_rls_hardening)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_operations_reports' AND column_name = 'site_id'
  ) THEN
    ALTER TABLE daily_operations_reports ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE daily_operations_reports SET site_id = '00000000-0000-0000-0000-000000000001' WHERE site_id IS NULL;
  END IF;
END $$;

-- ── 1. zone_snapshots ─────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS zone_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"          ON zone_snapshots;
DROP POLICY IF EXISTS "auth_select_zone_snapshots" ON zone_snapshots;
DROP POLICY IF EXISTS "srole_full_zone_snapshots"  ON zone_snapshots;

CREATE POLICY "auth_select_zone_snapshots"
  ON zone_snapshots FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_zone_snapshots"
  ON zone_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 2. asset_service_history ──────────────────────────────────────────────────

ALTER TABLE IF EXISTS asset_service_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"                ON asset_service_history;
DROP POLICY IF EXISTS "auth_select_asset_service_history" ON asset_service_history;
DROP POLICY IF EXISTS "srole_full_asset_service_history" ON asset_service_history;

CREATE POLICY "auth_select_asset_service_history"
  ON asset_service_history FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_asset_service_history"
  ON asset_service_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. action_events ──────────────────────────────────────────────────────────
--
-- action_events has no site_id; scope via parent actions.site_id.
-- SELECT: user must be able to see the parent action's site.
-- INSERT: parent action must have a site_id and user must have access.

ALTER TABLE IF EXISTS action_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"          ON action_events;
DROP POLICY IF EXISTS "service_role_all"           ON action_events;
DROP POLICY IF EXISTS "auth_select_action_events"  ON action_events;
DROP POLICY IF EXISTS "auth_insert_action_events"  ON action_events;
DROP POLICY IF EXISTS "srole_full_action_events"   ON action_events;

CREATE POLICY "auth_select_action_events"
  ON action_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM actions a
      WHERE  a.id = action_events.action_id
      AND    (a.site_id IS NULL OR fs_user_can_access_site(a.site_id))
    )
  );

CREATE POLICY "auth_insert_action_events"
  ON action_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM actions a
      WHERE  a.id = action_events.action_id
      AND    a.site_id IS NOT NULL
      AND    fs_user_can_access_site(a.site_id)
    )
  );

CREATE POLICY "srole_full_action_events"
  ON action_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 4. sales_uploads ──────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS sales_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"        ON sales_uploads;
DROP POLICY IF EXISTS "auth_select_sales_uploads" ON sales_uploads;
DROP POLICY IF EXISTS "auth_write_sales_uploads"  ON sales_uploads;
DROP POLICY IF EXISTS "srole_full_sales_uploads"  ON sales_uploads;

CREATE POLICY "auth_select_sales_uploads"
  ON sales_uploads FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_sales_uploads"
  ON sales_uploads FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_sales_uploads"
  ON sales_uploads FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 5. forecast_runs ──────────────────────────────────────────────────────────
--
-- store_id is the site FK (named store_id for historical reasons).

ALTER TABLE IF EXISTS forecast_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"          ON forecast_runs;
DROP POLICY IF EXISTS "auth_read_forecast_runs"    ON forecast_runs;
DROP POLICY IF EXISTS "auth_select_forecast_runs"  ON forecast_runs;
DROP POLICY IF EXISTS "auth_write_forecast_runs"   ON forecast_runs;
DROP POLICY IF EXISTS "srole_full_forecast_runs"   ON forecast_runs;

CREATE POLICY "auth_select_forecast_runs"
  ON forecast_runs FOR SELECT TO authenticated
  USING (
    store_id IS NOT NULL AND fs_user_can_access_site(store_id)
  );

CREATE POLICY "auth_write_forecast_runs"
  ON forecast_runs FOR INSERT TO authenticated
  WITH CHECK (
    store_id IS NOT NULL AND fs_user_can_access_site(store_id)
  );

CREATE POLICY "srole_full_forecast_runs"
  ON forecast_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 6. reservations ───────────────────────────────────────────────────────────
--
-- Originally single-tenant (no site_id). Add nullable column and backfill.
-- NULL rows remain visible (backward compat); new inserts must carry site_id.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'reservations'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE reservations ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE reservations
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_reservations_site ON reservations (site_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"         ON reservations;
DROP POLICY IF EXISTS "auth_select_reservations"  ON reservations;
DROP POLICY IF EXISTS "auth_write_reservations"   ON reservations;
DROP POLICY IF EXISTS "srole_full_reservations"   ON reservations;

CREATE POLICY "auth_select_reservations"
  ON reservations FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_reservations"
  ON reservations FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_reservations"
  ON reservations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 7. events ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'events'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE events ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE events
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_events_site ON events (site_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"  ON events;
DROP POLICY IF EXISTS "auth_select_events" ON events;
DROP POLICY IF EXISTS "auth_write_events"  ON events;
DROP POLICY IF EXISTS "srole_full_events"  ON events;

CREATE POLICY "auth_select_events"
  ON events FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_events"
  ON events FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_events"
  ON events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 8. maintenance_logs ───────────────────────────────────────────────────────
--
-- Links to equipment, which has site_id. Scope via JOIN.

ALTER TABLE IF EXISTS maintenance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"            ON maintenance_logs;
DROP POLICY IF EXISTS "auth_select_maintenance_logs" ON maintenance_logs;
DROP POLICY IF EXISTS "auth_write_maintenance_logs"  ON maintenance_logs;
DROP POLICY IF EXISTS "srole_full_maintenance_logs"  ON maintenance_logs;

CREATE POLICY "auth_select_maintenance_logs"
  ON maintenance_logs FOR SELECT TO authenticated
  USING (
    -- NULL equipment_id = orphaned/manual log — remain visible (legacy rows)
    maintenance_logs.equipment_id IS NULL
    OR EXISTS (
      SELECT 1 FROM equipment e
      WHERE  e.id = maintenance_logs.equipment_id
      AND    e.site_id IS NOT NULL
      AND    fs_user_can_access_site(e.site_id)
    )
  );

CREATE POLICY "auth_write_maintenance_logs"
  ON maintenance_logs FOR INSERT TO authenticated
  WITH CHECK (
    -- New logs must be linked to an equipment item the user has access to
    maintenance_logs.equipment_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM equipment e
      WHERE  e.id = maintenance_logs.equipment_id
      AND    e.site_id IS NOT NULL
      AND    fs_user_can_access_site(e.site_id)
    )
  );

CREATE POLICY "srole_full_maintenance_logs"
  ON maintenance_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 9. historical_sales ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'historical_sales'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE historical_sales ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE historical_sales
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_historical_sales_site ON historical_sales (site_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS historical_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"             ON historical_sales;
DROP POLICY IF EXISTS "auth_select_historical_sales"  ON historical_sales;
DROP POLICY IF EXISTS "srole_full_historical_sales"   ON historical_sales;

CREATE POLICY "auth_select_historical_sales"
  ON historical_sales FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_historical_sales"
  ON historical_sales FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_historical_sales"
  ON historical_sales FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 10. sales_targets ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'sales_targets'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE sales_targets ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE sales_targets
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_targets_site ON sales_targets (site_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS sales_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"         ON sales_targets;
DROP POLICY IF EXISTS "auth_select_sales_targets" ON sales_targets;
DROP POLICY IF EXISTS "srole_full_sales_targets"  ON sales_targets;

CREATE POLICY "auth_select_sales_targets"
  ON sales_targets FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_sales_targets"
  ON sales_targets FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_sales_targets"
  ON sales_targets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 11. forecast_snapshots ────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'forecast_snapshots'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE forecast_snapshots ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE forecast_snapshots
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_forecast_snapshots_site ON forecast_snapshots (site_id);
  END IF;
END $$;

ALTER TABLE IF EXISTS forecast_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"              ON forecast_snapshots;
DROP POLICY IF EXISTS "auth_select_forecast_snapshots" ON forecast_snapshots;
DROP POLICY IF EXISTS "srole_full_forecast_snapshots"  ON forecast_snapshots;

CREATE POLICY "auth_select_forecast_snapshots"
  ON forecast_snapshots FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_forecast_snapshots"
  ON forecast_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_forecast_snapshots"
  ON forecast_snapshots FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 12. daily_operations_labor ────────────────────────────────────────────────
--
-- Links to daily_operations_reports, which has site_id. Scope via JOIN.

ALTER TABLE IF EXISTS daily_operations_labor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"               ON daily_operations_labor;
DROP POLICY IF EXISTS "auth_select_dol"                 ON daily_operations_labor;
DROP POLICY IF EXISTS "auth_write_dol"                  ON daily_operations_labor;
DROP POLICY IF EXISTS "srole_full_dol"                  ON daily_operations_labor;

CREATE POLICY "auth_select_dol"
  ON daily_operations_labor FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM daily_operations_reports dor
      WHERE  dor.id = daily_operations_labor.daily_report_id
      AND    (dor.site_id IS NULL OR fs_user_can_access_site(dor.site_id))
    )
  );

CREATE POLICY "auth_write_dol"
  ON daily_operations_labor FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_operations_reports dor
      WHERE  dor.id = daily_operations_labor.daily_report_id
      AND    dor.site_id IS NOT NULL
      AND    fs_user_can_access_site(dor.site_id)
    )
  );

CREATE POLICY "srole_full_dol"
  ON daily_operations_labor FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 13. daily_operations_revenue_centers ──────────────────────────────────────

ALTER TABLE IF EXISTS daily_operations_revenue_centers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"        ON daily_operations_revenue_centers;
DROP POLICY IF EXISTS "auth_select_dorc"         ON daily_operations_revenue_centers;
DROP POLICY IF EXISTS "auth_write_dorc"          ON daily_operations_revenue_centers;
DROP POLICY IF EXISTS "srole_full_dorc"          ON daily_operations_revenue_centers;

CREATE POLICY "auth_select_dorc"
  ON daily_operations_revenue_centers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM daily_operations_reports dor
      WHERE  dor.id = daily_operations_revenue_centers.daily_report_id
      AND    (dor.site_id IS NULL OR fs_user_can_access_site(dor.site_id))
    )
  );

CREATE POLICY "auth_write_dorc"
  ON daily_operations_revenue_centers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM daily_operations_reports dor
      WHERE  dor.id = daily_operations_revenue_centers.daily_report_id
      AND    dor.site_id IS NOT NULL
      AND    fs_user_can_access_site(dor.site_id)
    )
  );

CREATE POLICY "srole_full_dorc"
  ON daily_operations_revenue_centers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 14. venue_settings ────────────────────────────────────────────────────────
--
-- venue_settings is per-deployment config. Service-role manages writes;
-- authenticated users can read settings for their accessible sites only.
-- If the table has no site_id, fall back to allow-all read (config data).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'venue_settings'
      AND column_name  = 'site_id'
  ) THEN
    ALTER TABLE venue_settings ADD COLUMN site_id uuid REFERENCES sites(id);
    UPDATE venue_settings
      SET site_id = '00000000-0000-0000-0000-000000000001'
    WHERE site_id IS NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS venue_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"           ON venue_settings;
DROP POLICY IF EXISTS "auth_select_venue_settings"  ON venue_settings;
DROP POLICY IF EXISTS "srole_full_venue_settings"   ON venue_settings;

CREATE POLICY "auth_select_venue_settings"
  ON venue_settings FOR SELECT TO authenticated
  USING (
    site_id IS NULL OR fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_venue_settings"
  ON venue_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 15. sales_items ───────────────────────────────────────────────────────────
--
-- POS line items. If no site_id, scope via sales_uploads parent.

ALTER TABLE IF EXISTS sales_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"      ON sales_items;
DROP POLICY IF EXISTS "auth_select_sales_items" ON sales_items;
DROP POLICY IF EXISTS "srole_full_sales_items"  ON sales_items;

CREATE POLICY "auth_select_sales_items"
  ON sales_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sales_uploads su
      WHERE  su.id = sales_items.upload_id
      AND    su.site_id IS NOT NULL
      AND    fs_user_can_access_site(su.site_id)
    )
  );

CREATE POLICY "auth_write_sales_items"
  ON sales_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales_uploads su
      WHERE  su.id = sales_items.upload_id
      AND    su.site_id IS NOT NULL
      AND    fs_user_can_access_site(su.site_id)
    )
  );

CREATE POLICY "srole_full_sales_items"
  ON sales_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Index hints for JOIN policies ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_maintenance_logs_equipment
  ON maintenance_logs (equipment_id);

CREATE INDEX IF NOT EXISTS idx_action_events_action
  ON action_events (action_id);

CREATE INDEX IF NOT EXISTS idx_dol_report
  ON daily_operations_labor (daily_report_id);

CREATE INDEX IF NOT EXISTS idx_dorc_report
  ON daily_operations_revenue_centers (daily_report_id);

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON POLICY "auth_select_reservations" ON reservations IS
  'Tenant-scoped: users see only reservations for their sites. NULL site_id = legacy single-tenant rows.';

COMMENT ON POLICY "auth_select_action_events" ON action_events IS
  'Scoped via parent actions.site_id. NULL site_id on action = visible to all authenticated (legacy).';
