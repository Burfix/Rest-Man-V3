/**
 * Automated Operational Alerts Engine
 *
 * Evaluates five operational risk dimensions against the latest data
 * and persists alerts to the `alerts` table. Each check is idempotent:
 * it will not insert a duplicate if an unresolved alert of the same type
 * already exists (created within the last 24 hours).
 *
 * Checks:
 *   1. Revenue Risk   — forecast_sales < target_sales
 *   2. Labor Risk     — labor_cost_percent > 30 %
 *   3. Margin Risk    — gross_margin_percent < 12 %
 *   4. Maintenance    — equipment in "needs_attention" for > 7 days
 *   5. Reputation     — avg review rating dropped ≥ 0.3 in 7 days
 *
 * Usage (Next.js API route / cron):
 *   import { runAlertsEngine } from "@/services/alerts/engine";
 *   await runAlertsEngine();
 *
 * Background scheduler (Vercel Cron):
 *   See app/api/alerts/run/route.ts — invoked every 30 minutes.
 */

import { createServerClient } from "@/lib/supabase/server";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { notificationAdapters } from "./adapters";
import { todayISO, nDaysAgoISO, toNum } from "@/lib/utils";
import { RISK, CURRENCY_SYMBOL, REPORT_MAX_AGE_DAYS, MIN_REVIEW_SAMPLE } from "@/lib/constants";
import type { OperationalAlert, OperationalAlertType, OperationalAlertSeverity } from "@/types";

// ── Thresholds ────────────────────────────────────────────────────────────────

const LABOR_HIGH_PCT  = RISK.LABOR_HIGH_PCT;     // 30 % — early-warning level (Priority Alerts panel uses 65 % for critical threshold)
const MARGIN_LOW_PCT  = RISK.MARGIN_MEDIUM_PCT;  // 12 %
const MAINT_STALE_DAYS = 7;
const REVIEW_DROP_THRESHOLD = 0.3;
const DEDUP_WINDOW_HOURS = 24;

// ── Types ────────────────────────────────────────────────────────────────────

interface AlertPayload {
  alert_type:     OperationalAlertType;
  location?:      string;
  severity:       OperationalAlertSeverity;
  message:        string;
  recommendation: string;
}

/**
 * Insert a new alert unless an unresolved alert of the same type already
 * exists within DEDUP_WINDOW_HOURS. Returns the inserted row (or null on skip).
 */
async function persistAlert(
  supabase: ReturnType<typeof createServerClient>,
  payload: AlertPayload
): Promise<OperationalAlert | null> {
  const dedupCutoff = new Date(
    Date.now() - DEDUP_WINDOW_HOURS * 3_600_000
  ).toISOString();

  // De-duplication: skip if same type already unresolved within window
  const { data: existing } = await (supabase as any)
    .from("alerts")
    .select("id")
    .eq("alert_type", payload.alert_type)
    .eq("resolved", false)
    .gte("created_at", dedupCutoff)
    .limit(1)
    .maybeSingle();

  if (existing) return null; // already active — no duplicate

  const { data, error } = await (supabase as any)
    .from("alerts")
    .insert({
      alert_type:     payload.alert_type,
      location:       payload.location ?? null,
      severity:       payload.severity,
      message:        payload.message,
      recommendation: payload.recommendation,
    })
    .select()
    .single();

  if (error) {
    console.error(`[alerts_engine] Failed to insert ${payload.alert_type}:`, error.message);
    return null;
  }

  return data as OperationalAlert;
}

/** Dispatch a persisted alert to all registered notification adapters */
async function dispatch(alert: OperationalAlert): Promise<void> {
  await Promise.allSettled(
    notificationAdapters.map((adapter) =>
      adapter.sendAlert(alert).catch((err: unknown) =>
        console.error(`[alerts_engine/${adapter.channel}] dispatch error:`, err)
      )
    )
  );
}

// ── Check 1: Revenue Risk ────────────────────────────────────────────────────

