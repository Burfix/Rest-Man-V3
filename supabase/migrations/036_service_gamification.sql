-- ============================================================
-- 036: Service Gamification + Shift Performance
-- ============================================================

-- ── service_scores ─────────────────────────────────────────────

create table if not exists service_scores (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  org_id        uuid not null default '00000000-0000-0000-0000-000000000000',
  service_window text not null,
  score         integer not null check (score >= 0 and score <= 100),
  grade         text not null,
  breakdown     jsonb not null default '{}',
  biggest_driver_up   text,
  biggest_driver_down text,
  movement_vs_yesterday   numeric,
  movement_vs_last_shift  numeric,
  created_at    timestamptz not null default now()
);

create index if not exists idx_service_scores_store_window
  on service_scores (store_id, service_window, created_at desc);

create index if not exists idx_service_scores_org
  on service_scores (org_id, created_at desc);

-- ── shift_performance_snapshots ────────────────────────────────

create table if not exists shift_performance_snapshots (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  org_id        uuid not null default '00000000-0000-0000-0000-000000000000',
  shift_date    date not null default current_date,
  shift_type    text not null check (shift_type in ('lunch', 'dinner', 'full_day')),
  service_score integer not null check (service_score >= 0 and service_score <= 100),
  revenue_actual  numeric not null default 0,
  revenue_target  numeric not null default 0,
  covers_actual   integer not null default 0,
  covers_forecast integer not null default 0,
  avg_spend       numeric not null default 0,
  labour_percent  numeric not null default 0,
  actions_completed integer not null default 0,
  actions_total     integer not null default 0,
  revenue_recovered numeric not null default 0,
  carry_forward_actions integer not null default 0,
  is_recovery_shift boolean not null default false,
  score_breakdown   jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists idx_shift_perf_store_date
  on shift_performance_snapshots (store_id, shift_date desc);

create index if not exists idx_shift_perf_org_date
  on shift_performance_snapshots (org_id, shift_date desc);

-- ── service_streaks ────────────────────────────────────────────

create table if not exists service_streaks (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null default '00000000-0000-0000-0000-000000000000',
  org_id        uuid not null default '00000000-0000-0000-0000-000000000000',
  streak_type   text not null check (streak_type in ('above_80', 'no_critical_risk', 'recovery')),
  streak_count  integer not null default 0,
  started_at    timestamptz not null default now(),
  last_updated  timestamptz not null default now(),
  is_active     boolean not null default true
);

create index if not exists idx_service_streaks_store
  on service_streaks (store_id, streak_type, is_active);

create index if not exists idx_service_streaks_org
  on service_streaks (org_id, streak_type, is_active);

-- ── RLS ────────────────────────────────────────────────────────

alter table service_scores enable row level security;
alter table shift_performance_snapshots enable row level security;
alter table service_streaks enable row level security;

create policy "service_scores_auth" on service_scores
  for all using (auth.role() = 'authenticated');
create policy "service_scores_service" on service_scores
  for all using (auth.role() = 'service_role');

create policy "shift_perf_auth" on shift_performance_snapshots
  for all using (auth.role() = 'authenticated');
create policy "shift_perf_service" on shift_performance_snapshots
  for all using (auth.role() = 'service_role');

create policy "service_streaks_auth" on service_streaks
  for all using (auth.role() = 'authenticated');
create policy "service_streaks_service" on service_streaks
  for all using (auth.role() = 'service_role');
