-- ============================================================
-- Migration 046: Add Si Cantina client + test site
-- ============================================================

-- ── Si Cantina Organisation ───────────────────────────────────────────────────

INSERT INTO organisations (id, name, slug, country, timezone, currency)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Si Cantina',
  'si-cantina',
  'ZA',
  'Africa/Johannesburg',
  'ZAR'
) ON CONFLICT (id) DO UPDATE SET name = 'Si Cantina', slug = 'si-cantina';

-- ── Si Cantina Region ─────────────────────────────────────────────────────────

INSERT INTO regions (id, organisation_id, name, code)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  '00000000-0000-0000-0000-000000000002',
  'Western Cape',
  'WC'
) ON CONFLICT DO NOTHING;

-- ── Si Cantina Store ──────────────────────────────────────────────────────────

INSERT INTO sites (id, name, site_type, address, city, timezone, organisation_id, region_id, store_code, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  'Si Cantina Camps Bay',
  'restaurant',
  'Victoria Road, Camps Bay',
  'Cape Town',
  'Africa/Johannesburg',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000020',
  'SC-CB',
  true
) ON CONFLICT (id) DO UPDATE SET
  name = 'Si Cantina Camps Bay',
  store_code = 'SC-CB',
  organisation_id = '00000000-0000-0000-0000-000000000002',
  region_id = '00000000-0000-0000-0000-000000000020';

-- ── Test Site ─────────────────────────────────────────────────────────────────

INSERT INTO sites (id, name, site_type, address, city, timezone, organisation_id, region_id, store_code, is_active)
VALUES (
  '00000000-0000-0000-0000-00000000ff01',
  'Test Store (Sandbox)',
  'restaurant',
  '123 Test Street',
  'Cape Town',
  'Africa/Johannesburg',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  'TEST-01',
  true
) ON CONFLICT (id) DO UPDATE SET
  name = 'Test Store (Sandbox)',
  store_code = 'TEST-01',
  organisation_id = '00000000-0000-0000-0000-000000000001',
  region_id = '00000000-0000-0000-0000-000000000010';

-- ── Grant super_admin access to new sites ─────────────────────────────────────

INSERT INTO user_site_access (user_id, site_id) VALUES
  ('5fa15569-8415-4118-9d83-1fd7d8408963', '00000000-0000-0000-0000-000000000003'),
  ('5fa15569-8415-4118-9d83-1fd7d8408963', '00000000-0000-0000-0000-00000000ff01')
ON CONFLICT DO NOTHING;

-- Also grant a org-level role for Si Cantina so super_admin can see it
INSERT INTO user_roles (user_id, role, organisation_id, is_active, granted_at, granted_by)
VALUES (
  '5fa15569-8415-4118-9d83-1fd7d8408963',
  'super_admin',
  '00000000-0000-0000-0000-000000000002',
  true,
  now(),
  '5fa15569-8415-4118-9d83-1fd7d8408963'
) ON CONFLICT DO NOTHING;