async function checkRevenueRisk(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const today = todayISO();

  let forecast;
  try {
    forecast = await generateRevenueForecast(today);
  } catch {
    return null;
  }

  if (!forecast.target_sales || forecast.sales_gap == null) return null;

  const gapPct = forecast.sales_gap_pct ?? 0;

  if (gapPct >= 0) return null; // forecast meets or exceeds target

  const severity: OperationalAlertSeverity =
    gapPct <= RISK.SALES_GAP_HIGH_PCT ? "high" : "medium";

  const shortfall = Math.abs(forecast.sales_gap).toFixed(0);
  const pctStr    = Math.abs(gapPct).toFixed(1);
  const sym = CURRENCY_SYMBOL;

  return {
    alert_type:     "revenue_risk",
    severity,
    message:        `Forecast revenue is ${sym}${shortfall} (${pctStr}%) below today's target of ${sym}${forecast.target_sales.toFixed(0)}.`,
    recommendation: "Promote walk-ins or push event marketing to close the gap.",
  };
}

// ── Check 2: Labor Cost Risk ─────────────────────────────────────────────────

async function checkLaborRisk(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const { data } = await supabase
    .from("daily_operations_reports")
    .select("labor_cost_percent, report_date")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // Skip stale reports — firing alerts on weeks-old data generates noise
  const reportDate = (data as any).report_date as string;
  const ageDays = (Date.now() - new Date(reportDate + "T12:00:00Z").getTime()) / 86_400_000;
  if (ageDays > REPORT_MAX_AGE_DAYS) return null;

  const laborPct = toNum((data as any).labor_cost_percent);
  if (laborPct == null || laborPct <= LABOR_HIGH_PCT) return null;

  const severity: OperationalAlertSeverity =
    laborPct > 50 ? "critical" : laborPct > 40 ? "high" : "medium";

  return {
    alert_type:     "labor_cost_risk",
    severity,
    message:        `Labor cost is ${laborPct.toFixed(1)}% — exceeds the ${LABOR_HIGH_PCT}% threshold (report date: ${(data as any).report_date}).`,
    recommendation: "Review staff roster and reduce shift overlap before next service.",
  };
}

// ── Check 3: Margin Risk ─────────────────────────────────────────────────────

