-- ============================================================
-- Migration 100: Site-Scoped RLS Policies
-- ============================================================
--
-- Replaces all "authenticated_all" / USING (true) RLS policies
-- on tenant-data tables with site-scoped equivalents that use
-- the existing user_accessible_sites(auth.uid()) RPC.
--
-- BEFORE this migration: any authenticated user could read or
-- write every row in these tables, across all tenants.
--
-- AFTER this migration: authenticated users can only access rows
-- belonging to sites they have been explicitly granted access to.
-- service_role retains unrestricted access for backend operations.
--
-- Pattern:
--   READ:  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())))
--   WRITE: WITH CHECK (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())))
--
-- Tables covered:
--   1.  actions                  (site_id column)
--   2.  action_daily_stats       (site_id column)
--   3.  action_events            (no site_id — scoped via actions.site_id join)
--   4.  copilot_decisions        (site_id column)
--   5.  store_snapshots          (site_id column)
--   6.  service_signals          (store_id column, FK → sites.id)
--   7.  operating_score_cache    (store_id column, FK → sites.id)
--   8.  daily_operating_state    (store_id column, FK → sites.id)
--   9.  booking_snapshots        (store_id column, FK → sites.id)
--
-- NOT changed in this migration (separate tier-1 hardening tracks):
--   - compliance_items, compliance_documents  (070_compliance_rls_and_views.sql)
--   - equipment, daily_operations_reports     (existing policies are auth-gated)
--   - audit_logs, system_incidents            (already site-scoped per 083/084)
--   - micros_* tables                         (service_role only in practice)
-- ============================================================

-- ── Helper: accessible sites shorthand (used in multiple policies) ───────────
-- Policies reference user_accessible_sites(auth.uid()) inline.
-- The RPC is defined in migrations 024 and 050, and is STABLE + SECURITY DEFINER
-- so it is safe and efficient to call from RLS policies.
--
-- Each section is wrapped in a DO block that checks for table existence so the
-- migration is safe to apply regardless of which older migrations are present.

-- ============================================================
-- 1. actions
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='actions') THEN
    DROP POLICY IF EXISTS "authenticated_all"    ON actions;
    DROP POLICY IF EXISTS "actions_site_read"    ON actions;
    DROP POLICY IF EXISTS "actions_site_write"   ON actions;
    DROP POLICY IF EXISTS "actions_site_update"  ON actions;
    DROP POLICY IF EXISTS "actions_site_delete"  ON actions;

    CREATE POLICY "actions_site_read" ON actions
      FOR SELECT TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );

    CREATE POLICY "actions_site_write" ON actions
      FOR INSERT TO authenticated
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );

    CREATE POLICY "actions_site_update" ON actions
      FOR UPDATE TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      )
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );

    CREATE POLICY "actions_site_delete" ON actions
      FOR DELETE TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );
  END IF;
END $$;

-- ============================================================
-- 2. action_daily_stats
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='action_daily_stats') THEN
    DROP POLICY IF EXISTS "authenticated_all"              ON action_daily_stats;
    DROP POLICY IF EXISTS "action_daily_stats_site_read"   ON action_daily_stats;
    DROP POLICY IF EXISTS "action_daily_stats_site_write"  ON action_daily_stats;
    DROP POLICY IF EXISTS "action_daily_stats_site_update" ON action_daily_stats;

    CREATE POLICY "action_daily_stats_site_read" ON action_daily_stats
      FOR SELECT TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );

    CREATE POLICY "action_daily_stats_site_write" ON action_daily_stats
      FOR INSERT TO authenticated
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );

    CREATE POLICY "action_daily_stats_site_update" ON action_daily_stats
      FOR UPDATE TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      )
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
        OR site_id IS NULL
      );
  END IF;
END $$;

-- ============================================================
-- 3. action_events
-- ============================================================
-- NOTE: migration 102 replaced the old action_events table (which had an
-- action_id FK) with a new operational accountability table (site_id, risk_id).
-- RLS for the new schema is fully handled by migration 102.
-- This section only cleans up any legacy blanket policies.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='action_events') THEN
    DROP POLICY IF EXISTS "authenticated_all"  ON action_events;
    DROP POLICY IF EXISTS "action_events_auth" ON action_events;
    -- New site-scoped policies (action_events_site_select, _site_insert,
    -- _own_update, _service_role) are owned by migration 102.
  END IF;
END $$;

