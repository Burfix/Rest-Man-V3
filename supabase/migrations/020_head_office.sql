-- ============================================================
-- Head Office Control Tower
-- Migration: 020_head_office.sql
--
-- Adds:
--   store_snapshots — daily per-store metrics cache
--                     allows group-level aggregation across
--                     multiple outlets without cross-table joins
--
-- Seeds:
--   sites           — 2 additional demo stores
--   store_snapshots — 7 days × 3 stores (2026-03-13 → 2026-03-19)
-- ============================================================

-- ── Additional demo stores ────────────────────────────────────────────────────

INSERT INTO sites (id, name, site_type, address, city, timezone)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Si Cantina Gardens',
  'restaurant',
  'Company Gardens Precinct',
  'Cape Town',
  'Africa/Johannesburg'
),(
  '00000000-0000-0000-0000-000000000003',
  'Si Cantina Stellenbosch',
  'restaurant',
  'Church Street, Stellenbosch',
  'Stellenbosch',
  'Africa/Johannesburg'
)
ON CONFLICT (id) DO NOTHING;

-- ── store_snapshots ───────────────────────────────────────────────────────────
-- One row per site per calendar day.
-- Populated by each store's daily ops reset; can also be written by a cron job
-- that calls getOperatingScore() per site and upserts the result here.