async function checkMarginRisk(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const { data } = await supabase
    .from("daily_operations_reports")
    .select("margin_percent, report_date")
    .order("report_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // Skip stale reports
  const reportDate = (data as any).report_date as string;
  const ageDays = (Date.now() - new Date(reportDate + "T12:00:00Z").getTime()) / 86_400_000;
  if (ageDays > REPORT_MAX_AGE_DAYS) return null;

  const margin = toNum((data as any).margin_percent);
  if (margin == null || margin >= MARGIN_LOW_PCT) return null;

  const severity: OperationalAlertSeverity =
    margin < RISK.MARGIN_LOW_PCT ? "high" : "medium";

  return {
    alert_type:     "margin_risk",
    severity,
    message:        `Gross margin is ${margin.toFixed(1)}% — below the ${MARGIN_LOW_PCT}% target (report date: ${(data as any).report_date}).`,
    recommendation: "Review food cost immediately or adjust menu pricing.",
  };
}

// ── Check 4: Maintenance Risk ────────────────────────────────────────────────

async function checkMaintenanceRisk(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const cutoff = nDaysAgoISO(MAINT_STALE_DAYS - 1); // `updated_at <= cutoff` means stale

  const { data } = await supabase
    .from("equipment")
    .select("id, unit_name, location, updated_at")
    .eq("status", "needs_attention")
    .lte("updated_at", new Date(cutoff + "T23:59:59Z").toISOString());

  if (!data || data.length === 0) return null;

  const count = data.length;
  const names = (data as { unit_name: string }[])
    .slice(0, 3)
    .map((e) => e.unit_name)
    .join(", ");

  const severity: OperationalAlertSeverity = count >= 3 ? "high" : "medium";

  return {
    alert_type:     "maintenance_risk",
    location:       (data[0] as any).location ?? undefined,
    severity,
    message:        `${count} equipment unit${count > 1 ? "s" : ""} (${names}${count > 3 ? "…" : ""}) in "Needs Attention" status for more than ${MAINT_STALE_DAYS} days.`,
    recommendation: "Schedule maintenance immediately to prevent operational disruption.",
  };
}

// ── Check 6: Compliance Expired ──────────────────────────────────────────────

async function checkComplianceExpired(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const today = todayISO();

  const { data, error } = await (supabase as any)
    .from("compliance_items")
    .select("id, display_name, next_due_date")
    .not("next_due_date", "is", null)
    .lt("next_due_date", today);

  if (error || !data || data.length === 0) return null;

  const expired = data as { display_name: string; next_due_date: string }[];
  const names = expired.slice(0, 3).map((i) => i.display_name).join(", ");
  const more = expired.length > 3 ? ` +${expired.length - 3} more` : "";

  return {
    alert_type:     "compliance_expired",
    severity:       "critical",
    message:        `${expired.length} compliance certificate${expired.length > 1 ? "s" : ""} expired: ${names}${more}.`,
    recommendation: "Renew expired certificates immediately to remain legally compliant and avoid penalties.",
  };
}

// ── Check 7: Compliance Due Soon ─────────────────────────────────────────────

async function checkComplianceDueSoon(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const today = todayISO();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + 30);
  const thresholdISO = threshold.toISOString().slice(0, 10);

  const { data, error } = await (supabase as any)
    .from("compliance_items")
    .select("id, display_name, next_due_date")
    .not("next_due_date", "is", null)
    .gte("next_due_date", today)          // not yet expired
    .lte("next_due_date", thresholdISO);  // but within 30 days

  if (error || !data || data.length === 0) return null;

  const dueSoon = data as { display_name: string; next_due_date: string }[];
  // Sort by nearest deadline first
  dueSoon.sort((a, b) => a.next_due_date.localeCompare(b.next_due_date));
  const names = dueSoon.slice(0, 3).map((i) => i.display_name).join(", ");
  const more = dueSoon.length > 3 ? ` +${dueSoon.length - 3} more` : "";

  const daysToNearest = Math.round(
    (new Date(dueSoon[0].next_due_date).getTime() - new Date(today).getTime()) / 86_400_000
  );

  const severity: OperationalAlertSeverity = daysToNearest <= 7 ? "high" : "medium";

  return {
    alert_type:     "compliance_due_soon",
    severity,
    message:        `${dueSoon.length} compliance item${dueSoon.length > 1 ? "s are" : " is"} due within 30 days: ${names}${more}. Nearest: ${daysToNearest}d away.`,
    recommendation: "Begin renewal process now — some authorities require 2–4 weeks lead time.",
  };
}

// ── Check 5: Reputation Risk ─────────────────────────────────────────────────

async function checkReputationRisk(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const sevenDaysAgo = nDaysAgoISO(6);
  const fourteenDaysAgo = nDaysAgoISO(13);

  const { data: recent } = await supabase
    .from("reviews")
    .select("rating")
    .gte("review_date", sevenDaysAgo);

  const { data: prior } = await supabase
    .from("reviews")
    .select("rating")
    .gte("review_date", fourteenDaysAgo)
    .lt("review_date", sevenDaysAgo);

  const avg = (rows: { rating: number }[]) =>
    rows.length === 0
      ? null
      : rows.reduce((s, r) => s + r.rating, 0) / rows.length;

  const recentAvg = avg((recent ?? []) as { rating: number }[]);
  const priorAvg  = avg((prior  ?? []) as { rating: number }[]);

  // Require minimum sample in both windows to avoid single-review overreactions
  if ((recent ?? []).length < MIN_REVIEW_SAMPLE || (prior ?? []).length < MIN_REVIEW_SAMPLE) return null;

  if (recentAvg == null || priorAvg == null) return null;

  const drop = priorAvg - recentAvg;
  if (drop < REVIEW_DROP_THRESHOLD) return null;

  const severity: OperationalAlertSeverity =
    drop >= 0.8 ? "critical" : drop >= 0.5 ? "high" : "medium";

  return {
    alert_type:     "reputation_risk",
    severity,
    message:        `Average review rating dropped by ${drop.toFixed(2)} points (from ${priorAvg.toFixed(1)} → ${recentAvg.toFixed(1)}) over the past 7 days (${(recent ?? []).length} new review${(recent ?? []).length !== 1 ? "s" : ""}).`,
    recommendation: "Review customer feedback immediately and address recurring service issues.",
  };
}

