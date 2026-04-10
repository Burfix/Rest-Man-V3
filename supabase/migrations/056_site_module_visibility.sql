-- 056 — Per-site module visibility
-- Allows restricting which dashboard modules a site's users can access.
-- When NULL (default), all role-permitted routes are visible.
-- When set, routes are intersected with the role's allowed routes.

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS allowed_routes TEXT[] DEFAULT NULL;

COMMENT ON COLUMN sites.allowed_routes
  IS 'Optional array of dashboard route prefixes visible to this site. NULL = all routes. When set, intersected with role permissions.';

-- Restrict Primi Camps Bay to Command Centre + Daily Ops + Maintenance + Compliance
UPDATE sites
SET allowed_routes = ARRAY[
  '/dashboard',
  '/dashboard/daily-ops',
  '/dashboard/maintenance',
  '/dashboard/compliance',
  '/dashboard/access-restricted'
]
WHERE id = '00000000-0000-0000-0000-000000000003';
