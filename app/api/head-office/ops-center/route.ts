/**
 * GET /api/head-office/ops-center
 *
 * Multi-site operational reliability layer for the Head Office NOC.
 *
 * Aggregates, per visible site:
 *   - Reliability score + A/B/C/D grade (from micros_sync_runs history)
 *   - Per-feed health (sales, labour, inventory)
 *   - Lightweight alert summary (staleness + consecutive failures)
 *   - Basic health status (from v_site_health_summary)
 *
 * Deliberately does NOT call resolveOperationalContext() per site —
 * that requires N full data fetches and is correct for single-site views.
 * For the head-office NOC at scale, we derive alerts from stale_minutes
 * (already computed by v_site_health_summary) + reliability feed data.
 *
 * Access: head_office | super_admin | executive | area_manager | tenant_owner
 */

import { NextResponse }                  from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { computeReliabilityScore }       from "@/lib/reliability/score";
import type { ReliabilityGrade }         from "@/lib/reliability/score";
import { logger }                        from "@/lib/logger";
import { getServiceRoleClient }          from "@/lib/supabase/service-role-client";
import { ELEVATED_ROLES }                from "@/lib/rbac/roles";
import {
  deriveAlertSummary,
  type SiteAlertSummary,
} from "@/lib/observability/platform-health";

export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SiteFeedHealth {
  feedType: "sales" | "labour" | "inventory";
  score: number;
  consecutiveFailures: number;
  minutesSinceSuccess: number | null;
}

export interface SiteOpsRow {
  siteId: string;
  siteName: string;
  siteCode: string;
  reliabilityScore: number;
  reliabilityGrade: ReliabilityGrade;
  feeds: SiteFeedHealth[];
  alerts: SiteAlertSummary;
  health: "healthy" | "warning" | "critical" | "unknown";
  lastSyncAt: string | null;
  staleMinutes: number | null;
}

export interface GroupOpsMetrics {
  avgReliability: number;
  gradeCounts: Record<ReliabilityGrade, number>;
  criticalSites: number;
  warningSites: number;
  totalAlerts: { critical: number; warning: number };
  sitesWithActiveSyncing: number;
}

export interface OpsCenterPayload {
  ok: boolean;
  generatedAt: string;
  sites: SiteOpsRow[];
  group: GroupOpsMetrics;
}

// ── Service-role client ───────────────────────────────────────────────────────

function serviceDb() {
  return getServiceRoleClient();
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!ELEVATED_ROLES.has(ctx.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const generatedAt = new Date().toISOString();

  try {
    // ── Resolve visible org IDs ───────────────────────────────────────────────
    const { data: roleRows } = await db
      .from("user_roles")
      .select("organisation_id")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .in("role", Array.from(ELEVATED_ROLES));

    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    // ── Fetch all site health rows ────────────────────────────────────────────
    const q = db
      .from("v_site_health_summary")
      .select(
        "site_id, store_name, store_code, health, last_sync_at, stale_minutes, integration_status",
      )
      .eq("is_active", true)
      .order("health", { ascending: true });

    if (ctx.role !== "super_admin" && orgIds.length > 0) {
      q.in("org_id", orgIds);
    }

    const { data: healthRows, error: healthErr } = await q;
    if (healthErr) {
      logger.error("api.ops-center.health-query-failed", { err: healthErr.message });
      return NextResponse.json({ ok: false, error: healthErr.message }, { status: 500 });
    }

    const rows: Array<{
      site_id: string;
      store_name: string;
      store_code: string;
      health: string;
      last_sync_at: string | null;
      stale_minutes: number | null;
    }> = (healthRows ?? []);

    // ── Per-site reliability scoring in parallel ──────────────────────────────
    const reliabilityResults = await Promise.allSettled(
      rows.map((r) => computeReliabilityScore(r.site_id, 7)),
    );

    // ── Assemble site rows ────────────────────────────────────────────────────
    const sites: SiteOpsRow[] = rows.map((row, i) => {
      const reliabilityResult = reliabilityResults[i];
      const reliability =
        reliabilityResult.status === "fulfilled"
          ? reliabilityResult.value
          : { overall: 0, grade: "D" as ReliabilityGrade, feeds: [], siteId: row.site_id, computedAt: new Date().toISOString(), windowDays: 7 };

      const feeds: SiteFeedHealth[] = reliability.feeds.map((f) => ({
        feedType:            f.feedType,
        score:               f.score,
        consecutiveFailures: f.consecutiveFailures,
        minutesSinceSuccess: f.minutesSinceSuccess,
      }));

      const alerts = deriveAlertSummary(row.stale_minutes, row.health, reliability.feeds);

      return {
        siteId:            row.site_id,
        siteName:          row.store_name,
        siteCode:          row.store_code,
        reliabilityScore:  reliability.overall,
        reliabilityGrade:  reliability.grade,
        feeds,
        alerts,
        health:            (row.health as SiteOpsRow["health"]) ?? "unknown",
        lastSyncAt:        row.last_sync_at,
        staleMinutes:      row.stale_minutes,
      };
    });

    // ── Group metrics ─────────────────────────────────────────────────────────
    const gradeCounts: Record<ReliabilityGrade, number> = { A: 0, B: 0, C: 0, D: 0 };
    let totalCritical = 0;
    let totalWarning  = 0;
    let criticalSites = 0;
    let warningSites  = 0;
    let reliabilitySum = 0;

    for (const site of sites) {
      gradeCounts[site.reliabilityGrade]++;
      totalCritical += site.alerts.critical;
      totalWarning  += site.alerts.warning;
      if (site.health === "critical" || site.alerts.critical > 0) criticalSites++;
      else if (site.health === "warning" || site.alerts.warning > 0) warningSites++;
      reliabilitySum += site.reliabilityScore;
    }

    const group: GroupOpsMetrics = {
      avgReliability:       sites.length > 0 ? Math.round(reliabilitySum / sites.length) : 0,
      gradeCounts,
      criticalSites,
      warningSites,
      totalAlerts:          { critical: totalCritical, warning: totalWarning },
      sitesWithActiveSyncing: sites.filter((s) => s.reliabilityScore > 0).length,
    };

    const payload: OpsCenterPayload = { ok: true, generatedAt, sites, group };

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error("api.ops-center.failed", { err: String(err) });
    return NextResponse.json({ ok: false, error: "Ops center query failed" }, { status: 500 });
  }
}
