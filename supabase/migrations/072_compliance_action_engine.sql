-- ============================================================
-- Migration 072: Compliance Action Engine
--
-- Replaces v_compliance_risk with an enriched version that
-- adds per-row recommended_action, action_owner, and
-- action_deadline — the "what to do next" layer.
--
-- Also adds v_compliance_actions — a flat list of open
-- actions sorted by urgency, used by the command endpoint.
-- ============================================================

-- ── Drop and recreate v_compliance_risk with action columns ──────────────────

CREATE OR REPLACE VIEW v_compliance_risk AS
SELECT
  t.id                  AS tenant_id,
  t.name                AS tenant,
  t.precinct,
  ct.name               AS certificate_type,
  c.id                  AS certificate_id,
  c.status,
  c.expiry_date,
  CASE
    WHEN c.status = 'EXPIRED'  THEN 'CRITICAL'
    WHEN c.status = 'MISSING'  THEN 'CRITICAL'
    WHEN c.status = 'REJECTED' THEN 'WARNING'
    WHEN c.expiry_date IS NOT NULL
         AND c.expiry_date < (now() + INTERVAL '30 days') THEN 'WARNING'
    ELSE 'INFO'
  END                   AS risk_level,
  -- ── Action Engine ──────────────────────────────────────────────────────────
  CASE
    WHEN c.status = 'EXPIRED'  THEN 'Upload and resubmit an updated certificate'
    WHEN c.status = 'MISSING'  THEN 'Upload the required certificate document'
    WHEN c.status = 'REJECTED' THEN 'Review rejection reason and resubmit corrected document'
    WHEN c.expiry_date IS NOT NULL
         AND c.expiry_date < (now() + INTERVAL '30 days')
                           THEN 'Renew certificate before expiry date'
    ELSE NULL
  END                   AS recommended_action,
  -- Owner: TENANT uploads/renews; OFFICER reviews; NULL when no action needed
  CASE
    WHEN c.status IN ('EXPIRED', 'MISSING', 'REJECTED')                THEN 'TENANT'
    WHEN c.expiry_date IS NOT NULL
         AND c.expiry_date < (now() + INTERVAL '30 days')              THEN 'TENANT'
    ELSE NULL
  END                   AS action_owner,
  -- Deadline: immediate for expired/missing, 7 days for rejected, cert expiry for renewals
  CASE
    WHEN c.status IN ('EXPIRED', 'MISSING') THEN CURRENT_DATE
    WHEN c.status = 'REJECTED'              THEN CURRENT_DATE + INTERVAL '7 days'
    WHEN c.expiry_date IS NOT NULL
         AND c.expiry_date < (now() + INTERVAL '30 days')
                                            THEN c.expiry_date
    ELSE NULL
  END::DATE             AS action_deadline
FROM certificates c
JOIN  tenants           t  ON t.id  = c.tenant_id
LEFT JOIN certificate_types ct ON ct.id = c.certificate_type_id;

-- ── v_compliance_actions — open actions only, sorted by urgency ──────────────

CREATE OR REPLACE VIEW v_compliance_actions AS
SELECT *
FROM v_compliance_risk
WHERE risk_level IN ('CRITICAL', 'WARNING')
  AND recommended_action IS NOT NULL
ORDER BY
  CASE risk_level WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
  action_deadline NULLS LAST;

-- ── Grant usage on new view ───────────────────────────────────────────────────

GRANT SELECT ON v_compliance_actions TO anon, authenticated;
