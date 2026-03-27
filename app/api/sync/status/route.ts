/**
 * GET /api/sync/status
 *
 * Returns sync health for each sync type per site.
 * Used by the SyncHealthCard UI component.
 *
 * Response shape:
 * {
 *   site: { id, name },
 *   types: {
 *     sales:     { status, lastRunAt, lastSuccessAt, durationMs, error?, freshness },
 *     labour:    { ... },
 *     inventory: { ... },
 *   }
 * }
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface TypeStatus {
  status: "healthy" | "stale" | "failed" | "never";
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastRunStatus: string | null;
  durationMs: number | null;
  error: string | null;
  /** Minutes since last successful sync */
  freshnessMinutes: number | null;
}

const SYNC_TYPES = ["sales", "labour", "inventory"] as const;
const STALE_THRESHOLD_MINUTES = 120; // 2 hours

export async function GET() {
  const guard = await apiGuard(null, "GET /api/sync/status");
  if (guard.error) return guard.error;

  const siteId = guard.ctx!.siteId;
  if (!siteId) {
    return NextResponse.json({ error: "No site context" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Fetch latest run per sync type for this site
  const types: Record<string, TypeStatus> = {};

  interface SyncRunRow {
    id: string;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    duration_ms: number | null;
    error_message: string | null;
  }

  for (const syncType of SYNC_TYPES) {
    // Latest run (any status)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latestRun } = await (supabase
      .from("sync_runs") as any)
      .select("id, status, started_at, completed_at, duration_ms, error_message")
      .eq("site_id", siteId)
      .eq("sync_type", syncType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() as { data: SyncRunRow | null };

    // Latest successful run
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lastSuccess } = await (supabase
      .from("sync_runs") as any)
      .select("completed_at")
      .eq("site_id", siteId)
      .eq("sync_type", syncType)
      .in("status", ["success", "partial"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() as { data: { completed_at: string } | null };

    if (!latestRun) {
      types[syncType] = {
        status: "never",
        lastRunAt: null,
        lastSuccessAt: null,
        lastRunStatus: null,
        durationMs: null,
        error: null,
        freshnessMinutes: null,
      };
      continue;
    }

    const lastSuccessAt = lastSuccess?.completed_at ?? null;
    let freshnessMinutes: number | null = null;
    let healthStatus: "healthy" | "stale" | "failed" = "healthy";

    if (lastSuccessAt) {
      freshnessMinutes = Math.floor(
        (Date.now() - new Date(lastSuccessAt).getTime()) / 60_000,
      );
      if (freshnessMinutes > STALE_THRESHOLD_MINUTES) {
        healthStatus = "stale";
      }
    }

    if (latestRun.status === "error") {
      healthStatus = "failed";
    }

    types[syncType] = {
      status: healthStatus,
      lastRunAt: latestRun.started_at,
      lastSuccessAt,
      lastRunStatus: latestRun.status,
      durationMs: latestRun.duration_ms,
      error: latestRun.error_message,
      freshnessMinutes,
    };
  }

  // Get site name
  const { data: site } = await supabase
    .from("sites")
    .select("id, name")
    .eq("id", siteId)
    .maybeSingle();

  return NextResponse.json({
    site: site ?? { id: siteId, name: "Unknown" },
    types,
  });
}
