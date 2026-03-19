/**
 * Decision Engine — Rule Definitions
 *
 * Each rule is a pure function that takes operational inputs
 * and returns a structured AlertPayload or null.
 *
 * Rules are:
 *   1. Revenue below threshold
 *   2. Labour above threshold
 *   3. Gross margin below threshold
 *   4. Compliance — item overdue
 *   5. Compliance — item due soon
 *   6. Maintenance — critical ticket overdue
 *   7. Maintenance — repeat asset failure
 *   8. Review rating dropped
 *   9. Action past due
 *
 * Provenance (source_facts) is attached to every alert so the UI
 * can render "Why this alert?" explanations without extra queries.
 */

import type { AlertSeverity, SourceFact } from "@/lib/ontology/entities";

export interface AlertPayload {
  alert_type:      string;
  severity:        AlertSeverity;
  title:           string;
  message:         string;
  recommendation:  string;
  escalation_path: string | null;
  source_facts:    SourceFact[];
}

// ── Rule 1: Revenue Below Threshold ──────────────────────────────────────────

export function ruleRevenueBelowThreshold(params: {
  salesNetVat:     number;
  revenueTarget:   number;
  thresholdPct?:   number;   // alert if gap > this % below target (default -10%)
  storeLabel:      string;
  targetSource?:   string;
}): AlertPayload | null {
  const { salesNetVat, revenueTarget, storeLabel, targetSource } = params;
  const threshold = params.thresholdPct ?? -10;

  if (revenueTarget <= 0) return null;

  const gapPct = ((salesNetVat - revenueTarget) / revenueTarget) * 100;
  if (gapPct >= threshold) return null;

  const severity: AlertSeverity = gapPct < -25 ? "critical" : gapPct < -15 ? "high" : "medium";
  const gapAbs = Math.abs(salesNetVat - revenueTarget).toFixed(0);

  return {
    alert_type:      "revenue_risk",
    severity,
    title:           `Revenue below target at ${storeLabel}`,
    message:         `Sales of R ${salesNetVat.toLocaleString()} are ${Math.abs(gapPct).toFixed(1)}% below the R ${revenueTarget.toLocaleString()} target.`,
    recommendation:  `Review covers and average-spend uplift opportunities. Consider targeted promotions or dynamic pricing. Shortfall: R ${gapAbs}.`,
    escalation_path: severity === "critical" ? "area_manager" : null,
    source_facts: [
      { label: "Actual sales (net VAT)", value: `R ${salesNetVat.toLocaleString()}` },
      { label: "Revenue target",         value: `R ${revenueTarget.toLocaleString()}`,
        detail: targetSource ?? "From store_snapshots" },
      { label: "Gap",                    value: `${gapPct.toFixed(1)}%` },
    ],
  };
}

// ── Rule 2: Labour Above Threshold ────────────────────────────────────────────

export function ruleLabourAboveThreshold(params: {
  labourPct:      number;
  targetPct?:     number;   // default 30%
  storeLabel:     string;
}): AlertPayload | null {
  const { labourPct, storeLabel } = params;
  const target = params.targetPct ?? 30;

  if (labourPct <= target) return null;

  const overage  = (labourPct - target).toFixed(1);
  const severity: AlertSeverity = labourPct > 45 ? "critical" : labourPct > 38 ? "high" : "medium";

  return {
    alert_type:      "labour_risk",
    severity,
    title:           `High labour cost at ${storeLabel}`,
    message:         `Labour is at ${labourPct.toFixed(1)}% of revenue — ${overage}% above the ${target}% target.`,
    recommendation:  "Review scheduling efficiency. Consider shifting to natural attrition hours or reviewing rosters against covers forecast.",
    escalation_path: severity === "critical" ? "area_manager" : null,
    source_facts: [
      { label: "Labour %",      value: `${labourPct.toFixed(1)}%`,
        detail: "labour_cost ÷ net_sales × 100" },
      { label: "Target %",      value: `${target}%` },
      { label: "Overage",       value: `${overage}%` },
    ],
  };
}

// ── Rule 3: Compliance Overdue ─────────────────────────────────────────────────

export interface ComplianceItemInput {
  id:           string;
  title:        string;
  category:     string;
  next_due:     string;
  days_overdue: number;
  is_critical:  boolean;
}

export function ruleComplianceOverdue(
  item:        ComplianceItemInput,
  storeLabel:  string
): AlertPayload {
  const severity: AlertSeverity =
    item.is_critical || item.days_overdue > 30 ? "critical" :
    item.days_overdue > 7 ? "high" : "medium";

  return {
    alert_type:      "compliance_overdue",
    severity,
    title:           `Overdue compliance: ${item.title} at ${storeLabel}`,
    message:         `"${item.title}" was due ${item.days_overdue} day(s) ago (${item.next_due}).`,
    recommendation:  `Complete immediately and upload evidence. Escalate if blocked.`,
    escalation_path: item.is_critical ? "area_manager" : null,
    source_facts: [
      { label: "Item",         value: item.title },
      { label: "Category",     value: item.category },
      { label: "Due date",     value: item.next_due },
      { label: "Days overdue", value: String(item.days_overdue) },
      { label: "Critical",     value: item.is_critical ? "Yes" : "No" },
    ],
  };
}

