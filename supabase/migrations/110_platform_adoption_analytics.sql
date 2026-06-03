-- ============================================================
-- Migration 110: Platform Adoption & Usage Analytics
-- ============================================================
--
-- PURPOSE:
--   Tracks every meaningful user interaction on the ForgeStack platform
--   to power the Platform Adoption Analytics module in the Command Centre.
--   Accessible only to super_admin users.
--
-- TABLES:
--   1. platform_usage_events  — append-only event log (login, page_view, etc.)
--   2. user_sessions          — session lifecycle tracking (start/end/duration)
--
-- VIEWS:
--   1. v_user_adoption_summary — per-user engagement rollup (7/14/30 day windows)
--   2. v_feature_adoption      — per-feature adoption % across active users
--
-- DESIGN RULES:
--   - append-only: no UPDATE or DELETE allowed (enforced by policy)
--   - user_id scoped (not site_id) — platform-level, not store-level
--   - org_id kept for multi-tenant isolation
--   - service_role required for writes (server-side only)
--   - super_admin can read; no other role reads this directly
-- ============================================================

-- ── Idempotent teardown ──────────────────────────────────────────────────────

drop view  if exists public.v_feature_adoption      cascade;
drop view  if exists public.v_user_adoption_summary cascade;
drop table if exists public.user_sessions           cascade;
drop table if exists public.platform_usage_events   cascade;
drop type  if exists public.usage_event_type        cascade;

-- ── Event type enum ──────────────────────────────────────────────────────────

create type public.usage_event_type as enum (
  'login',           -- user authenticated / session started
  'page_view',       -- user navigated to a page
  'feature_use',     -- user performed an action within a named feature
  'sync_use',        -- user manually triggered a data sync
  'session_end'      -- session closed (carries duration_seconds)
);

-- ── platform_usage_events ────────────────────────────────────────────────────

create table public.platform_usage_events (
  id               uuid                      primary key default gen_random_uuid(),
  event_type       public.usage_event_type   not null,

  -- Actor
  user_id          uuid                      not null references auth.users(id) on delete cascade,
  org_id           uuid                      references public.organisations(id) on delete set null,
  site_id          uuid                      references public.sites(id) on delete set null,

  -- Content
  feature_name     text,                     -- e.g. 'actions', 'labour', 'compliance'
  page_path        text,                     -- e.g. '/dashboard/labour'
  duration_seconds integer,                  -- set on session_end events

  -- Context
  metadata         jsonb     not null default '{}',
  user_agent       text,
  ip_hash          text,                     -- SHA-256 of IP, never raw IP

  occurred_at      timestamptz not null default now()
);

-- Prevent UPDATE/DELETE — this is an immutable audit log
create or replace rule "platform_usage_events_no_update"
  as on update to public.platform_usage_events do instead nothing;

create or replace rule "platform_usage_events_no_delete"
  as on delete to public.platform_usage_events do instead nothing;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary: per-user events over time
create index pue_user_time_idx
  on public.platform_usage_events (user_id, occurred_at desc);

-- Per-org for org-level rollups
create index pue_org_time_idx
  on public.platform_usage_events (org_id, occurred_at desc)
  where org_id is not null;

-- Feature adoption queries
create index pue_feature_time_idx
  on public.platform_usage_events (feature_name, occurred_at desc)
  where feature_name is not null;

-- Event type queries (login tracking)
create index pue_event_type_idx
  on public.platform_usage_events (event_type, occurred_at desc);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.platform_usage_events enable row level security;

-- Only service_role can write (server-side only)
create policy "pue_service_role_all"
  on public.platform_usage_events
  for all
  to service_role
  using (true)
  with check (true);

-- ── user_sessions ─────────────────────────────────────────────────────────────

create table public.user_sessions (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  org_id           uuid        references public.organisations(id) on delete set null,
  site_id          uuid        references public.sites(id) on delete set null,

  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer     generated always as (
    extract(epoch from (ended_at - started_at))::integer
  ) stored,

  page_count       integer     not null default 0,
  event_count      integer     not null default 0
);

create index us_user_time_idx
  on public.user_sessions (user_id, started_at desc);

create index us_org_time_idx
  on public.user_sessions (org_id, started_at desc)
  where org_id is not null;

alter table public.user_sessions enable row level security;

create policy "us_service_role_all"
  on public.user_sessions
  for all
  to service_role
  using (true)
  with check (true);

-- ── View: v_user_adoption_summary ─────────────────────────────────────────────
-- Per-user engagement metrics across three time windows.
-- Queried by the scoring engine to compute scores.

