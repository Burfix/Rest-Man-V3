-- ============================================================================
-- Migration 111: Fix fs_user_can_access_site() — Role-Aware Org-Level Grant
-- ============================================================================
--
-- PROBLEM:
--   The previous implementation granted org-wide site access to ANY active
--   user role in the organisation. This means a GM or supervisor with
--   organisation_id set (but no explicit site_id) could access ALL sites in
--   the org — a cross-site data leak once a second site is added to any org.
--
-- FIX:
--   Org-level grant is now restricted to elevated roles only:
--     super_admin, head_office, executive, auditor, area_manager
--
--   GM, supervisor, contractor, viewer MUST have an explicit site_id match
--   in user_roles. If they don't, they see nothing — by design.
--
-- TENANT SAFETY:
--   SECURITY DEFINER + search_path = 'public' preserved.
--   No change to how service_role or RLS bypass works.
--   auth.uid() scoping preserved.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fs_user_can_access_site(p_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   user_roles ur
    WHERE  ur.user_id   = auth.uid()
    AND    ur.is_active = true
    AND    (
      -- ── Explicit site match: works for ALL roles ──────────────────────────
      ur.site_id = p_site_id

      -- ── Org-level grant: ELEVATED roles only ─────────────────────────────
      -- GM / supervisor / contractor / viewer must have explicit site_id.
      -- Prevents cross-site leakage when a second site joins the org.
      OR (
        ur.role IN ('super_admin', 'head_office', 'executive', 'auditor', 'area_manager')
        AND ur.organisation_id IN (
          SELECT s.organisation_id
          FROM   sites s
          WHERE  s.id = p_site_id
        )
      )
    )
  );
$$;

-- Grant execute to authenticated role (SECURITY DEFINER runs as owner)
GRANT EXECUTE ON FUNCTION public.fs_user_can_access_site(uuid) TO authenticated;