// ── Check 8: Equipment Warranty Expiring ─────────────────────────────────────

async function checkEquipmentWarrantyExpiring(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const today = todayISO();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + 30);
  const thresholdISO = threshold.toISOString().slice(0, 10);

  const { data, error } = await (supabase as any)
    .from("equipment")
    .select("id, unit_name, warranty_expiry")
    .not("warranty_expiry", "is", null)
    .lte("warranty_expiry", thresholdISO);

  if (error || !data || data.length === 0) return null;

  // Filter out already-expired (those are a separate concern)
  const expiring = (data as { unit_name: string; warranty_expiry: string }[]).filter(
    (e) => e.warranty_expiry >= today
  );
  if (expiring.length === 0) return null;

  expiring.sort((a, b) => a.warranty_expiry.localeCompare(b.warranty_expiry));
  const names = expiring.slice(0, 3).map((e) => e.unit_name).join(", ");
  const more = expiring.length > 3 ? ` +${expiring.length - 3} more` : "";
  const daysToNearest = Math.round(
    (new Date(expiring[0].warranty_expiry).getTime() - new Date(today).getTime()) / 86_400_000
  );
  const severity: OperationalAlertSeverity = daysToNearest <= 7 ? "high" : "medium";

  return {
    alert_type:     "equipment_warranty_expiring",
    severity,
    message:        `${expiring.length} equipment unit${expiring.length > 1 ? "s have" : " has"} warranty expiring within 30 days: ${names}${more}. Nearest: ${daysToNearest}d away.`,
    recommendation: "Contact supplier to arrange warranty extension or budget for replacement.",
  };
}

// ── Check 9: Equipment Service Due ───────────────────────────────────────────

async function checkEquipmentServiceDue(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const today = todayISO();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() + 14);
  const thresholdISO = threshold.toISOString().slice(0, 10);

  const { data, error } = await (supabase as any)
    .from("equipment_repairs")
    .select("equipment_id, next_service_due, equipment:equipment_id(unit_name)")
    .not("next_service_due", "is", null)
    .lte("next_service_due", thresholdISO)
    .gte("next_service_due", today);

  if (error || !data || data.length === 0) return null;

  // Deduplicate by equipment_id — keep earliest service due
  const seen = new Map<string, { unit_name: string; next_service_due: string }>();
  for (const row of data as { equipment_id: string; next_service_due: string; equipment: { unit_name: string } | null }[]) {
    const unitName = row.equipment?.unit_name ?? "Unknown";
    if (!seen.has(row.equipment_id)) {
      seen.set(row.equipment_id, { unit_name: unitName, next_service_due: row.next_service_due });
    }
  }

  const items = Array.from(seen.values()).sort((a, b) =>
    a.next_service_due.localeCompare(b.next_service_due)
  );
  const names = items.slice(0, 3).map((i) => i.unit_name).join(", ");
  const more = items.length > 3 ? ` +${items.length - 3} more` : "";
  const daysToNearest = Math.round(
    (new Date(items[0].next_service_due).getTime() - new Date(today).getTime()) / 86_400_000
  );
  const severity: OperationalAlertSeverity = daysToNearest <= 3 ? "high" : "medium";

  return {
    alert_type:     "equipment_service_due",
    severity,
    message:        `${items.length} equipment unit${items.length > 1 ? "s are" : " is"} due for service within 14 days: ${names}${more}. Nearest: ${daysToNearest}d away.`,
    recommendation: "Schedule service appointments now to avoid unplanned downtime.",
  };
}

// ── Check 10: Equipment Overdue Attention ─────────────────────────────────────

