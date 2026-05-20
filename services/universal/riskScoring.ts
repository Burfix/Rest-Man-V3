/**
 * Universal Risk Scoring Engine
 *
 * Lightweight, rule-based scoring functions that compute a risk level
 * (green / amber / red) for a zone or site.
 *
 * Rules are intentionally transparent and simple:
 *
 *   Ticket scoring (0–40 pts):
 *     +20 per critical/urgent open ticket
 *     +10 per high open ticket
 *     +5  per medium/low open ticket
 *     Cap: 40
 *
 *   Obligation scoring (0–30 pts):
 *     +20 per overdue obligation
 *     +5  per due-within-14-day obligation
 *     Cap: 30
 *
 *   Asset scoring (0–20 pts):
 *     +10 per OOS (out-of-service) asset
 *     Cap: 20
 *
 *   Event conflict bonus (0–10 pts):
 *     +10 if any critical open ticket exists AND a venue event is today/tomorrow
 *     Cap: 10
 *
 *   Composite (sum of all components, 0–100):
 *     0–25   → green
 *     26–59  → amber
 *     60–100 → red
 *
 * This module never writes to the DB — callers (e.g., zoneSummary.ts or a
 * POST /api/risk/recompute route) are responsible for upsert into risk_scores.
 */

import { createServerClient } from "@/lib/supabase/server";
import {
  getTicketsForSite,
  getOverdueObligations,
  getDueSoonObligations,
  getOosAssetCount,
} from "./adapter";
import type {
  ZoneRiskStatus,
  RiskScore,
  UniversalTicket,
  Obligation,
} from "@/types/universal";

// ── Score constants ───────────────────────────────────────────────────────────

const TICKET_CRITICAL_PTS = 20;
const TICKET_HIGH_PTS = 10;
const TICKET_LOW_PTS = 5;
const TICKET_CAP = 40;

const OBLIGATION_OVERDUE_PTS = 20;
const OBLIGATION_DUE_SOON_PTS = 5;
const OBLIGATION_CAP = 30;

const ASSET_OOS_PTS = 10;
const ASSET_CAP = 20;

const EVENT_CONFLICT_PTS = 10;

// Composite thresholds
const GREEN_MAX = 25;
const AMBER_MAX = 59;

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusFromScore(composite: number): ZoneRiskStatus {
  if (composite <= GREEN_MAX) return "green";
  if (composite <= AMBER_MAX) return "amber";
  return "red";
}

function scoreTickets(tickets: UniversalTicket[]): {
  score: number;
  critical: number;
} {
  let raw = 0;
  let criticalCount = 0;
  for (const t of tickets) {
    const p = (t.priority ?? "medium").toLowerCase();
    if (p === "critical" || p === "urgent") {
      raw += TICKET_CRITICAL_PTS;
      criticalCount++;
    } else if (p === "high") {
      raw += TICKET_HIGH_PTS;
    } else {
      raw += TICKET_LOW_PTS;
    }
  }
  return { score: Math.min(raw, TICKET_CAP), critical: criticalCount };
}

function scoreObligations(
  overdue: Obligation[],
  dueSoon: Obligation[]
): number {
  const raw =
    overdue.length * OBLIGATION_OVERDUE_PTS +
    dueSoon.length * OBLIGATION_DUE_SOON_PTS;
  return Math.min(raw, OBLIGATION_CAP);
}

function scoreAssets(oosCount: number): number {
  return Math.min(oosCount * ASSET_OOS_PTS, ASSET_CAP);
}

