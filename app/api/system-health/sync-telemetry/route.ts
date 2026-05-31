/**
 * GET /api/system-health/sync-telemetry
 *
 * Exposes micros_sync_runs history as a structured telemetry payload for
 * the System Health dashboard and head office reporting.
 *
 * Returns per-feed stats for the caller's site:
 *   - Last run timestamp and status
 *   - 7-day success rate
 *   - Average duration
 *   - Recent failure list (up to 5)
 *   - Per-site reliability score
 *
 * Access: super_admin | head_office | executive | auditor | area_manager
 */

import { NextResponse }            from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { computeReliabilityScore } from "@/lib/reliability/score";
import { logger }                  from "@/lib/logger";
import { getServiceRoleClient }    from "@/lib/supabase/service-role-client";
import { ELEVATED_ROLES }          from "@/lib/rbac/roles";
import { jsonCompatSuccess, jsonCompatError } from "@/lib/api/response";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 7;

// ── Types ────────────────────────────────────────────────────────────────────

interface RecentRun {
  runId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  recordsFetched: number;
  recordsWritten: number;
  errorMessage: string | null;
}

interface FeedTelemetry {
  feedType: "sales" | "labour" | "inventory";
  lastRunAt: string | null;
  lastRunStatus: string | null;
  successRatePct: number;
  avgDurationMs: number | null;
  totalRuns: number;
  recentFailures: RecentRun[];
}

interface SyncTelemetryPayload {
  ok: boolean;
  generatedAt: string;
  siteId: string;
  windowDays: number;
  reliability: {
    overall: number;
    grade: string;
  };
  feeds: FeedTelemetry[];
}

// ── Service-role client ───────────────────────────────────────────────────────

function serviceDb() {
  return getServiceRoleClient();
}

// ── Sync type buckets ─────────────────────────────────────────────────────────

const SYNC_TYPE_MAP: Record<FeedTelemetry["feedType"], string[]> = {
  sales:     ["daily_totals", "full", "sales"],
  labour:    ["labor", "labour"],
  inventory: ["inventory"],
};

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!ELEVATED_ROLES.has(ctx.role)) {
    return jsonCompatError(
      { ok: false },
      "FORBIDDEN",
      "Insufficient permissions",
      { status: 403 },
    );
  }

  const { siteId } = ctx;
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const db = serviceDb();

    // Fetch runs for this site via micros_connections join
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (db as any)
      .from("micros_sync_runs")
      .select([
        "id",
        "sync_type",
        "status",
        "started_at",
        "completed_at",
        "records_fetched",
        "records_inserted",
        "error_message",
        "metadata",
        "micros_connections!inner(site_id)",
      ].join(", "))
      .eq("micros_connections.site_id", siteId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(500);

    if (error) {
      logger.warn("api.sync-telemetry.query-error", { siteId, error: error.message });
    }

    const allRuns: Array<{
      id: string;
      sync_type: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      records_fetched: number;
      records_inserted: number;
      error_message: string | null;
    }> = (rows ?? []).map((r: any) => ({
      id:               r.id,
      sync_type:        r.sync_type,
      status:           r.status,
      started_at:       r.started_at,
      completed_at:     r.completed_at ?? null,
      records_fetched:  r.records_fetched ?? 0,
      records_inserted: r.records_inserted ?? 0,
      error_message:    r.error_message ?? null,
    }));

    // Compute per-feed stats
    const feeds: FeedTelemetry[] = (
      ["sales", "labour", "inventory"] as FeedTelemetry["feedType"][]
    ).map((feedType) => {
      const matchTypes = new Set(SYNC_TYPE_MAP[feedType]);
      const feedRuns = allRuns.filter((r) => matchTypes.has(r.sync_type));
      const terminal = feedRuns.filter((r) => r.status !== "running");
      const successes = terminal.filter((r) => r.status === "success" || r.status === "partial");

      // Duration (from rows that have both timestamps)
      const withDuration = terminal.filter((r) => r.completed_at);
      const avgDurationMs = withDuration.length > 0
        ? Math.round(
            withDuration.reduce((sum, r) =>
              sum + new Date(r.completed_at!).getTime() - new Date(r.started_at).getTime(), 0,
            ) / withDuration.length,
          )
        : null;

      const lastRun = feedRuns[0] ?? null;

      const recentFailures: RecentRun[] = terminal
        .filter((r) => r.status === "error")
        .slice(0, 5)
        .map((r) => ({
          runId:          r.id,
          status:         r.status,
          startedAt:      r.started_at,
          completedAt:    r.completed_at,
          durationMs:
            r.completed_at
              ? new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
              : null,
          recordsFetched: r.records_fetched,
          recordsWritten: r.records_inserted,
          errorMessage:   r.error_message,
        }));

      return {
        feedType,
        lastRunAt:      lastRun?.started_at ?? null,
        lastRunStatus:  lastRun?.status ?? null,
        successRatePct:
          terminal.length > 0
            ? Math.round((successes.length / terminal.length) * 1000) / 10
            : 0,
        avgDurationMs,
        totalRuns: feedRuns.length,
        recentFailures,
      };
    });

    // Reliability score (reads from same data source — reuses cached query internally)
    const reliability = await computeReliabilityScore(siteId, WINDOW_DAYS);

    const payload: SyncTelemetryPayload = {
      ok: true,
      generatedAt,
      siteId,
      windowDays: WINDOW_DAYS,
      reliability: {
        overall: reliability.overall,
        grade:   reliability.grade,
      },
      feeds,
    };

    return jsonCompatSuccess(payload as unknown as Record<string, unknown>, payload, {
      meta: { siteId },
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error("api.sync-telemetry.failed", { siteId, err: String(err) });
    return jsonCompatError(
      { ok: false },
      "INTERNAL_ERROR",
      "Failed to retrieve sync telemetry",
      { status: 500 },
    );
  }
}
