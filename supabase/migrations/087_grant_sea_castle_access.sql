-- ── 087: Grant super_admin access to Sea Castle org ──────────────────────────
--
-- Sea Castle Hotel (site 000000000004) belongs to organisation 000000000003.
-- The burfix@gmail.com super_admin account only had roles on org 1 and org 2,
-- so user_accessible_sites() excluded Sea Castle from the Sites Overview.
--
-- Fix: insert super_admin role for all existing super_admins on orgs 1/2
-- onto org 3 as well, so any super_admin sees all three organisations.

DO $$
BEGIN
  -- Insert a super_admin row on org 3 for every user that is already
  -- super_admin on org 1 or org 2, unless they already have one.
  INSERT INTO user_roles (user_id, organisation_id, role, is_active, granted_at)
  SELECT DISTINCT
    ur.user_id,
    '00000000-0000-0000-0000-000000000003'::uuid AS organisation_id,
    'super_admin'                                AS role,
    true                                         AS is_active,
    now()                                        AS granted_at
  FROM user_roles ur
  WHERE ur.role           = 'super_admin'
    AND ur.organisation_id IN (
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002'
    )
    AND ur.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM user_roles existing
      WHERE existing.user_id         = ur.user_id
        AND existing.organisation_id = '00000000-0000-0000-0000-000000000003'
        AND existing.role            = 'super_admin'
        AND existing.is_active       = true
    );

  RAISE NOTICE 'Migration 087: Sea Castle org access granted to % super_admin(s)',
    (SELECT COUNT(DISTINCT user_id) FROM user_roles
     WHERE organisation_id = '00000000-0000-0000-0000-000000000003'
       AND role = 'super_admin'
       AND is_active = true);
END $$;

-- Verify Sea Castle is now visible via user_accessible_sites
DO $$
DECLARE
  v_user_id uuid;
  v_count   int;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'burfix@gmail.com' LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Migration 087: burfix@gmail.com not found — skipping verification';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM user_accessible_sites(v_user_id)
  WHERE site_id = '00000000-0000-0000-0000-000000000004';

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Migration 087 FAILED: Sea Castle still not visible to burfix@gmail.com';
  END IF;

  RAISE NOTICE 'Migration 087 OK: Sea Castle visible to burfix@gmail.com';
END $$;
