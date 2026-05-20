-- ═══════════════════════════════════════════════════════════════════════════════
-- 035 — GM Co-Pilot v2: Service-Led Action Engine
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── action_events — full audit trail for every action lifecycle event ─────────

CREATE TABLE IF NOT EXISTS action_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id   uuid NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('created','assigned','started','completed','reopened','escalated','dismissed','impact_measured')),
  actor       text,
  notes       text,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_action_events_action_id ON action_events(action_id);
CREATE INDEX idx_action_events_type      ON action_events(event_type);
CREATE INDEX idx_action_events_created   ON action_events(created_at DESC);

-- ── Add columns to actions if not present ────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS direct_instruction text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS consequence_if_ignored text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS expected_impact_value numeric;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS owner text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS severity text CHECK (severity IN ('critical','high','medium','low'));
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS service_window text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS impact_before jsonb;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS impact_after jsonb;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS impact_summary text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS escalated_to text;
  ALTER TABLE actions ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
END $$;

-- ── service_signals — periodic service quality snapshots ─────────────────────

CREATE TABLE IF NOT EXISTS service_signals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  service_window          text NOT NULL,
  captured_at             timestamptz NOT NULL DEFAULT now(),
  floor_energy_score      numeric,       -- 0-100
  table_turn_rate         numeric,       -- turns per hour
  upsell_rate             numeric,       -- 0-1 ratio
  avg_spend               numeric,
  walk_in_conversion_rate numeric,       -- 0-1 ratio
  booking_conversion_rate numeric,       -- 0-1 ratio
  guest_engagement_score  numeric,       -- 0-100
  table_touch_frequency   numeric,       -- touches per table per hour
  service_speed_risk      text CHECK (service_speed_risk IN ('none','low','medium','high','critical')),
  covers_this_window      integer,
  notes                   text,
  source                  text DEFAULT 'system'
);

CREATE INDEX idx_service_signals_store   ON service_signals(store_id, captured_at DESC);
CREATE INDEX idx_service_signals_window  ON service_signals(service_window, captured_at DESC);

-- ── operating_score_cache — daily score snapshots for trending ───────────────

CREATE TABLE IF NOT EXISTS operating_score_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  score_date  date NOT NULL,
  total_score integer NOT NULL,
  grade       text NOT NULL,
  breakdown   jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, score_date)
);

CREATE INDEX idx_os_cache_store_date ON operating_score_cache(store_id, score_date DESC);

-- ── daily_operating_state — snapshot of full store state once per day ─────────

CREATE TABLE IF NOT EXISTS daily_operating_state (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  state_date     date NOT NULL,
  state_snapshot jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(store_id, state_date)
);

CREATE INDEX idx_daily_state_store_date ON daily_operating_state(store_id, state_date DESC);

-- ── booking_snapshots — periodic intraday booking state capture ──────────────

CREATE TABLE IF NOT EXISTS booking_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  snapshot_at       timestamptz NOT NULL DEFAULT now(),
  total_bookings    integer NOT NULL DEFAULT 0,
  total_covers      integer NOT NULL DEFAULT 0,
  confirmed         integer NOT NULL DEFAULT 0,
  pending           integer NOT NULL DEFAULT 0,
  cancelled         integer NOT NULL DEFAULT 0,
  large_bookings    integer NOT NULL DEFAULT 0,
  service_window    text
);

CREATE INDEX idx_booking_snap_store ON booking_snapshots(store_id, snapshot_at DESC);

-- ── RLS policies ─────────────────────────────────────────────────────────────

ALTER TABLE action_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_signals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_score_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_operating_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_snapshots    ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write
DO $$ BEGIN
  CREATE POLICY "action_events_auth" ON action_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_signals_auth" ON service_signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "os_cache_auth" ON operating_score_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "daily_state_auth" ON daily_operating_state FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "booking_snap_auth" ON booking_snapshots FOR ALL TO authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow service_role full access
DO $$ BEGIN
  CREATE POLICY "action_events_service" ON action_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_signals_service" ON service_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "os_cache_service" ON operating_score_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "daily_state_service" ON daily_operating_state FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "booking_snap_service" ON booking_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