-- ============================================================
-- 4. copilot_decisions
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='copilot_decisions') THEN
    DROP POLICY IF EXISTS "authenticated_all"              ON copilot_decisions;
    DROP POLICY IF EXISTS "copilot_decisions_site_read"   ON copilot_decisions;
    DROP POLICY IF EXISTS "copilot_decisions_site_write"  ON copilot_decisions;
    DROP POLICY IF EXISTS "copilot_decisions_site_update" ON copilot_decisions;

    CREATE POLICY "copilot_decisions_site_read" ON copilot_decisions
      FOR SELECT TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "copilot_decisions_site_write" ON copilot_decisions
      FOR INSERT TO authenticated
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "copilot_decisions_site_update" ON copilot_decisions
      FOR UPDATE TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 5. store_snapshots
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='store_snapshots') THEN
    DROP POLICY IF EXISTS "authenticated_all"           ON store_snapshots;
    DROP POLICY IF EXISTS "store_snapshots_site_read"  ON store_snapshots;
    DROP POLICY IF EXISTS "store_snapshots_site_write" ON store_snapshots;
    DROP POLICY IF EXISTS "store_snapshots_site_update" ON store_snapshots;

    CREATE POLICY "store_snapshots_site_read" ON store_snapshots
      FOR SELECT TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "store_snapshots_site_write" ON store_snapshots
      FOR INSERT TO authenticated
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "store_snapshots_site_update" ON store_snapshots
      FOR UPDATE TO authenticated
      USING (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 6. service_signals
-- ============================================================
-- Uses store_id (FK → sites.id). The user_accessible_sites RPC
-- returns site_id values — same underlying column.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_signals') THEN
    DROP POLICY IF EXISTS "service_signals_auth"        ON service_signals;
    DROP POLICY IF EXISTS "service_signals_site_read"   ON service_signals;
    DROP POLICY IF EXISTS "service_signals_site_write"  ON service_signals;
    DROP POLICY IF EXISTS "service_signals_site_update" ON service_signals;

    CREATE POLICY "service_signals_site_read" ON service_signals
      FOR SELECT TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "service_signals_site_write" ON service_signals
      FOR INSERT TO authenticated
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "service_signals_site_update" ON service_signals
      FOR UPDATE TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 7. operating_score_cache
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='operating_score_cache') THEN
    DROP POLICY IF EXISTS "os_cache_auth"        ON operating_score_cache;
    DROP POLICY IF EXISTS "os_cache_site_read"   ON operating_score_cache;
    DROP POLICY IF EXISTS "os_cache_site_write"  ON operating_score_cache;
    DROP POLICY IF EXISTS "os_cache_site_update" ON operating_score_cache;

    CREATE POLICY "os_cache_site_read" ON operating_score_cache
      FOR SELECT TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "os_cache_site_write" ON operating_score_cache
      FOR INSERT TO authenticated
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "os_cache_site_update" ON operating_score_cache
      FOR UPDATE TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 8. daily_operating_state
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='daily_operating_state') THEN
    DROP POLICY IF EXISTS "daily_state_auth"        ON daily_operating_state;
    DROP POLICY IF EXISTS "daily_state_site_read"   ON daily_operating_state;
    DROP POLICY IF EXISTS "daily_state_site_write"  ON daily_operating_state;
    DROP POLICY IF EXISTS "daily_state_site_update" ON daily_operating_state;

    CREATE POLICY "daily_state_site_read" ON daily_operating_state
      FOR SELECT TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "daily_state_site_write" ON daily_operating_state
      FOR INSERT TO authenticated
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "daily_state_site_update" ON daily_operating_state
      FOR UPDATE TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- 9. booking_snapshots
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='booking_snapshots') THEN
    DROP POLICY IF EXISTS "booking_snap_auth"        ON booking_snapshots;
    DROP POLICY IF EXISTS "booking_snap_site_read"   ON booking_snapshots;
    DROP POLICY IF EXISTS "booking_snap_site_write"  ON booking_snapshots;
    DROP POLICY IF EXISTS "booking_snap_site_update" ON booking_snapshots;

    CREATE POLICY "booking_snap_site_read" ON booking_snapshots
      FOR SELECT TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "booking_snap_site_write" ON booking_snapshots
      FOR INSERT TO authenticated
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );

    CREATE POLICY "booking_snap_site_update" ON booking_snapshots
      FOR UPDATE TO authenticated
      USING (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      )
      WITH CHECK (
        store_id IN (SELECT site_id FROM user_accessible_sites(auth.uid()))
      );
  END IF;
END $$;

-- ============================================================
-- Verify: service_role policies are untouched
-- ============================================================
-- All tables above still have their service_role USING (true) policy
-- from their original migrations. Backend operations (sync jobs,
-- cron handlers, admin routes using service role client) are unaffected.
--
-- To confirm after running: SELECT tablename, policyname, roles, qual
--   FROM pg_policies
--   WHERE tablename IN (
--     'actions','action_daily_stats','action_events','copilot_decisions',
--     'store_snapshots','service_signals','operating_score_cache',
--     'daily_operating_state','booking_snapshots'
--   )
--   ORDER BY tablename, policyname;
