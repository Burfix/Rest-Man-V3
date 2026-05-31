/**
 * GET /api/incidents/weekly-report
 *
 * Compact 7-day executive summary — total incidents, SLA compliance rate,
 * avg MTTR, worst site, worst source, and breach details.
 *
 * Designed to be machine-readable (for future email/export pipelines) and
 * human-readable (for the executive summary card in the UI).
 *
 * Access: super_admin, executive, head_office, area_manager, gm, supervisor, auditor
 */

import { NextResponse }                             from "next/server";
import { getUserContext, authErrorResponse }         from "@/lib/auth/get-user-context";
import {
  computeWeeklySummary,
  type IncidentForAnalytics,
  type WeeklySummary,
} from "@/lib/incidents/analytics";
import { logger }                                   from "@/lib/logger";
import { getServiceRoleClient }                     from "@/lib/supabase/service-role-client";

export const dynamic = "force-dynamic";

const REPORT_VIEW_ROLES = new Set([
  "super_admin", "executive", "head_office",
  "area_manager", "gm", "supervisor", "auditor",
]);

function serviceDb() {
  return getServiceRoleClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function withVisibility(query: any, siteIds: string[]) {
  if (siteIds.length === 0) return query.is("site_id", null);
  return query.or(`site_id.is.null,site_id.in.(${siteIds.join(",")})`);
}

const ANALYTICS_SELECT =
  "id, site_id, source, severity, status, " +
  "created_at, resolved_at, acknowledged_at, assigned_to, escalation_level";

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!REPORT_VIEW_ROLES.has(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const { siteIds } = ctx;
  const db          = serviceDb();
  const now         = Date.now();
  const cutoff      = new Date(now - 7 * 86_400_000).toISOString();

  try {
    const incidentsQuery = withVisibility(
      db.from("system_incidents")
        .select(ANALYTICS_SELECT)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(500),
      siteIds,
    );

    const sitesQuery = siteIds.length > 0
      ? db.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [] });

    const [incRes, sitesRes] = await Promise.all([incidentsQuery, sitesQuery]);

    const rows:     any[] = incRes.data   ?? [];
    const siteRows: any[] = sitesRes.data ?? [];

    const siteNameMap = new Map<string, string>(
      siteRows.map((s: any) => [s.id, s.name]),
    );

    const incidents: IncidentForAnalytics[] = rows.map((r: any) => ({
      id:              r.id,
      siteId:          r.site_id          ?? null,
      source:          r.source,
      severity:        r.severity,
      status:          r.status,
      createdAt:       r.created_at,
      resolvedAt:      r.resolved_at      ?? null,
      acknowledgedAt:  r.acknowledged_at  ?? null,
      assignedTo:      r.assigned_to      ?? null,
      escalationLevel: r.escalation_level ?? "normal",
    }));

    const summary: WeeklySummary = computeWeeklySummary(incidents, siteNameMap, now);

    logger.info("api.incidents.weekly_report.ok", {
      role:         ctx.role,
      totalIncidents: summary.totalIncidents,
      compliance:     summary.slaComplianceRate,
    });

    return NextResponse.json(
      { ok: true, generatedAt: new Date(now).toISOString(), report: summary },
      { headers: { "Cache-Control": "no-store" } },
    );

  } catch (err) {
    logger.error("api.incidents.weekly_report.failed", { err: String(err) });
    return NextResponse.json(
      { error: "Failed to generate weekly report" },
      { status: 500 },
    );
  }
}