async function checkEquipmentOverdueAttention(
  supabase: ReturnType<typeof createServerClient>
): Promise<AlertPayload | null> {
  const cutoff = nDaysAgoISO(7 - 1);

  const { data, error } = await (supabase as any)
    .from("equipment")
    .select("id, unit_name, location, updated_at")
    .eq("status", "out_of_service")
    .lte("updated_at", new Date(cutoff + "T23:59:59Z").toISOString());

  if (error || !data || data.length === 0) return null;

  const count = data.length;
  const names = (data as { unit_name: string }[])
    .slice(0, 3)
    .map((e) => e.unit_name)
    .join(", ");

  return {
    alert_type:     "equipment_overdue_attention",
    severity:       "high",
    message:        `${count} equipment unit${count > 1 ? "s have" : " has"} been "Out of Service" for more than 7 days without update: ${names}${count > 3 ? "…" : ""}.`,
    recommendation: "Arrange urgent repair or replacement to restore operational capacity.",
  };
}

// ── Main engine ───────────────────────────────────────────────────────────────

export interface AlertsEngineResult {
  checked: number;
  triggered: number;
  alerts: OperationalAlert[];
  skipped: number;     // de-duplicated (already active)
  errors: number;
}

/**
 * Run all operational metric checks.
 * Safe to call from a cron job or API route; internally idempotent.
 */
export async function runAlertsEngine(): Promise<AlertsEngineResult> {
  const supabase = createServerClient();

  const checkFns = [
    checkRevenueRisk,
    checkLaborRisk,
    checkMarginRisk,
    checkMaintenanceRisk,
    checkReputationRisk,
    checkComplianceExpired,
    checkComplianceDueSoon,
    checkEquipmentWarrantyExpiring,
    checkEquipmentServiceDue,
    checkEquipmentOverdueAttention,
  ];

  // Run all checks in parallel
  const results = await Promise.allSettled(
    checkFns.map((fn) => fn(supabase))
  );

  let triggered = 0;
  let skipped   = 0;
  let errors    = 0;
  const triggeredAlerts: OperationalAlert[] = [];

  for (const result of results) {
    if (result.status === "rejected") {
      errors++;
      console.error("[alerts_engine] check error:", result.reason);
      continue;
    }

    const payload = result.value;
    if (!payload) {
      skipped++; // threshold not met
      continue;
    }

    const alert = await persistAlert(supabase, payload);
    if (!alert) {
      skipped++; // de-duplicated
      continue;
    }

    triggered++;
    triggeredAlerts.push(alert);
    await dispatch(alert);
  }

  return {
    checked:  checkFns.length,
    triggered,
    alerts:   triggeredAlerts,
    skipped,
    errors,
  };
}

/**
 * Fetch all active (unresolved) alerts from the database.
 * Used by the GET /api/alerts route and dashboard server component.
 */
export async function getActiveAlerts(): Promise<OperationalAlert[]> {
  const supabase = createServerClient();

  const { data, error } = await (supabase as any)
    .from("alerts")
    .select("*")
    .eq("resolved", false);

  if (error) {
    console.error("[alerts_engine] getActiveAlerts error:", error.message);
    return [];
  }

  // Sort by severity weight client-side for deterministic ordering
  const SEVERITY_WEIGHT: Record<string, number> = {
    critical: 0,
    high:     1,
    medium:   2,
    low:      3,
  };

  return ((data as OperationalAlert[]) ?? []).sort(
    (a, b) =>
      (SEVERITY_WEIGHT[a.severity] ?? 9) - (SEVERITY_WEIGHT[b.severity] ?? 9)
  );
}

/**
 * Mark a single alert as resolved.
 * Returns true on success, false on failure (not found or DB error).
 */
export async function resolveAlert(id: string): Promise<boolean> {
  const supabase = createServerClient();

  const { error } = await (supabase as any)
    .from("alerts")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("resolved", false); // guard: don't re-update already-resolved rows

  if (error) {
    console.error("[alerts_engine] resolveAlert error:", error.message);
    return false;
  }

  return true;
}
