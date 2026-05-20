/**
 * POST /api/system-health/micros/backfill
 *
 * Triggers a backfill for a given location over a date range (max 30 days).
 * Requires RUN_INTEGRATION_SYNC permission.
 * Runs synchronously (server waits for completion) — use small ranges only.
 *
 * Body: { locationKey: string, fromDate: string, toDate: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard }                  from "@/lib/auth/api-guard";
import { PERMISSIONS }               from "@/lib/rbac/roles";
import { getLocationConfig }         from "@/lib/micros/micros-location-registry";
import { runLocationSync }           from "@/services/micros/location-sync";
import { logger }                    from "@/lib/logger";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const MAX_DAYS = 30;

function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const end = new Date(to);
  while (cur <= end && dates.length < MAX_DAYS) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/system-health/micros/backfill");
  if (guard.error) return guard.error;

  let body: { locationKey?: string; fromDate?: string; toDate?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { locationKey, fromDate, toDate } = body;
  if (!locationKey || !fromDate || !toDate) {
    return NextResponse.json({ error: "locationKey, fromDate, toDate required" }, { status: 400 });
  }

  let cfg: ReturnType<typeof getLocationConfig>;
  try { cfg = getLocationConfig(locationKey as Parameters<typeof getLocationConfig>[0]); }
  catch { return NextResponse.json({ error: `Unknown location: ${locationKey}` }, { status: 400 }); }

  if (!cfg.configured || !cfg.enabled) {
    return NextResponse.json({ error: "Location not configured" }, { status: 422 });
  }

  const dates = dateRange(fromDate, toDate);
  if (dates.length === 0) {
    return NextResponse.json({ error: "No valid dates in range" }, { status: 400 });
  }

  const results: { date: string; success: boolean; message: string }[] = [];

  for (const date of dates) {
    try {
      const r = await runLocationSync(cfg, date);
      results.push({ date, success: r.success, message: r.message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ date, success: false, message: msg });
      logger.warn("[Backfill] Date failed", { locationKey, date, err: msg });
    }
  }

  const ok    = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  logger.info("[Backfill] Complete", { locationKey, fromDate, toDate, ok, failed });
  return NextResponse.json({ ok: true, locationKey, fromDate, toDate, results, succeeded: ok, failed });
}
