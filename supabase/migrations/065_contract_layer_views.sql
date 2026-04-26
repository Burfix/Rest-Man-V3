-- ============================================================
-- Migration 065: Dashboard Contract Layer — Postgres Views
--
-- PURPOSE:
--   These views are the SINGLE SOURCE OF TRUTH for all admin
--   and head-office dashboard counts. UI tabs must NEVER
--   independently calculate top-level counts. API routes must
--   read from these views, not scatter queries across raw tables.
--
-- VIEWS CREATED:
--   1. v_stores               — canonical store list per org
--   2. v_users                — canonical team member list per org
--   3. v_integrations         — per-store integration status
--   4. v_tenant_summary       — per-org aggregate counts
--   5. v_site_health_summary  — per-store sync/data health
--
-- COMPATIBILITY:
--   team_members_all          — redirect view kept for backward compat
--   daily_sales_summary       — lightweight view over revenue_records
--
-- TENANCY:
--   Views expose all rows; tenant isolation is enforced by the
--   API layer (WHERE organisation_id = ctx.orgId) exactly as today.
--   RLS on underlying tables is NOT weakened.
--
-- PERMISSIONS:
--   service_role bypasses RLS (existing behaviour unchanged).
--   authenticated users never query these views directly — only
--   via the Next.js API routes which apply apiGuard().
-- ============================================================

-- ── 0. daily_sales_summary ────────────────────────────────────────────────────
-- Aggregates revenue_records to a daily total per site.
-- Also unions micros_sales_daily (via micros_connections.site_id) so all
-- revenue sources are covered in a single queryable surface.

CREATE OR REPLACE VIEW daily_sales_summary AS
-- Source: canonical revenue_records (manual + MICROS imports)
SELECT
  rr.site_id,
  rr.service_date        AS business_date,
  SUM(rr.net_sales)      AS net_sales,
  SUM(rr.gross_sales)    AS gross_sales,
  SUM(COALESCE(rr.covers, 0)) AS covers
FROM revenue_records rr
GROUP BY rr.site_id, rr.service_date

UNION ALL

-- Source: MICROS live sync (micros_sales_daily via connection → site)
SELECT
  mc.site_id,
  msd.business_date,
  SUM(msd.net_sales)     AS net_sales,
  SUM(msd.gross_sales)   AS gross_sales,
  SUM(COALESCE(msd.guest_count, 0)) AS covers
FROM micros_sales_daily msd
JOIN micros_connections mc ON mc.id = msd.connection_id
WHERE mc.site_id IS NOT NULL
GROUP BY mc.site_id, msd.business_date;

COMMENT ON VIEW daily_sales_summary IS
  'Contract layer: unified daily revenue per site from all sources. '
  'Do not query revenue_records or micros_sales_daily directly in admin routes.';


-- ── 1. v_stores ───────────────────────────────────────────────────────────────
-- Canonical store list. Includes org and region names for display.

DROP VIEW IF EXISTS v_stores;

CREATE VIEW v_stores AS
SELECT
  s.id,
  s.name,
  COALESCE(s.store_code, '')     AS store_code,
  s.address,
  s.city,
  s.timezone,
  s.is_active,
  s.organisation_id              AS org_id,
  COALESCE(o.name, '')           AS org_name,
  o.slug                         AS org_slug,
  s.region_id,
  r.name                         AS region_name,
  s.seating_capacity,
  s.target_avg_spend,
  s.target_labour_pct,
  s.target_margin_pct,
  s.created_at
FROM sites s
LEFT JOIN organisations o ON o.id = s.organisation_id
LEFT JOIN regions r       ON r.id = s.region_id;

COMMENT ON VIEW v_stores IS
  'Contract layer: canonical store list with org + region names resolved. '
  'Use this view for all admin store listings and counts. '
  'Filter by org_id for tenant scoping.';


-- ── 2. v_users ────────────────────────────────────────────────────────────────
-- Canonical team member list. Returns one row per profile.
-- primary_role = the most-recently-granted ACTIVE role.
-- site_ids     = proper uuid array from user_site_access (NOT a string).

DROP VIEW IF EXISTS v_users;

CREATE VIEW v_users AS
SELECT
  p.id                                           AS user_id,
  p.email,
  p.full_name,
  p.status,
  p.last_seen_at,
  p.created_at                                   AS joined_at,
  -- Latest active role (one row per user via LATERAL)
  ur.role                                        AS primary_role,
  ur.organisation_id                             AS org_id,
  ur.granted_at                                  AS role_granted_at,
  ur.is_active                                   AS role_is_active,
  COALESCE(o.name, '')                           AS org_name,
  -- Site access as a real uuid array (not comma-string)
  COALESCE(usa.site_ids, ARRAY[]::uuid[])        AS site_ids
