-- ============================================================
-- Migration 070: Compliance RLS + Expiring-Soon View
--
-- 1. Helper functions — resolve current user's compliance role
--    and tenant_id from the compliance_users table via auth.email().
-- 2. Row Level Security policies on all compliance tables.
-- 3. v_compliance_expiring_soon — powers Risk Radar, weekly
--    report, and scheduled notification jobs.
--
-- Access model:
--   SUPER_ADMIN / EXECUTIVE  →  read everything
--   OFFICER                  →  read everything, write reviews & cert status
--   TENANT                   →  read/write own tenant rows only
--   service_role             →  unrestricted (bypasses RLS)
-- ============================================================

-- ── Helper: current compliance role ──────────────────────────────────────────
--
-- Looks up compliance_users.role by the Supabase Auth email claim.
-- SECURITY DEFINER so it can read compliance_users even when called
-- from a restricted session.

CREATE OR REPLACE FUNCTION compliance_current_role()
RETURNS compliance_role
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role
  FROM   compliance_users
  WHERE  email = auth.jwt() ->> 'email'
  LIMIT  1;
$$;

-- ── Helper: current compliance tenant_id ─────────────────────────────────────

CREATE OR REPLACE FUNCTION compliance_current_tenant_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT tenant_id
  FROM   compliance_users
  WHERE  email = auth.jwt() ->> 'email'
  LIMIT  1;
$$;

-- ── RLS policies: tenants ─────────────────────────────────────────────────────

-- service_role full access
CREATE POLICY "srole_tenants"
  ON tenants FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SUPER_ADMIN / EXECUTIVE — read all
CREATE POLICY "exec_read_tenants"
  ON tenants FOR SELECT TO authenticated
  USING (compliance_current_role() IN ('SUPER_ADMIN', 'EXECUTIVE'));

-- OFFICER — read all
CREATE POLICY "officer_read_tenants"
  ON tenants FOR SELECT TO authenticated
  USING (compliance_current_role() = 'OFFICER');

-- TENANT — read own record only
CREATE POLICY "tenant_read_own_tenant"
  ON tenants FOR SELECT TO authenticated
  USING (id = compliance_current_tenant_id());

-- ── RLS policies: compliance_users ───────────────────────────────────────────

CREATE POLICY "srole_compliance_users"
  ON compliance_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SUPER_ADMIN — full read
CREATE POLICY "super_admin_read_compliance_users"
  ON compliance_users FOR SELECT TO authenticated
  USING (compliance_current_role() = 'SUPER_ADMIN');

-- EXECUTIVE / OFFICER — read all
CREATE POLICY "elevated_read_compliance_users"
  ON compliance_users FOR SELECT TO authenticated
  USING (compliance_current_role() IN ('EXECUTIVE', 'OFFICER'));

-- TENANT — read own row only
CREATE POLICY "tenant_read_own_user"
  ON compliance_users FOR SELECT TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- SUPER_ADMIN — manage users
CREATE POLICY "super_admin_write_compliance_users"
  ON compliance_users FOR ALL TO authenticated
  USING  (compliance_current_role() = 'SUPER_ADMIN')
  WITH CHECK (compliance_current_role() = 'SUPER_ADMIN');

-- ── RLS policies: certificate_types ──────────────────────────────────────────

CREATE POLICY "srole_certificate_types"
  ON certificate_types FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- All authenticated compliance users can read types
CREATE POLICY "auth_read_certificate_types"
  ON certificate_types FOR SELECT TO authenticated
  USING (compliance_current_role() IS NOT NULL);