async function getActiveEventCount(
  _siteId: string,
  withinDays = 2
): Promise<number> {
  const supabase = createServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const limit = new Date(Date.now() + withinDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // events table does not have site_id yet — query all non-cancelled events
  const { count, error } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("cancelled", false)
    .gte("event_date", today)
    .lte("event_date", limit);

  if (error) return 0;
  return count ?? 0;
}

// ── Zone-level risk computation ───────────────────────────────────────────────

export interface ZoneRiskResult {
  zone_id: string | null;
  site_id: string;
  ticket_score: number;
  obligation_score: number;
  asset_score: number;
  event_conflict_score: number;
  composite_score: number;
  status: ZoneRiskStatus;
  open_ticket_count: number;
  overdue_obligation_count: number;
  oos_asset_count: number;
  active_event_count: number;
  primary_risk: string | null;
  secondary_risk: string | null;
}

/**
 * Computes the risk result for a single zone.
 * Pass zoneId = null for a site-level roll-up (all zones combined).
 */
export async function computeZoneRisk(
  siteId: string,
  zoneId: string | null
): Promise<ZoneRiskResult> {
  // Gather inputs in parallel
  const [tickets, overdueObs, dueSoonObs, oosCount, eventCount] =
    await Promise.all([
      getTicketsForSite(siteId, {
        zoneId: zoneId ?? undefined,
        statuses: ["open", "in_progress"],
      }),
      getOverdueObligations(siteId),
      getDueSoonObligations(siteId, 14),
      getOosAssetCount(siteId, zoneId ?? undefined),
      getActiveEventCount(siteId),
    ]);

  // Filter obligation lists to zone if specified
  const filteredOverdue = zoneId
    ? overdueObs.filter((o) => o.zone_id === zoneId || o.zone_id === null)
    : overdueObs;
  const filteredDueSoon = zoneId
    ? dueSoonObs.filter((o) => o.zone_id === zoneId || o.zone_id === null)
    : dueSoonObs;

  const { score: ticketScore, critical: criticalCount } = scoreTickets(tickets);
  const obligationScore = scoreObligations(filteredOverdue, filteredDueSoon);
  const assetScore = scoreAssets(oosCount);

  // Event conflict: bump score if there are upcoming events AND critical issues
  const eventConflict =
    eventCount > 0 && criticalCount > 0 ? EVENT_CONFLICT_PTS : 0;

  const composite = ticketScore + obligationScore + assetScore + eventConflict;
  const status = statusFromScore(composite);

  // Build natural-language risk labels for card display
  const primaryRisk = buildPrimaryRiskLabel(
    tickets.length,
    criticalCount,
    filteredOverdue.length,
    oosCount
  );
  const secondaryRisk = buildSecondaryRiskLabel(
    filteredDueSoon.length,
    eventCount,
    eventConflict > 0
  );

  return {
    zone_id: zoneId,
    site_id: siteId,
    ticket_score: ticketScore,
    obligation_score: obligationScore,
    asset_score: assetScore,
    event_conflict_score: eventConflict,
    composite_score: Math.min(composite, 100),
    status,
    open_ticket_count: tickets.length,
    overdue_obligation_count: filteredOverdue.length,
    oos_asset_count: oosCount,
    active_event_count: eventCount,
    primary_risk: primaryRisk,
    secondary_risk: secondaryRisk,
  };
}

function buildPrimaryRiskLabel(
  openTickets: number,
  critical: number,
  overdue: number,
  oos: number
): string | null {
  if (critical > 0) return `${critical} critical open ticket${critical > 1 ? "s" : ""}`;
  if (overdue > 0) return `${overdue} overdue obligation${overdue > 1 ? "s" : ""}`;
  if (oos > 0) return `${oos} asset${oos > 1 ? "s" : ""} out of service`;
  if (openTickets > 0) return `${openTickets} open ticket${openTickets > 1 ? "s" : ""}`;
  return null;
}

function buildSecondaryRiskLabel(
  dueSoon: number,
  events: number,
  hasConflict: boolean
): string | null {
  if (hasConflict) return "Critical issue during upcoming event";
  if (dueSoon > 0) return `${dueSoon} obligation${dueSoon > 1 ? "s" : ""} due within 14 days`;
  if (events > 0) return `${events} upcoming event${events > 1 ? "s" : ""}`;
  return null;
}

// ── Site-level roll-up ────────────────────────────────────────────────────────

/**
 * Computes risk for the entire site (zoneId = null = all zones combined).
 * Uses the same scoring functions.
 */
export async function computeSiteRisk(siteId: string): Promise<ZoneRiskResult> {
  return computeZoneRisk(siteId, null);
}

// ── Upsert risk score to DB ───────────────────────────────────────────────────

/**
 * Persists a computed ZoneRiskResult into the risk_scores table.
 * Upserts on (site_id, zone_id) so re-runs overwrite the previous value.
 */
export async function saveRiskScore(result: ZoneRiskResult): Promise<void> {
  const supabase = createServerClient();

  const row: Omit<RiskScore, "id"> = {
    site_id: result.site_id,
    zone_id: result.zone_id,
    ticket_score: result.ticket_score,
    obligation_score: result.obligation_score,
    asset_score: result.asset_score,
    event_conflict_score: result.event_conflict_score,
    composite_score: result.composite_score,
    status: result.status,
    open_ticket_count: result.open_ticket_count,
    overdue_obligation_count: result.overdue_obligation_count,
    oos_asset_count: result.oos_asset_count,
    active_event_count: result.active_event_count,
    computed_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("risk_scores")
    .upsert(row, { onConflict: "site_id,zone_id" });

  if (error) {
    console.error("[universal/riskScoring] saveRiskScore:", error.message);
  }
}

/**
 * Reads the latest cached risk score for a zone (or site if zoneId = null).
 * Returns null if no score has been computed yet.
 */
export async function getCachedRiskScore(
  siteId: string,
  zoneId: string | null
): Promise<RiskScore | null> {
  const supabase = createServerClient();

  let query = supabase
    .from("risk_scores")
    .select("*")
    .eq("site_id", siteId);

  if (zoneId) {
    query = query.eq("zone_id", zoneId);
  } else {
    query = query.is("zone_id", null);
  }

  const { data, error } = await query.single();
  if (error) return null;
  return data as RiskScore;
}

/**
 * Checks whether a specific asset has had repeated failures within the last N days.
 * Useful for escalating risk on unreliable equipment.
 *
 * Returns true if the asset had >= minCount closed/resolved tickets in the window.
 */
export async function hasRepeatedAssetFailures(
  assetId: string,
  withinDays = 90,
  minCount = 3
): Promise<boolean> {
  const supabase = createServerClient();
  const since = new Date(Date.now() - withinDays * 86_400_000).toISOString();

  const { count, error } = await supabase
    .from("maintenance_logs")
    .select("id", { count: "exact", head: true })
    .eq("equipment_id", assetId)
    .in("repair_status", ["resolved", "closed"])
    .gte("date_reported", since);

  if (error) return false;
  return (count ?? 0) >= minCount;
}
