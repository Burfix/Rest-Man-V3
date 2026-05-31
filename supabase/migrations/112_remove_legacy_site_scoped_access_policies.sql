-- ============================================================================
-- Migration 112: Remove Legacy site_scoped_access RLS Policies
-- ============================================================================
--
-- CONTEXT:
--   The `site_scoped_access` policies use the `user_site_access` BASE TABLE
--   directly. These have been superseded by granular, role-aware policies
--   that use `user_accessible_sites()` (the modern RPC).
--
-- TABLES:
--   actions         — already has: actions_site_read, actions_site_update,
--                     actions_site_delete, actions_site_write
--   maintenance_logs — already has: auth_select_maintenance_logs,
--                      auth_write_maintenance_logs, srole_full_maintenance_logs
--   daily_ops_tasks  — ONLY had site_scoped_access; modern policies added below
--
-- SAFETY:
--   For each table, we add the replacement policies BEFORE dropping the legacy
--   one to ensure zero access gap. All replacements use user_accessible_sites()
--   which is role-aware and correctly scoped.
-- ============================================================================

-- ── 1. actions: drop redundant legacy policy ──────────────────────────────
-- (modern granular policies already exist on this table)
DROP POLICY IF EXISTS site_scoped_access ON public.actions;


-- ── 2. maintenance_logs: drop redundant legacy policy ────────────────────
-- (auth_select_maintenance_logs + auth_write_maintenance_logs already exist)
DROP POLICY IF EXISTS site_scoped_access ON public.maintenance_logs;


-- ── 3. daily_ops_tasks: add modern policies FIRST, then drop legacy ───────

-- SELECT: any user who can access the site
CREATE POLICY daily_ops_tasks_site_read
  ON public.daily_ops_tasks
  FOR SELECT
  USING (
    site_id IN (
      SELECT site_id
      FROM   user_accessible_sites(auth.uid())
    )
  );

-- INSERT: any user who can access the site
CREATE POLICY daily_ops_tasks_site_write
  ON public.daily_ops_tasks
  FOR INSERT
  WITH CHECK (
    site_id IN (
      SELECT site_id
      FROM   user_accessible_sites(auth.uid())
    )
  );

-- UPDATE: any user who can access the site
CREATE POLICY daily_ops_tasks_site_update
  ON public.daily_ops_tasks
  FOR UPDATE
  USING (
    site_id IN (
      SELECT site_id
      FROM   user_accessible_sites(auth.uid())
    )
  );

-- DELETE: any user who can access the site
CREATE POLICY daily_ops_tasks_site_delete
  ON public.daily_ops_tasks
  FOR DELETE
  USING (
    site_id IN (
      SELECT site_id
      FROM   user_accessible_sites(auth.uid())
    )
  );

-- Service-role bypass (matches pattern used on other tables)
CREATE POLICY daily_ops_tasks_srole_full
  ON public.daily_ops_tasks
  FOR ALL
  USING (auth.role() = 'service_role');

-- Now safe to drop the legacy policy
DROP POLICY IF EXISTS site_scoped_access ON public.daily_ops_tasks;