-- Only SUPER_ADMIN / OFFICER can manage types
CREATE POLICY "admin_write_certificate_types"
  ON certificate_types FOR ALL TO authenticated
  USING  (compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER'))
  WITH CHECK (compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER'));

-- ── RLS policies: certificates ───────────────────────────────────────────────

CREATE POLICY "srole_certificates"
  ON certificates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SUPER_ADMIN / EXECUTIVE — read all
CREATE POLICY "exec_read_certificates"
  ON certificates FOR SELECT TO authenticated
  USING (compliance_current_role() IN ('SUPER_ADMIN', 'EXECUTIVE'));

-- OFFICER — read all
CREATE POLICY "officer_read_certificates"
  ON certificates FOR SELECT TO authenticated
  USING (compliance_current_role() = 'OFFICER');

-- OFFICER — update status (approve/reject)
CREATE POLICY "officer_update_certificates"
  ON certificates FOR UPDATE TO authenticated
  USING  (compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER'))
  WITH CHECK (compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER'));

-- TENANT — read own certs
CREATE POLICY "tenant_read_own_certificates"
  ON certificates FOR SELECT TO authenticated
  USING (
    compliance_current_role() = 'TENANT'
    AND tenant_id = compliance_current_tenant_id()
  );

-- TENANT — insert/upload own certs
CREATE POLICY "tenant_insert_own_certificates"
  ON certificates FOR INSERT TO authenticated
  WITH CHECK (
    compliance_current_role() = 'TENANT'
    AND tenant_id = compliance_current_tenant_id()
  );

-- TENANT — update own certs (e.g. re-upload)
CREATE POLICY "tenant_update_own_certificates"
  ON certificates FOR UPDATE TO authenticated
  USING (
    compliance_current_role() = 'TENANT'
    AND tenant_id = compliance_current_tenant_id()
  )
  WITH CHECK (
    compliance_current_role() = 'TENANT'
    AND tenant_id = compliance_current_tenant_id()
  );

-- ── RLS policies: certificate_reviews ────────────────────────────────────────

CREATE POLICY "srole_certificate_reviews"
  ON certificate_reviews FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SUPER_ADMIN / OFFICER — read all reviews
CREATE POLICY "officer_read_reviews"
  ON certificate_reviews FOR SELECT TO authenticated
  USING (compliance_current_role() IN ('SUPER_ADMIN', 'EXECUTIVE', 'OFFICER'));

-- OFFICER / SUPER_ADMIN — write reviews
CREATE POLICY "officer_insert_reviews"
  ON certificate_reviews FOR INSERT TO authenticated
  WITH CHECK (compliance_current_role() IN ('SUPER_ADMIN', 'OFFICER'));

-- TENANT — read reviews on their own certs
CREATE POLICY "tenant_read_own_reviews"
  ON certificate_reviews FOR SELECT TO authenticated
  USING (
    compliance_current_role() = 'TENANT'
    AND EXISTS (
      SELECT 1 FROM certificates c
      WHERE  c.id        = certificate_reviews.certificate_id
        AND  c.tenant_id = compliance_current_tenant_id()
    )
  );

-- ── RLS policies: compliance_audit_log ───────────────────────────────────────

CREATE POLICY "srole_audit_log"
  ON compliance_audit_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- SUPER_ADMIN — read all audit log
CREATE POLICY "super_admin_read_audit_log"
  ON compliance_audit_log FOR SELECT TO authenticated
  USING (compliance_current_role() = 'SUPER_ADMIN');

-- OFFICER / EXECUTIVE — read all audit log
CREATE POLICY "elevated_read_audit_log"
  ON compliance_audit_log FOR SELECT TO authenticated
  USING (compliance_current_role() IN ('EXECUTIVE', 'OFFICER'));

-- TENANT — read own tenant audit entries
CREATE POLICY "tenant_read_own_audit_log"
  ON compliance_audit_log FOR SELECT TO authenticated
  USING (
    compliance_current_role() = 'TENANT'
    AND tenant_id = compliance_current_tenant_id()
  );

-- Any authenticated compliance user can write audit entries
CREATE POLICY "auth_insert_audit_log"
  ON compliance_audit_log FOR INSERT TO authenticated
  WITH CHECK (compliance_current_role() IS NOT NULL);

-- ── View: v_compliance_expiring_soon ─────────────────────────────────────────
--
-- Powers Risk Radar, the weekly report, and scheduled reminders.
-- Returns certs that are already expired or expiring within 90 days.

CREATE OR REPLACE VIEW v_compliance_expiring_soon AS
SELECT
  c.id                  AS certificate_id,
  c.tenant_id,
  t.name                AS tenant,
  t.precinct,
  ct.id                 AS certificate_type_id,
  ct.name               AS certificate_type,
  c.status,
  c.expiry_date,
  CASE
    WHEN c.expiry_date <  now()                           THEN 'EXPIRED'
    WHEN c.expiry_date <  now() + INTERVAL '30 days'      THEN '30_DAYS'
    WHEN c.expiry_date <  now() + INTERVAL '60 days'      THEN '60_DAYS'
    WHEN c.expiry_date <  now() + INTERVAL '90 days'      THEN '90_DAYS'
    ELSE 'OK'
  END                   AS expiry_window,
  -- Days until expiry (negative = already expired)
  (c.expiry_date - CURRENT_DATE)::int AS days_until_expiry
FROM  certificates c
JOIN  tenants           t  ON t.id  = c.tenant_id
JOIN  certificate_types ct ON ct.id = c.certificate_type_id
WHERE c.expiry_date IS NOT NULL
  AND c.expiry_date < now() + INTERVAL '90 days'
ORDER BY c.expiry_date ASC;

-- ── View: v_compliance_summary_by_tenant ─────────────────────────────────────
--
-- One row per tenant with counts by status — used in exec dashboard.

CREATE OR REPLACE VIEW v_compliance_summary_by_tenant AS
SELECT
  t.id                                           AS tenant_id,
  t.name                                         AS tenant,
  t.precinct,
  COUNT(*)                                       AS total_certificates,
  COUNT(*) FILTER (WHERE c.status = 'APPROVED')          AS approved,
  COUNT(*) FILTER (WHERE c.status = 'AWAITING_REVIEW')   AS awaiting_review,
  COUNT(*) FILTER (WHERE c.status = 'REJECTED')          AS rejected,
  COUNT(*) FILTER (WHERE c.status = 'EXPIRED')           AS expired,
  COUNT(*) FILTER (WHERE c.status = 'MISSING')           AS missing,
  COUNT(*) FILTER (
    WHERE c.expiry_date IS NOT NULL
      AND c.expiry_date < now() + INTERVAL '30 days'
      AND c.status = 'APPROVED'
  )                                              AS expiring_30_days,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE c.status = 'APPROVED')
    / NULLIF(COUNT(*), 0),
    1
  )                                              AS compliance_pct
FROM  tenants t
LEFT JOIN certificates c ON c.tenant_id = t.id
GROUP BY t.id, t.name, t.precinct;
