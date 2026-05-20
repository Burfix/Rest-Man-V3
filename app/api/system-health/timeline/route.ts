/**
 * GET /api/system-health/timeline
 *
 * Unified degradation and recovery timeline for a site.
 *
 * Merges three event sources into a single chronological stream:
 *   1. micros_sync_runs  — sync failures and recoveries (MICROS pipeline)
 *   2. system_incidents  — operator-created and auto-bridged incidents
 *   3. sync_events       — non-MICROS telemetry (from Tier-3C migration 089)
 *
 * Returns TimelineEvent[] sorted descending by timestamp.
 * Window: last 30 days; limit: 200 events.
 *
 * Access: super_admin | head_office | executive | auditor | area_manager | gm
 */

import { NextResponse }                  from "next/server";
import { createClient }                  from "@supabase/supabase-js";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { logger }                        from "@/lib/logger";

export const dynamic = "force-dynamic";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimelineEventType =
  | "sync_failure"
  | "sync_recovery"
  | "incident_opened"
  | "incident_resolved"
  | "stale_event";

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  source: "micros_sync_runs" | "system_incidents" | "sync_events";
  /** "sales" | "labour" | "inventory" | null */
  feedType: string | null;
  severity: "info" | "warning" | "critical";
  summary: string;
  timestamp: string;
  durationMs: number | null;
  metadata: Record<string, unknown>;
}

export interface TimelinePayload {
  ok: boolean;
  generatedAt: string;
  siteId: string;
  windowDays: number;
  events: TimelineEvent[];
  /** Counts per event type for summary badges */
  counts: Record<TimelineEventType, number>;
}

// ── Service client ────────────────────────────────────────────────────────────

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Feed type inference from sync_type ────────────────────────────────────────

