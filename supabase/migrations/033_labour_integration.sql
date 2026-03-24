-- 033_labour_integration.sql
-- Oracle MICROS BI labour cost integration tables.

-- ── 1. Job codes dimension table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_job_codes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loc_ref      text NOT NULL,
  num          text NOT NULL,
  name         text NOT NULL DEFAULT '',
  mstr_num     text NOT NULL DEFAULT '',
  mstr_name    text NOT NULL DEFAULT '',
  lbr_cat_num  text NOT NULL DEFAULT '',
  lbr_cat_name text NOT NULL DEFAULT '',
  lbr_cat_mstr_num  text NOT NULL DEFAULT '',
  lbr_cat_mstr_name text NOT NULL DEFAULT '',
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loc_ref, num)
);

CREATE INDEX IF NOT EXISTS idx_labour_job_codes_loc ON labour_job_codes (loc_ref);

-- ── 2. Timecards ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_timecards (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tc_id            text NOT NULL,
  business_date    date NOT NULL,
  loc_ref          text NOT NULL,
  emp_num          text NOT NULL DEFAULT '',
  payroll_id       text NOT NULL DEFAULT '',
  ext_payroll_id   text NOT NULL DEFAULT '',
  job_code_ref     text NOT NULL DEFAULT '',
  jc_num           text NOT NULL DEFAULT '',
  rvc_num          text NOT NULL DEFAULT '',
  shft_num         text NOT NULL DEFAULT '',
  clk_in_lcl       timestamptz,
  clk_out_lcl      timestamptz,
  clk_in_utc       timestamptz,
  clk_out_utc      timestamptz,
  reg_hrs          numeric(10,4) NOT NULL DEFAULT 0,
  reg_pay          numeric(12,2) NOT NULL DEFAULT 0,
  ovt1_hrs         numeric(10,4) NOT NULL DEFAULT 0,
  ovt1_pay         numeric(12,2) NOT NULL DEFAULT 0,
  ovt2_hrs         numeric(10,4) NOT NULL DEFAULT 0,
  ovt2_pay         numeric(12,2) NOT NULL DEFAULT 0,
  ovt3_hrs         numeric(10,4) NOT NULL DEFAULT 0,
  ovt3_pay         numeric(12,2) NOT NULL DEFAULT 0,
  ovt4_hrs         numeric(10,4) NOT NULL DEFAULT 0,
  ovt4_pay         numeric(12,2) NOT NULL DEFAULT 0,
  prem_hrs         numeric(10,4) NOT NULL DEFAULT 0,
  prem_pay         numeric(12,2) NOT NULL DEFAULT 0,
  total_hours      numeric(10,4) NOT NULL DEFAULT 0,
  total_pay        numeric(12,2) NOT NULL DEFAULT 0,
  gross_rcpts      numeric(12,2) NOT NULL DEFAULT 0,
  chrg_rcpts       numeric(12,2) NOT NULL DEFAULT 0,
  chrg_tips        numeric(12,2) NOT NULL DEFAULT 0,
  drct_tips        numeric(12,2) NOT NULL DEFAULT 0,
  indir_tips       numeric(12,2) NOT NULL DEFAULT 0,
  svc_tips         numeric(12,2) NOT NULL DEFAULT 0,
  tips_pd          numeric(12,2) NOT NULL DEFAULT 0,
  last_updated_utc timestamptz,
  added_utc        timestamptz,
  has_adjustments  boolean NOT NULL DEFAULT false,
  adjustments_json jsonb,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tc_id)
);

CREATE INDEX IF NOT EXISTS idx_labour_timecards_date ON labour_timecards (business_date);
CREATE INDEX IF NOT EXISTS idx_labour_timecards_loc  ON labour_timecards (loc_ref);
CREATE INDEX IF NOT EXISTS idx_labour_timecards_loc_date ON labour_timecards (loc_ref, business_date);

-- ── 3. Daily summary (aggregated per day) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_daily_summary (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loc_ref               text NOT NULL,
  business_date         date NOT NULL,
  total_hours           numeric(10,2) NOT NULL DEFAULT 0,
  total_pay             numeric(12,2) NOT NULL DEFAULT 0,
  reg_hours             numeric(10,2) NOT NULL DEFAULT 0,
  reg_pay               numeric(12,2) NOT NULL DEFAULT 0,
  ovt_hours             numeric(10,2) NOT NULL DEFAULT 0,
  ovt_pay               numeric(12,2) NOT NULL DEFAULT 0,
  prem_hours            numeric(10,2) NOT NULL DEFAULT 0,
  prem_pay              numeric(12,2) NOT NULL DEFAULT 0,
  active_staff_count    int NOT NULL DEFAULT 0,
  open_timecard_count   int NOT NULL DEFAULT 0,
  net_sales             numeric(12,2),
  labour_pct            numeric(6,2),
  by_role_json          jsonb NOT NULL DEFAULT '[]'::jsonb,
  by_category_json      jsonb NOT NULL DEFAULT '[]'::jsonb,
  by_rvc_json           jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loc_ref, business_date)
);

CREATE INDEX IF NOT EXISTS idx_labour_daily_summary_date ON labour_daily_summary (business_date);

-- ── 4. Sync state (delta cursor tracking) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS labour_sync_state (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  loc_ref       text NOT NULL,
  last_cur_utc  text,
  last_bus_dt   date,
  last_sync_at  timestamptz,
  error_message text,
  UNIQUE (loc_ref)
);
