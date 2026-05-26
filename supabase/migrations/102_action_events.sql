-- ============================================================
-- Migration 102: Action Events — Operational Accountability Loop
-- ============================================================
--
-- Captures GM interventions against operational risk signals.
-- Every "mark as actioned" click on the Command Center writes a row here.
--
-- This table is the foundation of:
--   1. GM accountability scoring
--   2. Intervention effectiveness measurement
--   3. AI training data (future — when enough rows exist)
--
-- Data model:
--   risk_id        — matches RiskSignal.id from the risk vector
--                    e.g. "risk-revenue", "risk-labour"
--   actioned_by    — auth.uid() of the GM who actioned
--   acknowledged_at — when first acknowledged (can precede actioned)
--   resolved_at    — when outcome was confirmed (nullable until resolved)
--   outcome_note   — free text from GM about what happened
--
-- Tenant isolation: RLS enforced by site_id.
-- ============================================================

-- ── Table ────────────────────────────────────────────────────────────────────

create table if not exists public.action_events (
  id               uuid        primary key default gen_random_uuid(),
  site_id          uuid        not null references public.sites(id) on delete cascade,
  risk_id          text        not null,          -- e.g. "risk-revenue", "risk-labour"
  actioned_by      uuid        references auth.users(id) on delete set null,
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  outcome_note     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary query patterns: by site for daily review, by risk_id for effectiveness
create index if not exists action_events_site_id_idx
  on public.action_events (site_id, created_at desc);

create index if not exists action_events_risk_id_idx
  on public.action_events (site_id, risk_id, created_at desc);

create index if not exists action_events_actioned_by_idx
  on public.action_events (actioned_by, created_at desc);

-- ── Auto-update updated_at ─────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger action_events_set_updated_at
  before update on public.action_events
  for each row execute procedure public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table public.action_events enable row level security;

-- GMs can see and insert action events for their own site
create policy "action_events_site_select"
  on public.action_events
  for select
  using (
    site_id in (
      select site_id from public.user_roles
      where user_id = auth.uid() and is_active = true
    )
    or exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and is_active = true
        and role in ('super_admin', 'head_office')
    )
  );

create policy "action_events_site_insert"
  on public.action_events
  for insert
  with check (
    site_id in (
      select site_id from public.user_roles
      where user_id = auth.uid() and is_active = true
    )
  );

-- GMs can update (add outcome_note / resolved_at) their own actions
create policy "action_events_own_update"
  on public.action_events
  for update
  using (actioned_by = auth.uid())
  with check (actioned_by = auth.uid());

-- ── Comments ──────────────────────────────────────────────────────────────────

comment on table  public.action_events is
  'Operational interventions — GM responses to governed risk signals';
comment on column public.action_events.risk_id is
  'Matches RiskSignal.id from OperationalRiskVector (e.g. "risk-revenue")';
comment on column public.action_events.acknowledged_at is
  'When the risk was first acknowledged — may precede actioned/resolved';
comment on column public.action_events.resolved_at is
  'When the outcome was confirmed. NULL = actioned but outcome unknown';
comment on column public.action_events.outcome_note is
  'GM free-text describing what they did and the result';