FROM profiles p
LEFT JOIN LATERAL (
  SELECT role, organisation_id, granted_at, is_active
  FROM   user_roles
  WHERE  user_id   = p.id
    AND  is_active = true
    AND  revoked_at IS NULL
  ORDER  BY granted_at DESC
  LIMIT  1
) ur ON true
LEFT JOIN organisations o ON o.id = ur.organisation_id
LEFT JOIN LATERAL (
  SELECT array_agg(site_id) AS site_ids
  FROM   user_site_access
  WHERE  user_id = p.id
) usa ON true;

COMMENT ON VIEW v_users IS
  'Contract layer: canonical team member list. '
  'site_ids is a real uuid[] — no string parsing needed. '
  'Filter by org_id for tenant scoping.';


-- ── 3. team_members_all (backward-compat redirect) ───────────────────────────
-- Kept so that any direct Studio queries or external tools still work.
-- The admin users API route has been updated to use v_users directly.

CREATE OR REPLACE VIEW team_members_all AS
SELECT
  user_id,
  email,
  full_name,
  status                               AS profile_status,
  last_seen_at,
  primary_role,
  org_id                               AS primary_org_id,
  org_name                             AS primary_org_name,
  role_is_active,
  org_name                             AS all_org_names,
  NULL::text                           AS all_site_names,
  -- Legacy: comma-separated string for any existing consumers
  array_to_string(site_ids, ',')       AS all_site_ids,
  joined_at
FROM v_users;

COMMENT ON VIEW team_members_all IS
  'Backward-compat redirect to v_users. Use v_users for new code.';


-- ── 4. v_integrations ────────────────────────────────────────────────────────
-- Per-store MICROS integration status. Replaces the double-query pattern
-- (fetch sites + fetch micros_connections + JS join) in the integrations route.
-- Token expiry and staleness are calculated in SQL, not application code.

DROP VIEW IF EXISTS v_integrations;

CREATE VIEW v_integrations AS
SELECT
  s.id                                                         AS store_id,
  s.name                                                       AS store_name,
  COALESCE(s.store_code, '')                                   AS store_code,
  s.is_active,
  s.organisation_id                                            AS org_id,
  -- Integration status: resolved precedence chain
  CASE
    WHEN mc.id IS NULL                                       THEN 'none'
    WHEN mc.token_expires_at < now()                         THEN 'expired'
    WHEN mc.status <> 'connected'                            THEN mc.status
    WHEN mc.last_sync_at IS NULL                             THEN 'stale'
    WHEN EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) > 86400 THEN 'stale'
    ELSE mc.status
  END                                                          AS micros_status,
  mc.micros_org_id,
  mc.micros_loc_id,
  mc.last_sync_at,
  mc.token_expires_at,
  -- Sync age in minutes (null if never synced)
  CASE
    WHEN mc.last_sync_at IS NULL THEN NULL
    ELSE (EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) / 60)::integer
  END                                                          AS sync_age_minutes,
  -- is_stale: true when no sync in last 24 h
  CASE
    WHEN mc.last_sync_at IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) > 86400 THEN true
    ELSE false
  END                                                          AS is_stale
FROM sites s
LEFT JOIN micros_connections mc ON mc.site_id = s.id;

COMMENT ON VIEW v_integrations IS
  'Contract layer: per-store integration status with staleness/expiry resolved in SQL. '
  'Replaces double-query (sites + micros_connections) + JS join in integrations route.';


-- ── 5. v_tenant_summary ──────────────────────────────────────────────────────
-- Per-org aggregate row: store counts, user counts, integration health.
-- overview route reads this instead of running 5 parallel queries + JS sums.

DROP VIEW IF EXISTS v_tenant_summary;