// ── Rule 4: Compliance Due Soon ────────────────────────────────────────────────

export function ruleComplianceDueSoon(
  item:        { id: string; title: string; category: string; next_due: string; days_until: number; is_critical: boolean },
  storeLabel:  string
): AlertPayload {
  return {
    alert_type:      "compliance_due_soon",
    severity:        item.is_critical ? "high" : "low",
    title:           `Compliance due in ${item.days_until}d: ${item.title} at ${storeLabel}`,
    message:         `"${item.title}" is due on ${item.next_due} — ${item.days_until} day(s) away.`,
    recommendation:  "Schedule completion before the due date to maintain compliance.",
    escalation_path: null,
    source_facts: [
      { label: "Item",       value: item.title },
      { label: "Due date",   value: item.next_due },
      { label: "Days until", value: String(item.days_until) },
    ],
  };
}

// ── Rule 5: Critical Maintenance Overdue ─────────────────────────────────────

export interface MaintenanceItemInput {
  id:               string;
  title:            string;
  asset_name:       string | null;
  priority:         string;
  reported_at:      string;
  due_at:           string | null;
  recurrence_count: number;
}

export function ruleMaintenanceOverdue(
  ticket:      MaintenanceItemInput,
  storeLabel:  string
): AlertPayload | null {
  if (!["critical", "high"].includes(ticket.priority)) return null;
  if (!ticket.due_at) return null;

  const daysOverdue = Math.floor(
    (Date.now() - new Date(ticket.due_at).getTime()) / 86_400_000
  );
  if (daysOverdue <= 0) return null;

  const severity: AlertSeverity = ticket.priority === "critical" ? "critical" : "high";

  return {
    alert_type:      "maintenance_overdue",
    severity,
    title:           `Overdue maintenance ticket at ${storeLabel}`,
    message:         `"${ticket.title}" ${ticket.asset_name ? `(${ticket.asset_name}) ` : ""}is ${daysOverdue} day(s) past due.`,
    recommendation:  "Assign to a contractor immediately. If safety-critical, escalate to area manager.",
    escalation_path: ticket.priority === "critical" ? "area_manager" : null,
    source_facts: [
      { label: "Ticket",       value: ticket.title },
      { label: "Priority",     value: ticket.priority },
      { label: "Due date",     value: ticket.due_at },
      { label: "Days overdue", value: String(daysOverdue) },
      ...(ticket.asset_name
        ? [{ label: "Asset", value: ticket.asset_name }]
        : []),
    ],
  };
}

// ── Rule 6: Repeat Asset Failure ──────────────────────────────────────────────

export function ruleRepeatAssetFailure(
  ticket:      MaintenanceItemInput,
  storeLabel:  string
): AlertPayload | null {
  if (ticket.recurrence_count < 2) return null;

  return {
    alert_type:      "maintenance_repeat_failure",
    severity:        ticket.recurrence_count >= 4 ? "critical" : "high",
    title:           `Repeat failure: ${ticket.asset_name ?? ticket.title} at ${storeLabel}`,
    message:         `This asset has failed ${ticket.recurrence_count} times. Temporary fixes are not resolving the root cause.`,
    recommendation:  "Escalate to area manager. Commission a specialist inspection or budget for asset replacement.",
    escalation_path: "area_manager",
    source_facts: [
      { label: "Asset",              value: ticket.asset_name ?? "(unknown)" },
      { label: "Failure count",      value: String(ticket.recurrence_count) },
      { label: "Latest ticket",      value: ticket.title },
      { label: "First reported",     value: ticket.reported_at.slice(0, 10) },
    ],
  };
}

// ── Rule 7: Action Past Due ───────────────────────────────────────────────────

export function ruleActionPastDue(params: {
  actionId:    string;
  title:       string;
  due_at:      string;
  storeLabel:  string;
  impact:      number;
}): AlertPayload {
  const { title, due_at, storeLabel, impact } = params;
  const daysOverdue = Math.floor(
    (Date.now() - new Date(due_at).getTime()) / 86_400_000
  );

  return {
    alert_type:      "action_overdue",
    severity:        impact >= 4 ? "high" : "medium",
    title:           `Overdue action at ${storeLabel}`,
    message:         `"${title}" was due ${daysOverdue} day(s) ago.`,
    recommendation:  "Complete or reassign this action. If blocked, escalate.",
    escalation_path: impact >= 4 ? "area_manager" : null,
    source_facts: [
      { label: "Action",       value: title },
      { label: "Due date",     value: due_at.slice(0, 10) },
      { label: "Days overdue", value: String(daysOverdue) },
      { label: "Impact weight",value: String(impact) },
    ],
  };
}
