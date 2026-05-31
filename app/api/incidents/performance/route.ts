/**
 * GET /api/incidents/performance?days=30
 *
 * Returns performance analytics for all incidents visible to the current user
 * over the requested lookback period (7–90 days, default 30).
 *
 * Computation is done entirely in TypeScript from raw DB rows — no DB-side
 * aggregation, keeping all analytics logic testable in lib/incidents/analytics.ts.
 *
 * Access: super_admin, executive, head_office, area_manager, gm, supervisor, auditor
 */

import { NextRequest, NextResponse }                from "next/server";
import { getUserContext, authErrorResponse }         from "@/lib/auth/get-user-context";
import {
  computePerformanceMetrics,
  type IncidentForAnalytics,
  type PerformanceMetrics,
} from "@/lib/incidents/analytics";
import { logger }                                   from "@/lib/logger";
import { getServiceRoleClient }                     from "@/lib/supabase/service-role-client";

export const dynamic = "force-dynamic";

// ── Access ─────────────────────────────────────────────────────────────────────

const PERF_VIEW_ROLES = new Set([
  "super_admin", "executive", "head_office",
  "area_manager", "gm", "supervisor", "auditor",
]);

// ── DB helpers ─────────────────────────────────────────────────────────────────

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

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!PERF_VIEW_ROLES.has(ctx.role ?? "")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // ── Query param ─────────────────────────────────────────────────────────────
  const url       = new URL(req.url);
  const daysParam = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days      = Math.max(1, Math.min(90, isNaN(daysParam) ? 30 : daysParam));

  const { siteIds } = ctx;
  const db          = serviceDb();
  const now         = Date.now();
  const cutoff      = new Date(now - days * 86_400_000).toISOString();

  try {
    // ── Parallel queries ──────────────────────────────────────────────────────

    const incidentsQuery = withVisibility(
      db.from("system_incidents")
        .select(ANALYTICS_SELECT)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1000),
      siteIds,
    );

    const sitesQuery = siteIds.length > 0
      ? db.from("sites").select("id, name").in("id", siteIds)
      : Promise.resolve({ data: [] });

    const [incRes, sitesRes] = await Promise.all([incidentsQuery, sitesQuery]);

    const rows:     any[] = incRes.data    ?? [];
    const siteRows: any[] = sitesRes.data  ?? [];

    // ── Build inputs ──────────────────────────────────────────────────────────

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

    // ── Compute ───────────────────────────────────────────────────────────────

    const metrics: PerformanceMetrics = computePerformanceMetrics(
      incidents,
      siteNameMap,
      days,
      now,
    );

    logger.info("api.incidents.performance.ok", {
      role:         ctx.role,
      days,
      incidentCount: incidents.length,
    });

    return NextResponse.json(
      { ok: true, generatedAt: new Date(now).toISOString(), ...metrics },
      { headers: { "Cache-Control": "no-store" } },
    );

  } catch (err) {
    logger.error("api.incidents.performance.failed", { err: String(err) });
    return NextResponse.json(
      { error: "Failed to compute performance metrics" },
      { status: 500 },
    );
  }
}