create or replace view public.v_user_adoption_summary as
with
  -- Distinct login days per user in last 30d
  login_days as (
    select
      user_id,
      count(distinct occurred_at::date)::int    as login_days_30d,
      count(distinct case when occurred_at >= now() - interval '14 days'
                     then occurred_at::date end)::int as login_days_14d,
      count(distinct case when occurred_at >= now() - interval '7 days'
                     then occurred_at::date end)::int as login_days_7d,
      max(occurred_at)                           as last_login_at
    from public.platform_usage_events
    where event_type = 'login'
      and occurred_at >= now() - interval '30 days'
    group by user_id
  ),

  -- Feature breadth per user in last 14d
  features as (
    select
      user_id,
      count(distinct feature_name)::int as unique_features_14d,
      count(distinct feature_name)::int as unique_features_30d
    from public.platform_usage_events
    where event_type in ('feature_use', 'page_view')
      and feature_name is not null
      and occurred_at >= now() - interval '14 days'
    group by user_id
  ),

  -- Session stats per user in last 14d
  sessions as (
    select
      user_id,
      count(*)::int                                          as session_count_14d,
      avg(duration_seconds) filter (where duration_seconds > 0) as avg_session_seconds
    from public.user_sessions
    where started_at >= now() - interval '14 days'
    group by user_id
  ),

  -- Page views per user in last 14d
  pages as (
    select
      user_id,
      count(*)::int as page_views_14d,
      count(distinct page_path)::int as unique_pages_14d
    from public.platform_usage_events
    where event_type = 'page_view'
      and occurred_at >= now() - interval '14 days'
    group by user_id
  ),

  -- Sync uses per user in last 14d
  syncs as (
    select
      user_id,
      count(*)::int as sync_uses_14d
    from public.platform_usage_events
    where event_type = 'sync_use'
      and occurred_at >= now() - interval '14 days'
    group by user_id
  ),

  -- All users who ever logged in (our user universe for adoption analytics)
  all_users as (
    select distinct user_id, org_id
    from public.platform_usage_events
    where occurred_at >= now() - interval '90 days'
  )

select
  u.user_id,
  u.org_id,
  coalesce(ld.login_days_30d,    0)    as login_days_30d,
  coalesce(ld.login_days_14d,    0)    as login_days_14d,
  coalesce(ld.login_days_7d,     0)    as login_days_7d,
  ld.last_login_at,
  now() - ld.last_login_at             as time_since_login,
  coalesce(f.unique_features_14d, 0)   as unique_features_14d,
  coalesce(s.session_count_14d,   0)   as session_count_14d,
  coalesce(s.avg_session_seconds, 0)   as avg_session_seconds,
  coalesce(p.page_views_14d,      0)   as page_views_14d,
  coalesce(p.unique_pages_14d,    0)   as unique_pages_14d,
  coalesce(sy.sync_uses_14d,      0)   as sync_uses_14d
from all_users u
left join login_days ld on ld.user_id = u.user_id
left join features   f  on f.user_id  = u.user_id
left join sessions   s  on s.user_id  = u.user_id
left join pages      p  on p.user_id  = u.user_id
left join syncs      sy on sy.user_id = u.user_id;

-- ── View: v_feature_adoption ─────────────────────────────────────────────────
-- For each tracked feature, show how many users used it in the last 30 days.

create or replace view public.v_feature_adoption as
with
  -- Total distinct users active in last 30 days (our denominator)
  active_users as (
    select count(distinct user_id)::int as total
    from public.platform_usage_events
    where event_type = 'login'
      and occurred_at >= now() - interval '30 days'
  ),

  -- Users per feature in last 30 days
  feature_users as (
    select
      feature_name,
      count(distinct user_id)::int as users_count,
      count(*)::int                as total_events
    from public.platform_usage_events
    where feature_name is not null
      and occurred_at >= now() - interval '30 days'
      and event_type in ('page_view', 'feature_use')
    group by feature_name
  )

select
  fu.feature_name,
  fu.users_count,
  fu.total_events,
  au.total as total_active_users,
  case
    when au.total = 0 then 0
    else round((fu.users_count::numeric / au.total) * 100, 1)
  end as adoption_pct
from feature_users fu
cross join active_users au
order by adoption_pct desc;

-- ── Comments ─────────────────────────────────────────────────────────────────

comment on table public.platform_usage_events is
  'Immutable append-only log of all user interactions on the ForgeStack platform. '
  'Powers the Platform Adoption Analytics module (super_admin only). '
  'Contains no raw PII — IP is SHA-256 hashed.';

comment on table public.user_sessions is
  'Session lifecycle tracking. Rows are opened on login and closed when the '
  'session ends (tab close, logout, inactivity timeout). duration_seconds is '
  'a generated column; page_count and event_count are incremented server-side.';

comment on view public.v_user_adoption_summary is
  'Per-user engagement metrics across 7/14/30-day windows. '
  'Used by the scoring engine in lib/adoption/scores.ts.';

comment on view public.v_feature_adoption is
  'Feature-level adoption rates across active users. '
  'Denominator is distinct users who logged in within the last 30 days.';
