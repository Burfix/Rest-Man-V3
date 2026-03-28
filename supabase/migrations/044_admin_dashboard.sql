-- ============================================================
-- Migration 044: Admin Dashboard — Full Bootstrap
--
-- Creates all missing tables: organisations, regions, profiles,
-- user_site_access, access_audit_log. Extends sites + user_roles.
-- Seeds Primi org, 2 stores, and admin user.
-- ============================================================

-- ── Organisations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organisations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  country      text NOT NULL DEFAULT 'ZA',
  timezone     text NOT NULL DEFAULT 'Africa/Johannesburg',
  currency     text NOT NULL DEFAULT 'ZAR',
  settings     jsonb NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='organisations' AND policyname='srole_orgs') THEN
    CREATE POLICY srole_orgs ON organisations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO organisations (id, name, slug, country, timezone, currency)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Primi',
  'primi',
  'ZA',
  'Africa/Johannesburg',
  'ZAR'
) ON CONFLICT (id) DO UPDATE SET name = 'Primi', slug = 'primi';

-- ── Regions ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS regions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  code            text NOT NULL,
  area_manager_id uuid,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, code)
);

CREATE INDEX IF NOT EXISTS idx_regions_org ON regions (organisation_id);

ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='regions' AND policyname='srole_regions') THEN
    CREATE POLICY srole_regions ON regions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO regions (id, organisation_id, name, code)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'Western Cape',
  'WC'
) ON CONFLICT DO NOTHING;

-- ── Extend sites ──────────────────────────────────────────────────────────────

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations(id),
  ADD COLUMN IF NOT EXISTS region_id       uuid REFERENCES regions(id),
  ADD COLUMN IF NOT EXISTS store_code      text,
  ADD COLUMN IF NOT EXISTS gm_user_id      uuid,
  ADD COLUMN IF NOT EXISTS target_labour_pct numeric(5,2) DEFAULT 30.0,
  ADD COLUMN IF NOT EXISTS target_margin_pct numeric(5,2) DEFAULT 12.0,
  ADD COLUMN IF NOT EXISTS target_avg_spend  numeric(8,2),
  ADD COLUMN IF NOT EXISTS seating_capacity  integer,
  ADD COLUMN IF NOT EXISTS settings          jsonb NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sites_org    ON sites (organisation_id);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites (region_id);

-- Seed sites as Primi stores
UPDATE sites SET
  name = 'Primi Camps Bay',
  address = 'Victoria Road, Camps Bay',
  city = 'Cape Town',
  store_code = 'PRIMI-CB',
  organisation_id = '00000000-0000-0000-0000-000000000001',
  region_id = '00000000-0000-0000-0000-000000000010'
WHERE id = '00000000-0000-0000-0000-000000000001';

INSERT INTO sites (id, name, site_type, address, city, timezone, organisation_id, region_id, store_code)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Primi Constantia',
  'restaurant',
  'Constantia Village',
  'Cape Town',
  'Africa/Johannesburg',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  'PRIMI-CN'
) ON CONFLICT (id) DO UPDATE SET
  name = 'Primi Constantia',
  address = 'Constantia Village',
  store_code = 'PRIMI-CN',
  organisation_id = '00000000-0000-0000-0000-000000000001',
  region_id = '00000000-0000-0000-0000-000000000010';

-- ── Profiles ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY,
  email        text UNIQUE NOT NULL,
  full_name    text,
  avatar_url   text,
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','invited','deactivated')),
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY srole_profiles ON profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY users_read_own_profile ON profiles FOR SELECT TO authenticated USING (id = auth.uid());

INSERT INTO profiles (id, email, full_name, status)
VALUES (
  '5fa15569-8415-4118-9d83-1fd7d8408963',
  'newburf@gmail.com',
  'Thami',
  'active'
) ON CONFLICT (id) DO NOTHING;

-- ── Extend user_roles constraint for new roles ───────────────────────────────

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS check_role;
ALTER TABLE user_roles ADD CONSTRAINT check_role CHECK (role IN (
  'super_admin','executive','head_office','area_manager','gm','supervisor','contractor','auditor','viewer'
));

-- Upgrade current user to super_admin
UPDATE user_roles SET role = 'super_admin',
  organisation_id = '00000000-0000-0000-0000-000000000001'
WHERE user_id = '5fa15569-8415-4118-9d83-1fd7d8408963';

-- ── User Site Access ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_site_access (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_usa_user ON user_site_access (user_id);
CREATE INDEX IF NOT EXISTS idx_usa_site ON user_site_access (site_id);

ALTER TABLE user_site_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY srole_usa ON user_site_access FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY users_read_own_usa ON user_site_access FOR SELECT TO authenticated USING (user_id = auth.uid());

INSERT INTO user_site_access (user_id, site_id) VALUES
  ('5fa15569-8415-4118-9d83-1fd7d8408963', '00000000-0000-0000-0000-000000000001'),
  ('5fa15569-8415-4118-9d83-1fd7d8408963', '00000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

-- ── Access Audit Log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id   uuid,
  target_user_id  uuid,
  action          text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_actor   ON access_audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_aal_target  ON access_audit_log (target_user_id);
CREATE INDEX IF NOT EXISTS idx_aal_created ON access_audit_log (created_at DESC);

ALTER TABLE access_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY srole_aal ON access_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── user_accessible_sites RPC ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION user_accessible_sites(p_user_id uuid)
RETURNS TABLE (site_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  -- super_admin / executive / auditor / head_office → all sites in their org
  SELECT s.id
  FROM   sites s
  JOIN   organisations o ON o.id = s.organisation_id
  WHERE  s.is_active = true
    AND  EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE  ur.user_id         = p_user_id
        AND  ur.organisation_id = o.id
        AND  ur.role           IN ('super_admin','executive','auditor','head_office')
        AND  ur.is_active      = true
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
  WHERE  ur.user_id   = p_user_id
    AND  ur.role      IN ('gm','supervisor','contractor','viewer')
    AND  ur.is_active = true
    AND  ur.site_id   IS NOT NULL
  UNION
  -- Also include explicit site access grants
  SELECT usa.site_id
  FROM   user_site_access usa
  WHERE  usa.user_id = p_user_id;
$$;
