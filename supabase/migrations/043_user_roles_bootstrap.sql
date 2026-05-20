-- Migration: Create user_roles table + assign GM role to newburf@gmail.com
-- Run this in Supabase Dashboard SQL Editor:
-- https://supabase.com/dashboard/project/bdzcydhrdjprdzywjbeu/sql/new

CREATE TABLE IF NOT EXISTS user_roles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  organisation_id  uuid,
  region_id        uuid,
  site_id          uuid REFERENCES sites(id) ON DELETE SET NULL,
  role             text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  granted_by       uuid,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  CONSTRAINT check_role CHECK (role IN (
    'super_admin','executive','area_manager','gm','supervisor','contractor','auditor'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique
  ON user_roles (user_id, COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'), role)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_user_roles_user   ON user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_site   ON user_roles (site_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='srole_full_user_roles') THEN
    CREATE POLICY srole_full_user_roles ON user_roles FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='users_read_own_roles') THEN
    CREATE POLICY users_read_own_roles ON user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
  END IF;
END $$;

-- Assign GM role for newburf@gmail.com to the default site
INSERT INTO user_roles (user_id, site_id, role)
VALUES (
  '5fa15569-8415-4118-9d83-1fd7d8408963',
  '00000000-0000-0000-0000-000000000001',
  'gm'
)
ON CONFLICT DO NOTHING;
