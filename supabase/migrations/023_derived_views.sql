-- ============================================================
-- Migration 023: Derived Views & Materialized Aggregates
--
-- These views answer the most common dashboard queries
-- deterministically and fast. They read exclusively from
-- canonical tables — never raw ingestion.
--
-- NOTE: In Supabase/PostgreSQL we use regular VIEWs (not
-- MATERIALIZED) so they stay real-time. Where performance
-- requires caching, the application layer upserts into
-- store_snapshots (migration 020) after each source sync.
-- ============================================================

-- ── store_operating_score_today ───────────────────────────────────────────────
-- Latest state for every store: today's revenue, labour, compliance,
-- maintenance, operating score, and risk level.

CREATE OR REPLACE VIEW store_operating_score_today AS
WITH
  today_rev AS (
    SELECT
      site_id,
      COALESCE(SUM(net_vat_excl), SUM(net_sales)) AS sales_net_vat,
      COALESCE(SUM(covers), 0)                    AS covers
    FROM   revenue_records
    WHERE  service_date = CURRENT_DATE
    GROUP  BY site_id
  ),
  today_labour AS (
    SELECT
      site_id,
      SUM(labour_cost) AS total_labour_cost
    FROM   labour_records
    WHERE  service_date = CURRENT_DATE
    GROUP  BY site_id
  ),
  overdue_compliance AS (
    SELECT
      site_id,
      COUNT(*) FILTER (WHERE status = 'overdue')    AS overdue_count,
      COUNT(*) FILTER (WHERE status = 'due_soon')   AS due_soon_count
    FROM   compliance_items
    WHERE  is_active = true
    GROUP  BY site_id
  ),
  open_maintenance AS (
    SELECT
      site_id,
      COUNT(*) FILTER (WHERE priority IN ('high','critical'))   AS critical_open,
      COUNT(*) FILTER (WHERE recurrence_count > 1)              AS repeat_failures
    FROM   maintenance_tickets
    WHERE  status NOT IN ('resolved','closed')
    GROUP  BY site_id
  ),
  latest_snapshot AS (
    SELECT DISTINCT ON (site_id)
      site_id,
      operating_score,
      score_grade,
      revenue_target,
      risk_level
    FROM   store_snapshots
    ORDER  BY site_id, snapshot_date DESC
  )
SELECT
  s.id                                                     AS site_id,
  s.name                                                   AS store_name,
  s.city,
  s.store_code,
  s.organisation_id,
  s.region_id,
  COALESCE(r.sales_net_vat, 0)                             AS sales_net_vat,
  COALESCE(ls.revenue_target, 0)                           AS revenue_target,
  CASE
    WHEN ls.revenue_target > 0
    THEN ROUND(((COALESCE(r.sales_net_vat, 0) - ls.revenue_target) / ls.revenue_target * 100)::numeric, 2)
    ELSE NULL
  END                                                       AS revenue_gap_pct,
  COALESCE(l.total_labour_cost, 0)                          AS labour_cost,
  CASE
    WHEN COALESCE(r.sales_net_vat, 0) > 0
    THEN ROUND((l.total_labour_cost / r.sales_net_vat * 100)::numeric, 2)
    ELSE NULL
  END                                                       AS labour_pct,
  COALESCE(oc.overdue_count, 0)                             AS compliance_overdue,
  COALESCE(oc.due_soon_count, 0)                            AS compliance_due_soon,
  COALESCE(om.critical_open, 0)                             AS maintenance_critical,
  COALESCE(om.repeat_failures, 0)                           AS maintenance_repeat,
  COALESCE(r.covers, 0)                                     AS covers,
  COALESCE(ls.operating_score, 0)                           AS operating_score,
  COALESCE(ls.score_grade, 'F')                             AS score_grade,
  COALESCE(ls.risk_level, 'red')                            AS risk_level,
  CURRENT_DATE                                              AS as_of_date
FROM        sites              s
LEFT JOIN   today_rev          r   ON r.site_id = s.id
LEFT JOIN   today_labour       l   ON l.site_id = s.id
LEFT JOIN   overdue_compliance oc  ON oc.site_id = s.id
LEFT JOIN   open_maintenance   om  ON om.site_id = s.id
LEFT JOIN   latest_snapshot    ls  ON ls.site_id = s.id
WHERE       s.is_active = true;

-- ── group_operating_summary ───────────────────────────────────────────────────
-- One row per organisation — rolls up all store scores.

