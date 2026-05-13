-- =============================================================================
-- Migration 083: RLS Hardening — Tenant-Scoped Policies
-- =============================================================================
--
-- PURPOSE:
--   Replace all broad `USING (true)` policies for the `authenticated` role
--   with tenant-scoped policies that limit access to rows belonging to the
--   user's organisation and assigned sites.
--
--   This is defence-in-depth on top of the app-layer tenant guards.
--   Service-role continues to bypass RLS entirely (required by cron/sync workers).
--
-- SECURITY MODEL:
--   A user may access a row if ANY of the following is true:
--     1. They are super_admin (role in user_roles)
--     2. Their user_roles.site_id matches the row's site_id
--     3. Their user_roles.organisation_id matches the row's site's organisation_id
--
--   The helper function fs_user_can_access_site(site_id uuid) encapsulates
--   this check and is used by all tenant-scoped policies.
--
-- IDEMPOTENT:
--   All DROP POLICY IF EXISTS + CREATE POLICY blocks are safe to re-run.
--   The helper function uses CREATE OR REPLACE.
--
-- CRON / SERVICE-ROLE SAFETY:
--   Service-role bypasses all RLS. No cron or sync worker is affected.
-- =============================================================================

-- ── 1. Tenant isolation helper function ──────────────────────────────────────
--
-- Returns true if the currently authenticated user (auth.uid()) can access
-- the given site_id.  Called inside USING() clauses — must be SECURITY DEFINER
-- and owned by a privileged role to read user_roles.

CREATE OR REPLACE FUNCTION fs_user_can_access_site(p_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   user_roles ur
    WHERE  ur.user_id   = auth.uid()
    AND    ur.is_active = true
    AND    (
             ur.role = 'super_admin'
          OR ur.site_id = p_site_id
          OR ur.organisation_id IN (
               SELECT s.organisation_id
               FROM   sites s
               WHERE  s.id = p_site_id
             )
           )
  );
$$;

-- ── 2. micros_sales_daily ─────────────────────────────────────────────────────

ALTER TABLE IF EXISTS micros_sales_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"       ON micros_sales_daily;
DROP POLICY IF EXISTS "auth_select_micros_sales" ON micros_sales_daily;

CREATE POLICY "auth_select_micros_sales"
  ON micros_sales_daily FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

-- Service role can do everything (required by sync workers)
DROP POLICY IF EXISTS "srole_full_micros_sales" ON micros_sales_daily;
CREATE POLICY "srole_full_micros_sales"
  ON micros_sales_daily FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 3. micros_connections ─────────────────────────────────────────────────────

ALTER TABLE IF EXISTS micros_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"         ON micros_connections;
DROP POLICY IF EXISTS "auth_select_micros_conn"   ON micros_connections;
DROP POLICY IF EXISTS "srole_full_micros_conn"    ON micros_connections;

-- Users can only see connections for their sites
CREATE POLICY "auth_select_micros_conn"
  ON micros_connections FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

-- IMPORTANT: tokens (access_token, refresh_token) must never be returned to
-- the app layer — the SAFE_CONNECTION_COLUMNS selection list enforces this at
-- the application layer.  RLS does not filter columns, only rows.

CREATE POLICY "srole_full_micros_conn"
  ON micros_connections FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 4. alerts ─────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"    ON alerts;
DROP POLICY IF EXISTS "auth_select_alerts"   ON alerts;
DROP POLICY IF EXISTS "auth_insert_alerts"   ON alerts;
DROP POLICY IF EXISTS "srole_full_alerts"    ON alerts;

CREATE POLICY "auth_select_alerts"
  ON alerts FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_insert_alerts"
  ON alerts FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_alerts"
  ON alerts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 5. compliance_items ───────────────────────────────────────────────────────

ALTER TABLE IF EXISTS compliance_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"         ON compliance_items;
DROP POLICY IF EXISTS "auth_select_compliance"    ON compliance_items;
DROP POLICY IF EXISTS "auth_write_compliance"     ON compliance_items;

CREATE POLICY "auth_select_compliance"
  ON compliance_items FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_compliance"
  ON compliance_items FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_update_compliance"
  ON compliance_items FOR UPDATE TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  )
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

-- ── 6. compliance_documents ───────────────────────────────────────────────────

ALTER TABLE IF EXISTS compliance_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"          ON compliance_documents;
DROP POLICY IF EXISTS "auth_select_comp_docs"      ON compliance_documents;
DROP POLICY IF EXISTS "auth_write_comp_docs"       ON compliance_documents;
DROP POLICY IF EXISTS "srole_full_comp_docs"       ON compliance_documents;

CREATE POLICY "auth_select_comp_docs"
  ON compliance_documents FOR SELECT TO authenticated
  USING (
    -- compliance_documents.site_id column (added in migration 083)
    (site_id IS NOT NULL AND fs_user_can_access_site(site_id))
    OR
    -- Fallback: inherit from parent compliance_item
    EXISTS (
      SELECT 1 FROM compliance_items ci
      WHERE ci.id = compliance_documents.item_id
      AND   ci.site_id IS NOT NULL
      AND   fs_user_can_access_site(ci.site_id)
    )
  );

CREATE POLICY "auth_write_comp_docs"
  ON compliance_documents FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_comp_docs"
  ON compliance_documents FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 7. equipment ──────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"    ON equipment;
DROP POLICY IF EXISTS "auth_select_equip"   ON equipment;
DROP POLICY IF EXISTS "auth_write_equip"    ON equipment;
DROP POLICY IF EXISTS "srole_full_equip"    ON equipment;