CREATE TABLE IF NOT EXISTS store_snapshots (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid         NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  snapshot_date     date         NOT NULL,

  -- Operating score
  operating_score   integer      CHECK (operating_score BETWEEN 0 AND 100),
  score_grade       text         CHECK (score_grade IN ('A','B','C','D','F')),

  -- Revenue
  sales_net_vat     numeric(14,2),
  revenue_target    numeric(14,2),
  revenue_gap_pct   numeric(8,2),    -- positive = below target

  -- Labour
  labour_pct        numeric(8,2),

  -- Component scores (mirrors OperatingScore components)
  compliance_score  integer,          -- 0, 10, or 20
  maintenance_score integer,          -- 0, 10, or 20

  -- Risk level (green ≥ 70 | yellow 45–69 | red < 45)
  risk_level        text         NOT NULL DEFAULT 'yellow'
                     CHECK (risk_level IN ('green','yellow','red')),

  -- Actions snapshot (point-in-time for this day)
  actions_total     integer      NOT NULL DEFAULT 0,
  actions_completed integer      NOT NULL DEFAULT 0,
  actions_overdue   integer      NOT NULL DEFAULT 0,

  created_at        timestamptz  NOT NULL DEFAULT now(),

  UNIQUE (site_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_store_snapshots_site_date
  ON store_snapshots (site_id, snapshot_date DESC);

ALTER TABLE store_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON store_snapshots
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Seed: 7 days × 3 stores ───────────────────────────────────────────────────
-- Score formula (for reference):
--   Revenue (40 pts): gap≤0%=40, ≤5%=30, ≤10%=20, ≤20%=10, >20%=0
--   Labour  (20 pts): ≤30%=20, ≤35%=15, >35%=5
--   Compliance (20): all clear=20, due_soon=10, expired=0
--   Maintenance (20): none=20, minor=10, critical=0

-- ── Store 001: Si Cantina Sociale (Cape Town V&A — strong performer) ──────────
INSERT INTO store_snapshots
  (site_id, snapshot_date, operating_score, score_grade,
   sales_net_vat, revenue_target, revenue_gap_pct, labour_pct,
   compliance_score, maintenance_score, risk_level,
   actions_total, actions_completed, actions_overdue)
VALUES
  ('00000000-0000-0000-0000-000000000001','2026-03-13', 75,'B', 38500,40000,  3.8,31.2, 20,10,'green',  8,6,1),
  ('00000000-0000-0000-0000-000000000001','2026-03-14', 90,'A', 42000,40000, -5.0,29.8, 20,10,'green',  7,6,0),
  ('00000000-0000-0000-0000-000000000001','2026-03-15', 65,'C', 37000,40000,  7.5,33.5, 20,10,'yellow', 9,6,1),
  ('00000000-0000-0000-0000-000000000001','2026-03-16',100,'A', 45000,40000,-12.5,28.1, 20,20,'green',  6,6,0),
  ('00000000-0000-0000-0000-000000000001','2026-03-17', 55,'C', 35000,40000, 12.5,34.0, 10,10,'yellow',10,5,2),
  ('00000000-0000-0000-0000-000000000001','2026-03-18', 95,'A', 44500,40000,-11.3,30.5, 20,20,'green',  7,7,0),
  ('00000000-0000-0000-0000-000000000001','2026-03-19', 75,'B', 39000,40000,  2.5,32.1, 20,10,'green',  8,5,1)
ON CONFLICT (site_id, snapshot_date) DO NOTHING;

-- ── Store 002: Si Cantina Gardens (Cape Town — inconsistent performer) ────────
INSERT INTO store_snapshots
  (site_id, snapshot_date, operating_score, score_grade,
   sales_net_vat, revenue_target, revenue_gap_pct, labour_pct,
   compliance_score, maintenance_score, risk_level,
   actions_total, actions_completed, actions_overdue)
VALUES
  ('00000000-0000-0000-0000-000000000002','2026-03-13', 65,'C', 28000,30000,  6.7,32.1, 20,10,'yellow', 7,5,1),
  ('00000000-0000-0000-0000-000000000002','2026-03-14', 45,'D', 25500,30000, 15.0,34.5, 10,10,'yellow', 8,4,2),
  ('00000000-0000-0000-0000-000000000002','2026-03-15', 95,'A', 30200,30000, -0.7,30.8, 20,20,'green',  6,6,0),
  ('00000000-0000-0000-0000-000000000002','2026-03-16', 65,'C', 27800,30000,  7.3,33.2, 20,10,'yellow', 9,6,1),
  ('00000000-0000-0000-0000-000000000002','2026-03-17', 75,'B', 29100,30000,  3.0,31.5, 20,10,'green',  7,5,0),
  ('00000000-0000-0000-0000-000000000002','2026-03-18',100,'A', 31500,30000, -5.0,29.9, 20,20,'green',  6,6,0),
  ('00000000-0000-0000-0000-000000000002','2026-03-19', 45,'D', 26800,30000, 10.7,34.8, 10,10,'yellow', 6,3,2)
ON CONFLICT (site_id, snapshot_date) DO NOTHING;

-- ── Store 003: Si Cantina Stellenbosch (At Risk — high labour, revenue gap) ───
INSERT INTO store_snapshots
  (site_id, snapshot_date, operating_score, score_grade,
   sales_net_vat, revenue_target, revenue_gap_pct, labour_pct,
   compliance_score, maintenance_score, risk_level,
   actions_total, actions_completed, actions_overdue)
VALUES
  ('00000000-0000-0000-0000-000000000003','2026-03-13', 45,'D', 20500,22000,  6.8,37.5, 10,10,'yellow',10,5,2),
  ('00000000-0000-0000-0000-000000000003','2026-03-14', 15,'F', 18000,22000, 18.2,41.2,  0, 0,'red',   12,2,5),
  ('00000000-0000-0000-0000-000000000003','2026-03-15', 45,'D', 21500,22000,  2.3,37.8, 10, 0,'yellow', 9,4,2),
  ('00000000-0000-0000-0000-000000000003','2026-03-16',  5,'F', 16000,22000, 27.3,44.1,  0, 0,'red',   14,1,6),
  ('00000000-0000-0000-0000-000000000003','2026-03-17', 65,'C', 22500,22000, -2.3,36.2, 10,10,'yellow', 8,5,2),
  ('00000000-0000-0000-0000-000000000003','2026-03-18', 25,'F', 19500,22000, 11.4,39.8, 10, 0,'red',   11,3,4),
  ('00000000-0000-0000-0000-000000000003','2026-03-19', 15,'F', 17500,22000, 20.5,42.5,  0,10,'red',   11,2,4)
ON CONFLICT (site_id, snapshot_date) DO NOTHING;
