-- ── 050: Head Office site scoping ─────────────────────────────────────────────
--
-- Previously, head_office users always saw ALL org sites.
-- Now: if a head_office user has explicit user_site_access rows,
-- they only see those sites. If they have no entries, they still
-- see all org sites (backwards-compatible default).
--
-- This enables restricting head_office users to specific stores.

CREATE OR REPLACE FUNCTION user_accessible_sites(p_user_id uuid)
RETURNS TABLE (site_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- super_admin / executive / auditor → always all sites in their org
  SELECT s.id
  FROM   sites s
  JOIN   organisations o ON o.id = s.organisation_id
  WHERE  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id         = p_user_id
        AND  ur.organisation_id = o.id
        AND  ur.role           IN ('super_admin','executive','auditor')
        AND  ur.is_active      = true
    )

  UNION

  -- head_office with NO user_site_access rows → all org sites (default)
  SELECT s.id
  FROM   sites s
  JOIN   organisations o ON o.id = s.organisation_id
  WHERE  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id         = p_user_id
        AND  ur.organisation_id = o.id
        AND  ur.role            = 'head_office'
        AND  ur.is_active       = true
    )
    AND  NOT EXISTS (
      SELECT 1 FROM user_site_access usa
      WHERE  usa.user_id = p_user_id
    )

  UNION

  -- head_office WITH user_site_access rows → only those sites
  SELECT usa.site_id
  FROM   user_site_access usa
  JOIN   sites s ON s.id = usa.site_id
  WHERE  usa.user_id = p_user_id
    AND  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id   = p_user_id
        AND  ur.role       = 'head_office'
        AND  ur.is_active  = true
    )

  UNION

  -- area_manager → all sites in their region
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

  -- gm / supervisor / contractor / viewer → their specific site
  SELECT ur.site_id
  FROM   user_roles ur
  WHERE  ur.user_id  = p_user_id
    AND  ur.role     IN ('gm','supervisor','contractor','viewer')
    AND  ur.is_active = true
    AND  ur.site_id  IS NOT NULL

  UNION

  -- Explicit site access grants (for non-head_office roles)
  SELECT usa.site_id
  FROM   user_site_access usa
  JOIN   sites s ON s.id = usa.site_id
  WHERE  usa.user_id = p_user_id
    AND  s.is_active = true
    AND  NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id = p_user_id
        AND  ur.role     = 'head_office'
        AND  ur.is_active = true
    )
$$;