function inferFeedType(syncType: string): string | null {
  if (["daily_totals", "full", "sales", "intraday_sales", "daily_sales"].includes(syncType)) return "sales";
  if (["labor", "labour"].includes(syncType)) return "labour";
  if (syncType === "inventory") return "inventory";
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────────

const WINDOW_DAYS = 30;
const EVENT_LIMIT = 200;

export async function GET() {
  let ctx: Awaited<ReturnType<typeof getUserContext>>;
  try {
    ctx = await getUserContext();
  } catch {
    return authErrorResponse();
  }

  const { siteId } = ctx;
  const since      = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const db         = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const events: TimelineEvent[] = [];

  // ── Source 1: micros_sync_runs failures + recoveries ─────────────────────
  try {
    const { data: runs, error } = await db
      .from("micros_sync_runs")
      .select([
        "id",
        "sync_type",
        "status",
        "started_at",
        "completed_at",
        "error_message",
        "records_fetched",
        "records_inserted",
        "micros_connections!inner(site_id)",
      ].join(", "))
      .eq("micros_connections.site_id", siteId)
      .gte("started_at", since)
      .in("status", ["error", "success", "partial"])
      .order("started_at", { ascending: false })
      .limit(300);

    if (error) {
      logger.warn("api.timeline.sync-runs-query-failed", { siteId, err: error.message });
    }

    for (const run of (runs ?? []) as any[]) {
      const isFailure = run.status === "error";
      const feedType  = inferFeedType(run.sync_type as string);
      const durationMs =
        run.completed_at
          ? new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
          : null;

      events.push({
        id:        `msr:${run.id}`,
        type:      isFailure ? "sync_failure" : "sync_recovery",
        source:    "micros_sync_runs",
        feedType,
        severity:  isFailure ? "critical" : "info",
        summary:   isFailure
          ? `${run.sync_type} sync failed: ${run.error_message ?? "unknown error"}`
          : `${run.sync_type} sync succeeded (${run.records_inserted ?? 0} records)`,
        timestamp: run.started_at,
        durationMs,
        metadata: {
          syncType:       run.sync_type,
          status:         run.status,
          recordsFetched: run.records_fetched,
          recordsInserted: run.records_inserted,
        },
      });
    }
  } catch (err) {
    logger.warn("api.timeline.sync-runs-error", { siteId, err: String(err) });
  }

  // ── Source 2: system_incidents ────────────────────────────────────────────
  try {
    const { data: incidents, error } = await db
      .from("system_incidents")
      .select("id, source, severity, summary, status, created_at, resolved_at, details")
      .or(`site_id.eq.${siteId},site_id.is.null`)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      logger.warn("api.timeline.incidents-query-failed", { siteId, err: error.message });
    }

    for (const inc of (incidents ?? []) as any[]) {
      const isResolved = inc.status === "resolved";

      // Emit "opened" event
      events.push({
        id:        `inc:${inc.id}:open`,
        type:      "incident_opened",
        source:    "system_incidents",
        feedType:  (inc.details?.ruleKey ? inferFeedType(inc.details.ruleKey as string) : null),
        severity:  inc.severity as TimelineEvent["severity"],
        summary:   inc.summary,
        timestamp: inc.created_at,
        durationMs: null,
        metadata:  { incidentId: inc.id, incidentSource: inc.source, status: inc.status },
      });

      // Emit "resolved" event if applicable
      if (isResolved && inc.resolved_at) {
        const durationMs =
          new Date(inc.resolved_at).getTime() - new Date(inc.created_at).getTime();
        events.push({
          id:        `inc:${inc.id}:resolved`,
          type:      "incident_resolved",
          source:    "system_incidents",
          feedType:  null,
          severity:  "info",
          summary:   `Incident resolved: ${inc.summary.slice(0, 80)}`,
          timestamp: inc.resolved_at,
          durationMs,
          metadata:  { incidentId: inc.id, resolutionTimeMs: durationMs },
        });
      }
    }
  } catch (err) {
    logger.warn("api.timeline.incidents-error", { siteId, err: String(err) });
  }

  // ── Source 3: sync_events (Tier-3C telemetry, migration 089) ─────────────
  try {
    const { data: syncEvts, error } = await db
      .from("sync_events")
      .select("id, integration, job_type, status, started_at, completed_at, error_code, message")
      .eq("site_id", siteId)
      .gte("started_at", since)
      .in("status", ["failed", "stale"])
      .order("started_at", { ascending: false })
      .limit(100);

    if (error) {
      logger.warn("api.timeline.sync-events-query-failed", { siteId, err: error.message });
    }

    for (const evt of (syncEvts ?? []) as any[]) {
      const durationMs =
        evt.completed_at
          ? new Date(evt.completed_at).getTime() - new Date(evt.started_at).getTime()
          : null;

      events.push({
        id:        `se:${evt.id}`,
        type:      "stale_event",
        source:    "sync_events",
        feedType:  evt.job_type as string,
        severity:  evt.status === "failed" ? "warning" : "info",
        summary:   evt.message ?? `${evt.integration} ${evt.job_type} ${evt.status}`,
        timestamp: evt.started_at,
        durationMs,
        metadata:  {
          integration: evt.integration,
          jobType:     evt.job_type,
          status:      evt.status,
          errorCode:   evt.error_code,
        },
      });
    }
  } catch (err) {
    logger.warn("api.timeline.sync-events-error", { siteId, err: String(err) });
  }

  // ── Sort + limit ──────────────────────────────────────────────────────────
  events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  const trimmed = events.slice(0, EVENT_LIMIT);

  // ── Counts ────────────────────────────────────────────────────────────────
  const counts: Record<TimelineEventType, number> = {
    sync_failure:       0,
    sync_recovery:      0,
    incident_opened:    0,
    incident_resolved:  0,
    stale_event:        0,
  };
  for (const e of trimmed) counts[e.type]++;

  const payload: TimelinePayload = {
    ok:          true,
    generatedAt: new Date().toISOString(),
    siteId,
    windowDays:  WINDOW_DAYS,
    events:      trimmed,
    counts,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
