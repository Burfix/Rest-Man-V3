-- ============================================================
-- Migration 024: RBAC + Role Profiles
--
-- Roles:
--   super_admin    — full platform access, all orgs
--   executive      — read all data for their org; no edits
--   area_manager   — full access within their region
--   gm             — full access within their store
--   supervisor     — read + limited write within their store
--   contractor     — view/update assigned maintenance tickets only
--   auditor        — read-only across org; compliance-focused
-- ============================================================

-- ── Role lookup table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,             -- references auth.users(id)
  organisation_id  uuid REFERENCES organisations(id) ON DELETE CASCADE,
  region_id        uuid REFERENCES regions(id) ON DELETE SET NULL,
  site_id          uuid REFERENCES sites(id) ON DELETE SET NULL,
  role             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  granted_by       uuid,                      -- auth.users
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  CONSTRAINT check_role CHECK (role IN (
    'super_admin',
    'executive',
    'area_manager',
    'gm',
    'supervisor',
    'contractor',
    'auditor'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique
  ON user_roles (user_id, organisation_id, role)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_user    ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_site    ON user_roles (site_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_region  ON user_roles (region_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "srole_full_user_roles" ON user_roles FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow users to read their own roles
CREATE POLICY "users_read_own_roles"
  ON user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── Helper function — check if a user has a role ──────────────────────────────

CREATE OR REPLACE FUNCTION has_role(
  p_user_id uuid,
  p_roles    text[]
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE  user_id   = p_user_id
      AND  role      = ANY(p_roles)
      AND  is_active = true
      AND  revoked_at IS NULL
  );
$$;

-- ── Helper function — get user site access list ───────────────────────────────

CREATE OR REPLACE FUNCTION user_accessible_sites(p_user_id uuid)
RETURNS TABLE (site_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- super_admin / executive / auditor  →  all sites in their org
  SELECT s.id
  FROM   sites s
  JOIN   organisations o ON o.id = s.organisation_id
  WHERE  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id        = p_user_id
        AND  ur.organisation_id = o.id
        AND  ur.role           IN ('super_admin','executive','auditor')
        AND  ur.is_active      = true
    )

  UNION

  -- area_manager  →  all sites in their region
  SELECT s.id
  FROM   sites s
  WHERE  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id   = p_user_id
        AND  ur.region_id = s.region_id
        AND  ur.role      = 'area_manager'
        AND  ur.is_active = true
    )

  UNION

  -- gm / supervisor / contractor  →  their specific site only
  SELECT ur.site_id
  FROM   user_roles ur
  WHERE  ur.user_id   = p_user_id
    AND  ur.role      IN ('gm','supervisor','contractor')
    AND  ur.is_active = true
    AND  ur.site_id   IS NOT NULL;
$$;

-- ── RLS policies for canonical tables using RBAC ─────────────────────────────
-- Pattern: authenticated users can SELECT data for sites they can access.
-- Writes are gated by role in the application layer (service_role client).

-- sites / stores
CREATE POLICY "rbac_read_sites"
  ON sites FOR SELECT TO authenticated
  USING (id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- service_days
CREATE POLICY "rbac_read_service_days"
  ON service_days FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- revenue_records
CREATE POLICY "rbac_read_revenue"
  ON revenue_records FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- labour_records
CREATE POLICY "rbac_read_labour"
  ON labour_records FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- assets
CREATE POLICY "rbac_read_assets"
  ON assets FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- maintenance_tickets
CREATE POLICY "rbac_read_maintenance"
  ON maintenance_tickets FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- Contractors can only see their own assigned tickets
CREATE POLICY "contractor_read_own_tickets"
  ON maintenance_tickets FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    AND has_role(auth.uid(), ARRAY['contractor'])
  );

-- compliance_items
CREATE POLICY "rbac_read_compliance"
  ON compliance_items FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- compliance_documents
CREATE POLICY "rbac_read_comp_docs"
  ON compliance_documents FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- reviews
CREATE POLICY "rbac_read_reviews"
  ON reviews FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- incidents
CREATE POLICY "rbac_read_incidents"
  ON incidents FOR SELECT TO authenticated
  USING (site_id IN (SELECT site_id FROM user_accessible_sites(auth.uid())));

-- organisations (executive and above see their own org)
CREATE POLICY "rbac_read_organisations"
  ON organisations FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT organisation_id FROM user_roles
      WHERE  user_id   = auth.uid()
        AND  role      IN ('super_admin','executive','area_manager','auditor','gm','supervisor')
        AND  is_active = true
    )
  );

-- regions
CREATE POLICY "rbac_read_regions"
  ON regions FOR SELECT TO authenticated
  USING (
    organisation_id IN (
      SELECT organisation_id FROM user_roles
      WHERE  user_id   = auth.uid()
        AND  is_active = true
    )
  );
