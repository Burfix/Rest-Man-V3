-- ============================================================
-- Migration 066: Observability Views
--
-- PURPOSE:
--   Two supplementary contract-layer views that eliminate the
--   remaining raw-table queries in the admin overview route.
--
--   v_role_distribution — replaces the live user_roles scan
--     (was: SELECT role, is_active, organisation_id FROM user_roles)
--
--   v_audit_summary     — replaces the COUNT(*) on access_audit_log
--     (was: SELECT id FROM access_audit_log COUNT exact head)
--
-- TENANCY:
--   Both views expose all rows; tenant isolation is enforced by
--   the API layer (WHERE org_id = ctx.orgId) exactly as today.
--   RLS on underlying tables is NOT weakened.
-- ============================================================

-- ── 1. v_role_distribution ────────────────────────────────────────────────────
-- Active role counts per organisation, grouped by role name.
-- overview route reads this instead of fetching all active user_roles rows
-- and accumulating the counts in JavaScript.

DROP VIEW IF EXISTS v_role_distribution;

CREATE VIEW v_role_distribution AS
SELECT
  ur.organisation_id                  AS org_id,
  ur.role,
  COUNT(*)                            AS member_count
FROM user_roles ur
WHERE ur.is_active = true
  AND ur.revoked_at IS NULL
GROUP BY ur.organisation_id, ur.role;

COMMENT ON VIEW v_role_distribution IS
  'Contract layer: active role counts per org, grouped by role. '
  'overview API reads this instead of scanning user_roles in JS.';


-- ── 2. v_audit_summary ────────────────────────────────────────────────────────
-- Total audit event count per organisation (+ a global total for super_admin).
-- overview route reads this instead of COUNT(*head) on access_audit_log.
--
-- NOTE: access_audit_log does not have an organisation_id column directly;
-- it stores actor_user_id + target_user_id. We join through user_roles to
-- resolve org scope. For super_admin the route sums all rows.

DROP VIEW IF EXISTS v_audit_summary;

CREATE VIEW v_audit_summary AS
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
  'Contract layer: audit event counts per org. '
  'Super admin sums all rows; scoped users filter by org_id. '
  'Joins actor_user_id -> user_roles to resolve organisation scope.';