CREATE OR REPLACE VIEW group_operating_summary AS
SELECT
  s.organisation_id,
  o.name                                                    AS org_name,
  COUNT(DISTINCT s.id)                                      AS store_count,
  ROUND(AVG(v.operating_score)::numeric, 2)                 AS avg_operating_score,
  SUM(v.sales_net_vat)                                      AS total_revenue,
  SUM(v.revenue_target)                                     AS total_target,
  CASE
    WHEN SUM(v.revenue_target) > 0
    THEN ROUND(((SUM(v.sales_net_vat) - SUM(v.revenue_target)) / SUM(v.revenue_target) * 100)::numeric, 2)
    ELSE NULL
  END                                                       AS group_revenue_gap_pct,
  ROUND(AVG(v.labour_pct)::numeric, 2)                      AS avg_labour_pct,
  SUM(v.compliance_overdue)                                 AS total_compliance_overdue,
  SUM(v.maintenance_critical)                               AS total_maintenance_critical,
  SUM(v.maintenance_repeat)                                 AS total_repeat_failures,
  COUNT(*) FILTER (WHERE v.risk_level = 'red')              AS red_stores,
  COUNT(*) FILTER (WHERE v.risk_level = 'yellow')           AS yellow_stores,
  COUNT(*) FILTER (WHERE v.risk_level = 'green')            AS green_stores,
  CURRENT_DATE                                              AS as_of_date
FROM       store_operating_score_today v
JOIN       sites                       s ON s.id = v.site_id
JOIN       organisations               o ON o.id = s.organisation_id
GROUP BY   s.organisation_id, o.name;

-- ── overdue_compliance_items ──────────────────────────────────────────────────

CREATE OR REPLACE VIEW overdue_compliance_items AS
SELECT
  ci.id,
  ci.site_id,
  s.name          AS store_name,
  ci.title,
  ci.category,
  ci.next_due,
  ci.status,
  ci.is_critical,
  (CURRENT_DATE - ci.next_due)::integer AS days_overdue,
  ci.responsible_id,
  ci.last_completed
FROM   compliance_items ci
JOIN   sites            s  ON s.id = ci.site_id
WHERE  ci.status = 'overdue'
  AND  ci.is_active = true
ORDER  BY is_critical DESC, days_overdue DESC;

-- ── open_critical_actions ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW open_critical_actions AS
SELECT
  a.id,
  a.site_id,
  s.name          AS store_name,
  a.title,
  a.action_type,
  a.impact_weight,
  a.due_at,
  a.status,
  a.assigned_to,
  CASE
    WHEN a.due_at < now() AND a.status NOT IN ('completed','cancelled')
    THEN true ELSE false
  END             AS is_overdue,
  a.created_at
FROM   actions  a
JOIN   sites    s ON s.id = a.site_id
WHERE  a.status NOT IN ('completed','cancelled','archived')
  AND  a.impact_weight >= 3
ORDER  BY a.impact_weight DESC, a.due_at ASC NULLS LAST;

-- ── maintenance_repeat_failures ───────────────────────────────────────────────

CREATE OR REPLACE VIEW maintenance_repeat_failures AS
SELECT
  mt.id,
  mt.site_id,
  s.name              AS store_name,
  mt.asset_id,
  a.name              AS asset_name,
  a.category          AS asset_category,
  mt.title,
  mt.status,
  mt.priority,
  mt.recurrence_count,
  mt.reported_at,
  mt.due_at,
  mt.resolved_at
FROM   maintenance_tickets mt
JOIN   sites                s  ON s.id = mt.site_id
LEFT JOIN assets            a  ON a.id = mt.asset_id
WHERE  mt.recurrence_count > 1
  AND  mt.status NOT IN ('resolved','closed')
ORDER  BY mt.recurrence_count DESC, mt.priority DESC;

-- ── gm_completion_metrics ─────────────────────────────────────────────────────
-- Summarises action completion rate per GM / store for the rolling 30 days.

CREATE OR REPLACE VIEW gm_completion_metrics AS
WITH window_actions AS (
  SELECT
    site_id,
    COUNT(*)                                              AS total,
    COUNT(*) FILTER (WHERE status = 'completed')          AS completed,
    COUNT(*) FILTER (WHERE due_at < now()
      AND status NOT IN ('completed','cancelled'))        AS overdue
  FROM   actions
  WHERE  created_at >= (now() - interval '30 days')
  GROUP  BY site_id
)
SELECT
  s.id                                                    AS site_id,
  s.name                                                  AS store_name,
  s.gm_user_id,
  COALESCE(wa.total, 0)                                   AS actions_total,
  COALESCE(wa.completed, 0)                               AS actions_completed,
  COALESCE(wa.overdue, 0)                                 AS actions_overdue,
  CASE
    WHEN COALESCE(wa.total, 0) > 0
    THEN ROUND((wa.completed::numeric / wa.total * 100), 1)
    ELSE NULL
  END                                                     AS completion_pct
FROM   sites           s
LEFT JOIN window_actions wa ON wa.site_id = s.id
WHERE  s.is_active = true
ORDER  BY completion_pct ASC NULLS LAST;
