/**
 * lib/targets/resolveRevenueTarget.ts
 *
 * SINGLE SOURCE OF TRUTH for daily revenue target resolution.
 *
 * All components, scoring engines, and dashboards MUST use this function.
 * No component may derive its own revenue target independently.
 *
 * Waterfall (in priority order):
 *   1. sales_targets WHERE site_id = siteId AND target_date = date
 *      → budget explicitly set for this site on this day (most precise)
 *   2. sales_targets WHERE organization_id = orgId AND target_date = date
 *      → org-level budget for this day (backwards-compatible fallback)
 *   3. sites.target_avg_spend × sites.seating_capacity × 0.70 utilisation
 *      → estimated daily budget when no explicit target is set
 *   4. null — target: null, source: "insufficient_data"
 *      → missing config; score must not penalise the site for this
 */

import { createServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RevenueTargetSource =
  | "sales_targets"      // from explicit budget row
  | "estimated"          // derived from capacity × avg spend
  | "insufficient_data"; // no target, no capacity config

export interface RevenueTargetResult {
  /** The resolved target in ZAR, or null if config is insufficient. */
  target: number | null;
  /** Where the target came from. */
  source: RevenueTargetSource;
  /**
   * true when the target was estimated (no explicit budget row set).
   * UI must render an "Est." badge next to the target figure.
   */
  estimated: boolean;
  /** Human-readable warning surfaced to the dashboard when estimated or missing. */
  warning?: string;
}

// ── Main resolver ─────────────────────────────────────────────────────────────

/**
 * Resolve the daily revenue target for a site on a given date.
 *
 * @param siteId  UUID of the site
 * @param date    ISO date "YYYY-MM-DD"
 * @param db      Optional Supabase client; creates a new one if omitted.
 *                Pass the caller's client to avoid opening an extra connection.
 */
export async function resolveRevenueTarget(
  siteId: string,
  date: string,
  db?: SupabaseClient<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<RevenueTargetResult> {
  const supabase = db ?? createServerClient();

  // ── Step 1: Explicit site-scoped budget ────────────────────────────────────
  const { data: siteTarget } = await (supabase as any)
    .from("sales_targets")
    .select("target_sales")
    .eq("site_id", siteId)
    .eq("target_date", date)
    .maybeSingle();

  if (siteTarget?.target_sales != null) {
    return {
      target:    Number(siteTarget.target_sales),
      source:    "sales_targets",
      estimated: false,
    };
  }

  // ── Step 2: Fetch site config (needed for org fallback + capacity estimate) ─
  const { data: siteRow } = await supabase
    .from("sites")
    .select("organisation_id, target_avg_spend, seating_capacity")
    .eq("id", siteId)
    .single();

  // Step 2a: Org-level fallback (backwards compatible with existing data)
  const orgId = (siteRow as any)?.organisation_id as string | null ?? null;
  if (orgId) {
    const { data: orgTarget } = await (supabase as any)
      .from("sales_targets")
      .select("target_sales")
      .eq("organization_id", orgId)
      .eq("target_date", date)
      .maybeSingle();

    if (orgTarget?.target_sales != null) {
      return {
        target:    Number(orgTarget.target_sales),
        source:    "sales_targets",
        estimated: false,
      };
    }
  }

  // ── Step 3: Capacity-based estimate ──────────────────────────────────────
  const avgSpend = Number((siteRow as any)?.target_avg_spend ?? 0);
  const capacity = Number((siteRow as any)?.seating_capacity ?? 0);

  if (avgSpend > 0 && capacity > 0) {
    // 70% utilisation is a conservative but realistic baseline for an
    // active restaurant that hasn't set an explicit budget.
    const estimatedTarget = Math.round(avgSpend * capacity * 0.70);
    return {
      target:    estimatedTarget,
      source:    "estimated",
      estimated: true,
      warning:   `No budget set for ${date} — using capacity estimate (${capacity} seats × R${avgSpend} avg spend × 70% utilisation = R${estimatedTarget.toLocaleString()})`,
    };
  }

  // ── Step 4: Insufficient config ───────────────────────────────────────────
  return {
    target:    null,
    source:    "insufficient_data",
    estimated: false,
    warning:   `No revenue target configured for site ${siteId} on ${date}. Set a budget in Settings → Revenue Targets or configure seating capacity.`,
  };
}

// ── Labour guard ──────────────────────────────────────────────────────────────

/**
 * Safe labour percentage calculation with minimum revenue gate.
 *
 * Returns null when revenue is below the minimum threshold. This prevents
 * absurd percentages (e.g. 3223.6%) caused by dividing labour cost by
 * near-zero revenue during pre-service or data-lag periods.
 *
 * @param labourCost   Total labour cost in ZAR
 * @param revenue      Actual revenue in ZAR
 * @param minRevenue   Minimum gate — default R500
 */
export function safeLabourPct(
  labourCost: number,
  revenue: number,
  minRevenue = 500,
): number | null {
  if (revenue < minRevenue) return null;
  return +(labourCost / revenue * 100).toFixed(2);
}