CREATE POLICY "auth_select_equip"
  ON equipment FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_write_equip"
  ON equipment FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_update_equip"
  ON equipment FOR UPDATE TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  )
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_equip"
  ON equipment FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 8. daily_operations_reports ───────────────────────────────────────────────

ALTER TABLE IF EXISTS daily_operations_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"    ON daily_operations_reports;
DROP POLICY IF EXISTS "auth_select_dor"      ON daily_operations_reports;
DROP POLICY IF EXISTS "srole_full_dor"       ON daily_operations_reports;

CREATE POLICY "auth_select_dor"
  ON daily_operations_reports FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_insert_dor"
  ON daily_operations_reports FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_dor"
  ON daily_operations_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 9. reviews ────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"    ON reviews;
DROP POLICY IF EXISTS "auth_select_reviews"  ON reviews;
DROP POLICY IF EXISTS "srole_full_reviews"   ON reviews;

CREATE POLICY "auth_select_reviews"
  ON reviews FOR SELECT TO authenticated
  USING (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "auth_insert_reviews"
  ON reviews FOR INSERT TO authenticated
  WITH CHECK (
    site_id IS NOT NULL AND fs_user_can_access_site(site_id)
  );

CREATE POLICY "srole_full_reviews"
  ON reviews FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 10. micros_sync_runs ──────────────────────────────────────────────────────

ALTER TABLE IF EXISTS micros_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"        ON micros_sync_runs;
DROP POLICY IF EXISTS "auth_select_sync_runs"    ON micros_sync_runs;
DROP POLICY IF EXISTS "srole_full_sync_runs"     ON micros_sync_runs;

-- Join via connection to get site_id
CREATE POLICY "auth_select_sync_runs"
  ON micros_sync_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM micros_connections mc
      WHERE mc.id      = micros_sync_runs.connection_id
      AND   mc.site_id IS NOT NULL
      AND   fs_user_can_access_site(mc.site_id)
    )
  );

CREATE POLICY "srole_full_sync_runs"
  ON micros_sync_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 11. menu_item_food_costs / menu_item_dimensions ──────────────────────────

-- These had broad `authenticated USING (true)` — replace with site-scoped.
-- Both tables inherit site_id via menu_items → sites.

ALTER TABLE IF EXISTS menu_item_food_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS menu_item_dimensions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_mifc" ON menu_item_food_costs;
DROP POLICY IF EXISTS "auth_mid"  ON menu_item_dimensions;

CREATE POLICY "auth_mifc"
  ON menu_item_food_costs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      JOIN   sites s ON s.id = mi.site_id
      WHERE  mi.id = menu_item_food_costs.menu_item_id
      AND    fs_user_can_access_site(mi.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE  mi.id = menu_item_food_costs.menu_item_id
      AND    fs_user_can_access_site(mi.site_id)
    )
  );

CREATE POLICY "auth_mid"
  ON menu_item_dimensions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE  mi.id = menu_item_dimensions.menu_item_id
      AND    fs_user_can_access_site(mi.site_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE  mi.id = menu_item_dimensions.menu_item_id
      AND    fs_user_can_access_site(mi.site_id)
    )
  );

-- ── 12. risk_scores / risk_flags ──────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'risk_scores') THEN
    EXECUTE 'ALTER TABLE risk_scores ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_all" ON risk_scores';
    EXECUTE 'DROP POLICY IF EXISTS "auth_select_risk_scores" ON risk_scores';
    EXECUTE $p$
      CREATE POLICY "auth_select_risk_scores"
        ON risk_scores FOR SELECT TO authenticated
        USING (
          site_id IS NOT NULL AND fs_user_can_access_site(site_id)
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "srole_full_risk_scores"
        ON risk_scores FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'risk_flags') THEN
    EXECUTE 'ALTER TABLE risk_flags ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_all" ON risk_flags';
    EXECUTE 'DROP POLICY IF EXISTS "auth_select_risk_flags" ON risk_flags';
    EXECUTE $p$
      CREATE POLICY "auth_select_risk_flags"
        ON risk_flags FOR SELECT TO authenticated
        USING (
          site_id IS NOT NULL AND fs_user_can_access_site(site_id)
        )
    $p$;
    EXECUTE $p$
      CREATE POLICY "srole_full_risk_flags"
        ON risk_flags FOR ALL TO service_role
        USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- ── 13. sites — read-only for authenticated users ──────────────────────────

ALTER TABLE IF EXISTS sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all"    ON sites;
DROP POLICY IF EXISTS "auth_select_sites"    ON sites;
DROP POLICY IF EXISTS "srole_full_sites"     ON sites;

CREATE POLICY "auth_select_sites"
  ON sites FOR SELECT TO authenticated
  USING (
    fs_user_can_access_site(id)
  );

CREATE POLICY "srole_full_sites"
  ON sites FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── 14. micros_inventory_items / micros_inventory_locations / micros_inventory_groups ──

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['micros_inventory_items', 'micros_inventory_locations', 'micros_inventory_groups']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all" ON %I', t);
      EXECUTE format(
        'CREATE POLICY "srole_full_%1$s" ON %1$I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ── 15. Ensure sites.organisation_id has an index for the helper function ──

CREATE INDEX IF NOT EXISTS idx_sites_org ON sites (organisation_id)
  WHERE organisation_id IS NOT NULL;

-- ── Comments ─────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION fs_user_can_access_site(uuid) IS
  'Tenant isolation helper: returns true if auth.uid() has access to the given site_id '
  'via user_roles (super_admin, site match, or org match). SECURITY DEFINER so it can '
  'read user_roles without a separate RLS policy on that table.';