CREATE VIEW v_tenant_summary AS
SELECT
  o.id                                                                  AS org_id,
  o.name                                                                AS org_name,
  o.slug                                                                AS org_slug,
  o.is_active                                                           AS org_is_active,
  COUNT(DISTINCT s.id)                                                  AS total_stores,
  COUNT(DISTINCT s.id) FILTER (WHERE s.is_active = true)               AS active_stores,
  -- Users = distinct user_ids with an active role in this org
  COUNT(DISTINCT ur.user_id) FILTER (WHERE ur.is_active = true)        AS total_users,
  -- Active today = users seen in the last 24 hours
  COUNT(DISTINCT p.id) FILTER (
    WHERE p.last_seen_at IS NOT NULL
      AND p.last_seen_at >= now() - INTERVAL '24 hours'
      AND ur.is_active = true
      AND ur.organisation_id = o.id
  )                                                                     AS active_today,
  COUNT(DISTINCT mc.site_id) FILTER (WHERE mc.status = 'connected')    AS connected_integrations,
  COUNT(DISTINCT mc.site_id) FILTER (
    WHERE mc.last_sync_at IS NULL
      OR EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) > 86400
  )                                                                     AS stale_integrations
FROM organisations o
LEFT JOIN sites          s  ON s.organisation_id = o.id
LEFT JOIN user_roles     ur ON ur.organisation_id = o.id
LEFT JOIN profiles       p  ON p.id = ur.user_id
LEFT JOIN micros_connections mc ON mc.site_id = s.id
GROUP BY o.id, o.name, o.slug, o.is_active;

COMMENT ON VIEW v_tenant_summary IS
  'Contract layer: one row per org with canonical aggregate counts. '
  'overview API reads this instead of 5 parallel queries. '
  'Sum rows for super_admin; filter by org_id for scoped users.';


-- ── 6. v_site_health_summary ─────────────────────────────────────────────────
-- Per-store data health. Replaces 5-query + JS join in data-health route.
-- Uses sync_runs / sync_errors from migration 042_sync_engine_v2.

DROP VIEW IF EXISTS v_site_health_summary;

CREATE VIEW v_site_health_summary AS
WITH
  -- Last sync per store (from micros_connections)
  conn_status AS (
    SELECT
      mc.site_id,
      mc.status              AS integration_status,
      mc.last_sync_at
    FROM micros_connections mc
    WHERE mc.site_id IS NOT NULL
  ),
  -- Latest sales date per store (revenue_records canonical)
  last_sale AS (
    SELECT
      site_id,
      MAX(service_date) AS last_sales_date
    FROM revenue_records
    GROUP BY site_id
  ),
  -- Recent sync errors per store (last 7 days)
  recent_errs AS (
    SELECT
      site_id,
      COUNT(*) AS error_count
    FROM sync_errors
    WHERE created_at >= now() - INTERVAL '7 days'
    GROUP BY site_id
  ),
  -- Failed sync runs per store (last 7 days)
  failed AS (
    SELECT
      site_id,
      COUNT(*) AS failed_count
    FROM sync_runs
    WHERE status = 'error'
      AND created_at >= now() - INTERVAL '7 days'
    GROUP BY site_id
  )
SELECT
  s.id                                                                  AS site_id,
  s.name                                                                AS store_name,
  COALESCE(s.store_code, '')                                            AS store_code,
  s.is_active,
  s.organisation_id                                                     AS org_id,
  COALESCE(cs.integration_status, 'none')                              AS integration_status,
  cs.last_sync_at,
  -- Stale minutes (integer, null if never synced)
  CASE
    WHEN cs.last_sync_at IS NULL THEN NULL
    ELSE (EXTRACT(EPOCH FROM (now() - cs.last_sync_at)) / 60)::integer
  END                                                                   AS stale_minutes,
  ls.last_sales_date,
  COALESCE(re.error_count, 0)                                          AS recent_errors,
  COALESCE(f.failed_count, 0)                                          AS failed_runs,
  -- Health classification (mirrors application logic, now canonical)
  CASE
    WHEN cs.last_sync_at IS NULL                                       THEN 'unknown'
    WHEN (EXTRACT(EPOCH FROM (now() - cs.last_sync_at)) / 60) < 120
      AND COALESCE(f.failed_count, 0) = 0                              THEN 'healthy'
    WHEN (EXTRACT(EPOCH FROM (now() - cs.last_sync_at)) / 60) < 1440  THEN 'warning'
    ELSE 'critical'
  END                                                                   AS health
FROM sites s
LEFT JOIN conn_status cs ON cs.site_id = s.id
LEFT JOIN last_sale   ls ON ls.site_id = s.id
LEFT JOIN recent_errs re ON re.site_id = s.id
LEFT JOIN failed      f  ON f.site_id  = s.id;

COMMENT ON VIEW v_site_health_summary IS
  'Contract layer: per-store data health with health classification in SQL. '
  'Replaces 5-query + JS join in data-health route. '
  'health is one of: healthy | warning | critical | unknown.';
