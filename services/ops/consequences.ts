/**
 * Consequences Engine
 *
 * Produces high-stakes consequence banners by projecting current trends forward.
 *
 * Three consequence types:
 *   revenue_risk   — projects weekly shortfall in Rand
 *   compliance_risk — any expired or soon-due compliance item → fine/closure risk
 *   labour_risk     — projects monthly labour overrun in Rand
 *
 * All calculations are intentionally conservative (we over-state risk to drive action).
 */

import { createServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORG_ID } from "@/lib/constants";
import { todayISO } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConsequenceSeverity = "critical" | "warning" | "watch";

export interface Consequence {
  id:           string;
  severity:     ConsequenceSeverity;
  headline:     string;   // "At risk of missing weekly target by R32,000"
  detail:       string;   // one-liner explanation
  call_to_action: string; // "Review revenue targets"
}

export interface ConsequenceSummary {
  consequences: Consequence[];
  has_critical: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return `R${Math.round(n).toLocaleString("en-ZA")}`;
}

/** Returns the Monday of the current week (SAST) */
function weekStartISO(): string {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  const day   = today.getDay(); // 0=Sun
  const diff  = day === 0 ? -6 : 1 - day;
  today.setDate(today.getDate() + diff);
  return today.toISOString().slice(0, 10);
}

/** Returns the Sunday of the current week (SAST) */
function weekEndISO(): string {
  const start = new Date(weekStartISO());
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

/** Days remaining in the current ISO week including today */
function daysLeftInWeek(): number {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  return 7 - today.getDay() || 7;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getConsequences(orgId: string = DEFAULT_ORG_ID): Promise<ConsequenceSummary> {
  const supabase  = createServerClient();
  const today     = todayISO();
  const weekStart = weekStartISO();
  const weekEnd   = weekEndISO();

  const [revenueRes, complianceRes, opsRes] = await Promise.allSettled([
    // Revenue: actual this week + weekly target
    Promise.all([
      supabase
        .from("daily_operations_reports")
        .select("report_date, sales_net_vat")
        .gte("report_date", weekStart)
        .lte("report_date", today)
        .order("report_date", { ascending: true }),
      (supabase.from("sales_targets") as any)
        .select("target_date, target_sales")
        .eq("organization_id", orgId)
        .gte("target_date", weekStart)
        .lte("target_date", weekEnd),
    ]),

    // Compliance: expired or due_soon items
    supabase
      .from("compliance_items")
      .select("display_name, status, next_due_date"),

    // Labour: last 7 days of ops reports
    supabase
      .from("daily_operations_reports")
      .select("report_date, sales_net_vat, labor_cost_percent")
      .order("report_date", { ascending: false })
      .limit(7),
  ]);

  const consequences: Consequence[] = [];

  // ── Revenue risk ───────────────────────────────────────────────────────────
  if (revenueRes.status === "fulfilled") {
    const [actualRes, targetRes] = revenueRes.value;
    const actualRows = (actualRes.data ?? []) as { report_date: string; sales_net_vat: number | null }[];
    const targetRows = (targetRes.data ?? []) as { target_date: string; target_sales: number }[];

    const weeklyActual = actualRows.reduce((s, r) => s + (r.sales_net_vat ?? 0), 0);
    const weeklyTarget = targetRows.reduce((s, r) => s + (r.target_sales ?? 0), 0);

    if (weeklyTarget > 0) {
      const daysLeft  = daysLeftInWeek();
      const shortfall = weeklyTarget - weeklyActual;

      if (shortfall > 0) {
        // Daily run-rate needed vs recent average
        const daysTraded  = actualRows.length || 1;
        const avgDailyActual = weeklyActual / daysTraded;
        const projected  = weeklyActual + avgDailyActual * daysLeft;
        const projectedShortfall = weeklyTarget - projected;

        if (projectedShortfall > 0) {
          consequences.push({
            id:       "revenue_risk",
            severity: projectedShortfall > weeklyTarget * 0.15 ? "critical" : "warning",
            headline: `At risk of missing weekly target by ${fmt(projectedShortfall)}`,
            detail:   `Tracking ${fmt(weeklyActual)} vs ${fmt(weeklyTarget)} target. Need ${fmt(shortfall / Math.max(daysLeft, 1))}/day to recover.`,
            call_to_action: "Push upselling — drive covers and bar spend today",
          });
        }
      }
    }
  }

  // ── Compliance risk ────────────────────────────────────────────────────────
  if (complianceRes.status === "fulfilled") {
    const items = (complianceRes.value.data ?? []) as {
      display_name: string;
      status: string;
      next_due_date: string | null;
    }[];

    const expired  = items.filter((i) => i.status === "expired");
    const dueSoon  = items.filter((i) => i.status === "due_soon");

    if (expired.length > 0) {
      consequences.push({
        id:       "compliance_risk_expired",
        severity: "critical",
        headline: `Compliance risk: fine or closure possible`,
        detail:   `${expired.length} item${expired.length === 1 ? "" : "s"} expired: ${expired.slice(0, 2).map((i) => i.display_name).join(", ")}${expired.length > 2 ? " +" + (expired.length - 2) + " more" : ""}`,
        call_to_action: "Renew compliance documents immediately",
      });
    } else if (dueSoon.length > 0) {
      consequences.push({
        id:       "compliance_risk_due_soon",
        severity: "warning",
        headline: `${dueSoon.length} compliance item${dueSoon.length === 1 ? "" : "s"} expiring soon`,
        detail:   `${dueSoon.slice(0, 2).map((i) => i.display_name).join(", ")}${dueSoon.length > 2 ? " +" + (dueSoon.length - 2) + " more" : ""} — renew before deadline`,
        call_to_action: "Schedule compliance renewals this week",
      });
    }
  }

  // ── Labour risk ────────────────────────────────────────────────────────────
  if (opsRes.status === "fulfilled") {
    const opsRows = (opsRes.value.data ?? []) as {
      report_date:       string;
      sales_net_vat:     number | null;
      labor_cost_percent: number | null;
    }[];

    const withLabour = opsRows.filter(
      (r) => r.labor_cost_percent !== null && r.sales_net_vat !== null
    );

    if (withLabour.length >= 3) {
      const avgLabourPct = withLabour.reduce((s, r) => s + (r.labor_cost_percent ?? 0), 0) / withLabour.length;
      const avgSales     = withLabour.reduce((s, r) => s + (r.sales_net_vat ?? 0), 0) / withLabour.length;

      if (avgLabourPct > 35) {
        // Monthly projection: 30 days × daily labour cost overrun
        const targetLabourPct  = 30;
        const overrunPct       = avgLabourPct - targetLabourPct;
        const dailyOverrun     = (overrunPct / 100) * avgSales;
        const monthlyOverrun   = dailyOverrun * 30;

        consequences.push({
          id:       "labour_risk",
          severity: avgLabourPct > 40 ? "critical" : "warning",
          headline: `Labour trend will exceed budget`,
          detail:   `${avgLabourPct.toFixed(1)}% labour cost avg (target ≤30%) — projects ${fmt(monthlyOverrun)} monthly overrun`,
          call_to_action: avgLabourPct > 40 ? "Cut FOH shifts immediately" : "Review staffing schedule",
        });
      }
    }
  }

  return {
    consequences,
    has_critical: consequences.some((c) => c.severity === "critical"),
  };
}
