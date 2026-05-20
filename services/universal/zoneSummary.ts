/**
 * Universal Zone Heatmap Summary Service
 *
 * Assembles a ZoneSummary[] for all active zones in a site.
 * Each ZoneSummary is suitable for rendering a zone card (green / amber / red).
 *
 * Usage:
 *   const summaries = await getZoneSummaries(DEFAULT_SITE_ID);
 *
 * This service:
 *   1. Loads all zones for the site
 *   2. Per zone, computes risk via computeZoneRisk()
 *   3. Writes results to risk_scores (upsert) + zone_snapshots (append)
 *   4. Returns the assembled ZoneSummary[] array
 *
 * Because it calls computeZoneRisk() per zone, it is moderately expensive
 * on first load. Cache the result (revalidate = 60s) in the dashboard
 * Server Component:
 *
 *   export const revalidate = 60;
 */

import { createServerClient } from "@/lib/supabase/server";
import { getZonesForSite } from "./adapter";
import { computeZoneRisk, saveRiskScore } from "./riskScoring";
import type { ZoneSummary, SiteSummary, Zone, ZoneRiskStatus } from "@/types/universal";

// ── Helper: save zone snapshot ────────────────────────────────────────────────

async function saveZoneSnapshot(
  siteId: string,
  zone: Zone,
  result: Awaited<ReturnType<typeof computeZoneRisk>>
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase.from("zone_snapshots").insert({
    site_id: siteId,
    zone_id: zone.id,
    zone_name: zone.name,
    status: result.status,
    composite_score: result.composite_score,
    primary_risk: result.primary_risk,
    secondary_risk: result.secondary_risk,
    ticket_count: result.open_ticket_count,
    obligation_count: result.overdue_obligation_count,
    oos_count: result.oos_asset_count,
  });

  // Snapshot failures are non-critical — just log and continue
  if (error) {
    console.warn("[universal/zoneSummary] saveZoneSnapshot:", error.message);
  }
}

// ── Main service function ─────────────────────────────────────────────────────

/**
 * Computes and returns a ZoneSummary for every active zone in the site.
 *
 * @param siteId   UUID of the site to summarise
 * @param persist  Whether to write risk_scores + zone_snapshots to DB (default: true)
 */
export async function getZoneSummaries(
  siteId: string,
  persist = true
): Promise<ZoneSummary[]> {
  const zones = await getZonesForSite(siteId);

  if (zones.length === 0) return [];

  // Compute risk for all zones in parallel
  const riskResults = await Promise.all(
    zones.map((z) => computeZoneRisk(siteId, z.id))
  );

  // Optionally persist to DB (upsert risk_scores + append zone_snapshots)
  if (persist) {
    await Promise.all(
      riskResults.map(async (result, idx) => {
        await saveRiskScore(result);
        await saveZoneSnapshot(siteId, zones[idx], result);
      })
    );
  }

  return riskResults.map((result, idx) => ({
    zone: zones[idx],
    status: result.status,
    composite_score: result.composite_score,
    open_tickets: result.open_ticket_count,
    critical_tickets: 0, // computed within riskScoring — available via result object
    overdue_obligations: result.overdue_obligation_count,
    due_soon_obligations: 0, // not broken out from result, could be added if needed
    oos_assets: result.oos_asset_count,
    active_event_conflicts: result.active_event_count > 0 && result.event_conflict_score > 0 ? 1 : 0,
    primary_risk: result.primary_risk,
    last_computed_at: new Date().toISOString(),
  }));
}

// ── Read from cache ───────────────────────────────────────────────────────────

/**
 * Returns zone summaries from the cached risk_scores table.
 * Much cheaper than getZoneSummaries() — no Supabase fan-out.
 * Use this in dashboard Server Components that revalidate frequently.
 */
