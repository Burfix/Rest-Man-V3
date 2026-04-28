-- ============================================================
-- Migration 073: Restore Admin Contract-Layer Views
--
-- Restores all views from migrations 065 + 066 that may have
-- been dropped or are missing from the schema cache.
--
-- Views restored:
--   1. v_stores            — canonical store list per org
--   2. v_users             — canonical team member list per org
--   3. v_integrations      — per-store MICROS integration status
--   4. v_tenant_summary    — per-org aggregate counts
--   5. v_role_distribution — active role counts per org
--   6. v_audit_summary     — audit event counts per org
--
-- Base table: sites (not stores)
-- All views are idempotent: CREATE OR REPLACE VIEW
-- ============================================================

-- ── 1. v_stores ───────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_stores AS
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

CREATE OR REPLACE VIEW v_users AS
SELECT
  p.id                                           AS user_id,
  p.email,
  p.full_name,
  p.status,
  p.last_seen_at,
  p.created_at                                   AS joined_at,
  ur.role                                        AS primary_role,
  ur.organisation_id                             AS org_id,
  ur.granted_at                                  AS role_granted_at,
  ur.is_active                                   AS role_is_active,
  COALESCE(o.name, '')                           AS org_name,
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


-- ── 3. v_integrations ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_integrations AS
SELECT
  s.id                                                         AS store_id,
  s.name                                                       AS store_name,
  COALESCE(s.store_code, '')                                   AS store_code,
  s.is_active,
  s.organisation_id                                            AS org_id,
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
  CASE
    WHEN mc.last_sync_at IS NULL THEN NULL
    ELSE (EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) / 60)::integer
  END                                                          AS sync_age_minutes,
  CASE
    WHEN mc.last_sync_at IS NULL THEN true
    WHEN EXTRACT(EPOCH FROM (now() - mc.last_sync_at)) > 86400 THEN true
    ELSE false
  END                                                          AS is_stale
FROM sites s
LEFT JOIN micros_connections mc ON mc.site_id = s.id;

COMMENT ON VIEW v_integrations IS
  'Contract layer: per-store integration status with staleness/expiry resolved in SQL.';


-- ── 4. v_tenant_summary ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_tenant_summary AS
SELECT
  o.id                                                                  AS org_id,
  o.name                                                                AS org_name,
  o.slug                                                                AS org_slug,
  o.is_active                                                           AS org_is_active,
  COUNT(DISTINCT s.id)                                                  AS total_stores,
  COUNT(DISTINCT s.id) FILTER (WHERE s.is_active = true)               AS active_stores,
  COUNT(DISTINCT ur.user_id) FILTER (WHERE ur.is_active = true)        AS total_users,
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
  'overview API reads this instead of 5 parallel queries.';


-- ── 5. v_role_distribution ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_role_distribution AS
SELECT
  ur.organisation_id                  AS org_id,
  ur.role,
  COUNT(*)                            AS member_count
FROM user_roles ur
WHERE ur.is_active = true
  AND ur.revoked_at IS NULL
GROUP BY ur.organisation_id, ur.role;

COMMENT ON VIEW v_role_distribution IS
  'Contract layer: active role counts per org, grouped by role.';


-- ── 6. v_audit_summary ────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_audit_summary AS
SELECT
  COALESCE(ur.organisation_id, '00000000-0000-0000-0000-000000000000'::uuid) AS org_id,
  COUNT(DISTINCT aal.id)                                                      AS audit_count
FROM access_audit_log aal
LEFT JOIN user_roles ur
  ON ur.user_id = aal.actor_user_id
  AND ur.is_active = true
  AND ur.revoked_at IS NULL
GROUP BY ur.organisation_id;

COMMENT ON VIEW v_audit_summary IS
  'Contract layer: audit event counts per org.';
