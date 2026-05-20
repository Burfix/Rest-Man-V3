/**
 * GET /api/incidents/sla-summary
 *
 * Returns SLA metrics, operational queues, and MTTR aggregates for
 * all incidents visible to the current user.
 *
 * Access: operational roles — super_admin, executive, head_office,
 *         area_manager, gm, supervisor, auditor.
 * Excludes: contractor, viewer (no system-health access).
 *
 * Visibility rules:
 *   - Site operators see only their accessible siteIds.
 *   - HQ/admin see all siteIds from their UserContext.
 *   - Platform-level incidents (site_id IS NULL) are visible to all.
 *
 * Response queues are capped at 20 rows each.
 * MTTR aggregates cover the last 30 days.
 */

import { NextResponse }                    from "next/server";
import { createClient }                    from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import {
  getIncidentSlaState,
  calculateTimeToAcknowledge,
  calculateTimeToResolve,
} from "@/lib/incidents/sla";
import { logger }                          from "@/lib/logger";

export const dynamic = "force-dynamic";

// ── Role access ───────────────────────────────────────────────────────────────

const SLA_VIEW_ROLES = new Set([
  "super_admin", "executive", "head_office",
  "area_manager", "gm", "supervisor", "auditor",
]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IncidentSlaRow {
  id:                    string;
  siteId:                string | null;
  source:                string;
  severity:              "info" | "warning" | "critical";
  summary:               string;
  status:                string;
  escalationLevel:       "normal" | "elevated" | "urgent";
  createdAt:             string;
  acknowledgedAt:        string | null;
  resolvedAt:            string | null;
  assignedTo:            string | null;
  // SLA computed fields
  ageMinutes:            number;
  ackBreached:           boolean;
  resolutionBreached:    boolean;
  slaStatus:             "within_sla" | "ack_breached" | "resolution_breached" | "resolved";
  recommendedEscalation: "normal" | "elevated" | "urgent";
}

export interface SlaSummaryResponse {
  ok:          boolean;
  generatedAt: string;
  summary: {
    openCount:               number;
    unassignedCount:         number;
    ackBreachedCount:        number;
    resolutionBreachedCount: number;
    urgentCount:             number;
    avgTimeToAckMinutes:     number | null;
    avgMttrMinutes:          number | null;
  };
  queues: {
    needsAck:    IncidentSlaRow[];
    breached:    IncidentSlaRow[];
    assignedToMe: IncidentSlaRow[];
    unresolved:  IncidentSlaRow[];
  };
  mttrBySite:   Array<{ siteId: string; siteName: string; avgMttrMinutes: number; resolvedCount: number }>;
  mttrBySource: Array<{ source: string; avgMttrMinutes: number; resolvedCount: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  ) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Apply site-visibility filter to a Supabase query. */
function withVisibility(query: any, siteIds: string[]) {
  if (siteIds.length === 0) return query.is("site_id", null);
  return query.or(`site_id.is.null,site_id.in.(${siteIds.join(",")})`);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function mapRow(row: any): IncidentSlaRow {
  const slaState = getIncidentSlaState({
    severity:       row.severity,
    status:         row.status,
    createdAt:      row.created_at,
    resolvedAt:     row.resolved_at  ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
    escalationLevel: row.escalation_level ?? "normal",
  });
  return {
    id:                    row.id,
    siteId:                row.site_id ?? null,
    source:                row.source,
    severity:              row.severity,
    summary:               row.summary,
    status:                row.status,
    escalationLevel:       row.escalation_level ?? "normal",
    createdAt:             row.created_at,
    acknowledgedAt:        row.acknowledged_at ?? null,
    resolvedAt:            row.resolved_at ?? null,
    assignedTo:            row.assigned_to ?? null,
    ageMinutes:            Math.round(slaState.ageMinutes),
    ackBreached:           slaState.ackBreached,
    resolutionBreached:    slaState.resolutionBreached,
    slaStatus:             slaState.slaStatus,
    recommendedEscalation: slaState.recommendedEscalation,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!SLA_VIEW_ROLES.has(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { siteIds, userId } = ctx;
  const db                  = serviceDb();
  const now                 = Date.now();
  const thirtyDaysAgo       = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // ── Parallel queries ────────────────────────────────────────────────────

    const INCIDENT_SELECT =
      "id, site_id, source, severity, summary, status, " +
      "created_at, resolved_at, acknowledged_at, assigned_to, escalation_level, updated_at";

    // 1. All active (unresolved) incidents in visible sites
    const activeQuery = withVisibility(
      db.from("system_incidents")
        .select(INCIDENT_SELECT)
        .in("status", ["open", "acknowledged", "investigating"])
        .order("created_at", { ascending: false })
        .limit(200),
      siteIds,
    );

    // 2. Resolved incidents in last 30 days for MTTR/ack-time analytics
    const resolvedQuery = withVisibility(
      db.from("system_incidents")
        .select(INCIDENT_SELECT)
        .eq("status", "resolved")
        .gte("resolved_at", thirtyDaysAgo)
        .order("resolved_at", { ascending: false })
        .limit(500),
      siteIds,
    );

    // 3. Site names for MTTR-by-site display
    const sitesQuery = siteIds.length > 0
      ? db.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [] });

    const [activeRes, resolvedRes, sitesRes] = await Promise.all([
      activeQuery,
      resolvedQuery,
      sitesQuery,
    ]);

    const activeRows:   any[] = activeRes.data   ?? [];
    const resolvedRows: any[] = resolvedRes.data  ?? [];
    const siteRows:     any[] = sitesRes.data     ?? [];

    // ── Site name map ───────────────────────────────────────────────────────
    const siteNameMap = new Map<string, string>(
      siteRows.map((s: any) => [s.id, s.name]),
    );

    // ── Map rows to IncidentSlaRow ──────────────────────────────────────────
    const activeSlaRows    = activeRows.map(mapRow);
    const resolvedSlaRows  = resolvedRows.map(mapRow);

    // ── Summary counts ──────────────────────────────────────────────────────
    const ackBreachedCount        = activeSlaRows.filter(r => r.ackBreached).length;
    const resolutionBreachedCount = activeSlaRows.filter(r => r.resolutionBreached).length;
    const urgentCount             = activeSlaRows.filter(r => r.recommendedEscalation === "urgent").length;
    const unassignedCount         = activeSlaRows.filter(r => !r.assignedTo).length;

    // ── Avg time-to-ack (from any acked incident, active or resolved) ───────
    const allAcked = [...activeRows, ...resolvedRows].filter(r => r.acknowledged_at);
    const ackTimes = allAcked.map(r =>
      calculateTimeToAcknowledge({
        createdAt:      r.created_at,
        acknowledgedAt: r.acknowledged_at,
      }) ?? 0,
    );

    // ── Avg MTTR ────────────────────────────────────────────────────────────
    const mttrTimes = resolvedRows
      .filter((r: any) => r.resolved_at)
      .map((r: any) =>
        calculateTimeToResolve({
          createdAt:  r.created_at,
          resolvedAt: r.resolved_at,
        }) ?? 0,
      );

    // ── Queues ──────────────────────────────────────────────────────────────
    const needsAck    = activeSlaRows
      .filter(r => !r.acknowledgedAt)
      .sort((a, b) => b.ageMinutes - a.ageMinutes)
      .slice(0, 20);

    const breached    = activeSlaRows
      .filter(r => r.ackBreached || r.resolutionBreached)
      .sort((a, b) => b.ageMinutes - a.ageMinutes)
      .slice(0, 20);

    const assignedToMe = activeSlaRows
      .filter(r => r.assignedTo === userId)
      .sort((a, b) => b.ageMinutes - a.ageMinutes)
      .slice(0, 20);

    const unresolved  = activeSlaRows
      .sort((a, b) => b.ageMinutes - a.ageMinutes)
      .slice(0, 20);

    // ── MTTR by site ────────────────────────────────────────────────────────
    const bySite = new Map<string, number[]>();
    for (const row of resolvedRows) {
      if (!row.resolved_at || !row.site_id) continue;
      const mttr = calculateTimeToResolve({ createdAt: row.created_at, resolvedAt: row.resolved_at }) ?? 0;
      if (!bySite.has(row.site_id)) bySite.set(row.site_id, []);
      bySite.get(row.site_id)!.push(mttr);
    }
    const mttrBySite = Array.from(bySite.entries())
      .map(([siteId, times]) => ({
        siteId,
        siteName:       siteNameMap.get(siteId) ?? siteId,
        avgMttrMinutes: avg(times) ?? 0,
        resolvedCount:  times.length,
      }))
      .sort((a, b) => b.avgMttrMinutes - a.avgMttrMinutes);

    // ── MTTR by source ──────────────────────────────────────────────────────
    const bySource = new Map<string, number[]>();
    for (const row of resolvedRows) {
      if (!row.resolved_at) continue;
      const mttr = calculateTimeToResolve({ createdAt: row.created_at, resolvedAt: row.resolved_at }) ?? 0;
      if (!bySource.has(row.source)) bySource.set(row.source, []);
      bySource.get(row.source)!.push(mttr);
    }
    const mttrBySource = Array.from(bySource.entries())
      .map(([source, times]) => ({
        source,
        avgMttrMinutes: avg(times) ?? 0,
        resolvedCount:  times.length,
      }))
      .sort((a, b) => b.avgMttrMinutes - a.avgMttrMinutes);

    // ── Response ────────────────────────────────────────────────────────────
    const response: SlaSummaryResponse = {
      ok:          true,
      generatedAt: new Date(now).toISOString(),
      summary: {
        openCount:               activeSlaRows.length,
        unassignedCount,
        ackBreachedCount,
        resolutionBreachedCount,
        urgentCount,
        avgTimeToAckMinutes:     avg(ackTimes),
        avgMttrMinutes:          avg(mttrTimes),
      },
      queues: { needsAck, breached, assignedToMe, unresolved },
      mttrBySite,
      mttrBySource,
    };

    logger.info("api.incidents.sla_summary.ok", {
      role:             ctx.role,
      siteCount:        siteIds.length,
      openCount:        activeSlaRows.length,
      ackBreachedCount,
    });

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" },
    });

  } catch (err) {
    logger.error("api.incidents.sla_summary.failed", { err: String(err) });
    return NextResponse.json(
      { error: "Failed to compute SLA summary" },
      { status: 500 },
    );
  }
}