export async function getCachedZoneSummaries(
  siteId: string
): Promise<ZoneSummary[]> {
  const supabase = createServerClient();

  // Load zones and cached risk scores in parallel
  const [zones, { data: scores }] = await Promise.all([
    getZonesForSite(siteId),
    supabase
      .from("risk_scores")
      .select("*")
      .eq("site_id", siteId)
      .not("zone_id", "is", null)   // exclude site-level roll-up rows
      .order("computed_at", { ascending: false }),
  ]);

  if (!zones.length) return [];

  // Build a quick lookup of latest score per zone
  const scoreByZone = new Map<string, typeof scores extends (infer T)[] | null ? T : never>();
  for (const score of scores ?? []) {
    const s = score as { zone_id: string; [key: string]: unknown };
    if (s.zone_id && !scoreByZone.has(s.zone_id)) {
      scoreByZone.set(s.zone_id, s as never);
    }
  }

  return zones.map((zone) => {
    const rs = scoreByZone.get(zone.id) as {
      status: ZoneRiskStatus;
      composite_score: number;
      open_ticket_count: number;
      overdue_obligation_count: number;
      oos_asset_count: number;
      active_event_count: number;
      event_conflict_score: number;
      computed_at: string;
    } | undefined;

    return {
      zone,
      status: rs?.status ?? "green",
      composite_score: rs?.composite_score ?? 0,
      open_tickets: rs?.open_ticket_count ?? 0,
      critical_tickets: 0,
      overdue_obligations: rs?.overdue_obligation_count ?? 0,
      due_soon_obligations: 0,
      oos_assets: rs?.oos_asset_count ?? 0,
      active_event_conflicts:
        (rs?.active_event_count ?? 0) > 0 &&
        (rs?.event_conflict_score ?? 0) > 0
          ? 1
          : 0,
      primary_risk: null,
      last_computed_at: rs?.computed_at ?? null,
    };
  });
}

// ── Site-level summary ────────────────────────────────────────────────────────

/**
 * Assembles a SiteSummary that includes zone summaries + site-wide roll-up.
 * Reads from the risk_scores cache — call getZoneSummaries() first to warm it.
 */
export async function getSiteSummary(
  siteId: string,
  siteName = process.env.VENUE_NAME ?? "Your Venue"
): Promise<SiteSummary> {
  const supabase = createServerClient();

  const [zoneSummaries, { data: siteScore }] = await Promise.all([
    getCachedZoneSummaries(siteId),
    supabase
      .from("risk_scores")
      .select("*")
      .eq("site_id", siteId)
      .is("zone_id", null)
      .single(),
  ]);

  const rs = siteScore as {
    status: ZoneRiskStatus;
    composite_score: number;
    open_ticket_count: number;
    overdue_obligation_count: number;
    oos_asset_count: number;
    computed_at: string;
  } | null;

  // Derive overall status as the worst among all zones
  const worstStatus: ZoneRiskStatus = zoneSummaries.reduce<ZoneRiskStatus>(
    (worst, zs) => {
      if (zs.status === "red") return "red";
      if (zs.status === "amber" && worst !== "red") return "amber";
      return worst;
    },
    "green"
  );

  return {
    site: {
      id: siteId,
      name: siteName,
      site_type: "restaurant",
      address: null,
      city: "Cape Town",
      country: "ZA",
      timezone: "Africa/Johannesburg",
      is_active: true,
      metadata_json: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    overall_status: rs?.status ?? worstStatus,
    zone_summaries: zoneSummaries,
    total_open_tickets: zoneSummaries.reduce((s, z) => s + z.open_tickets, 0),
    total_overdue_obligations: zoneSummaries.reduce(
      (s, z) => s + z.overdue_obligations,
      0
    ),
    total_oos_assets: zoneSummaries.reduce((s, z) => s + z.oos_assets, 0),
    computed_at: rs?.computed_at ?? new Date().toISOString(),
  };
}

// ── Latest snapshot trend ─────────────────────────────────────────────────────

/**
 * Returns the last N snapshots for a zone, ordered newest-first.
 * Use for trend sparklines on each zone card.
 */
export async function getZoneSnapshotHistory(
  zoneId: string,
  limit = 14
): Promise<Array<{ status: ZoneRiskStatus; composite_score: number; snapped_at: string }>> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("zone_snapshots")
    .select("status, composite_score, snapped_at")
    .eq("zone_id", zoneId)
    .order("snapped_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[universal/zoneSummary] getZoneSnapshotHistory:", error.message);
    return [];
  }

  return (data ?? []) as Array<{
    status: ZoneRiskStatus;
    composite_score: number;
    snapped_at: string;
  }>;
}
