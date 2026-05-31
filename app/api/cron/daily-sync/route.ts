/**
 * GET /api/cron/daily-sync
 *
 * Vercel-scheduled cron (0 0 * * * → midnight UTC / 2AM SAST).
 *
 * PRIMARY RESPONSIBILITY: enqueue `send_daily_report` async jobs for each
 * active site into async_job_queue. This is its correct, canonical role.
 *
 * ─── SYNC ENGINE OWNERSHIP ─────────────────────────────────────────────────
 *
 * ForgeStack has three MICROS sync engine generations:
 *
 *   V1 (ORPHANED)   → /api/sync/cron
 *                      Uses runSync(microsSalesAdapter) — NOT in vercel.json.
 *                      Not scheduled. Dead code. Safe to delete.
 *
 *   V2 (DEPRECATED) → this file (daily-sync, midnight UTC)
 *                      Directly calls runLocationSync() + runLabourDeltaSync().
 *                      These V2 calls are superseded by the V3 scheduler below.
 *
 *   V3 (CANONICAL)  → /api/cron/sync-orchestrator (2AM UTC)
 *                      Uses sync_schedules → sync_job_queue → scheduler/tick.
 *                      Handles: intraday_sales, daily_sales, guest_checks,
 *                               intervals, labour.
 *                      THIS is the correct sync ownership layer.
 *
 * ─── REMOVAL GATE FOR V2 CALLS ─────────────────────────────────────────────
 *
 * The runLocationSync() and runLabourDeltaSync() calls below (step 1) are
 * DEPRECATED. They will be removed once the following conditions are verified:
 *
 *   □  sync_schedules has rows for ALL live site connections
 *      (Primi Camps Bay, Si Cantina Sociale, Sea Castle Hotel)
 *   □  sync-orchestrator has been running successfully for ≥ 7 days
 *   □  v_site_health_summary shows no stale sites post-removal
 *
 * DO NOT remove these calls until the above gate conditions are confirmed.
 * To confirm: SELECT loc_ref, sync_type FROM sync_schedules WHERE is_active = true;
 *
 * ─── INTENDED FINAL STATE ──────────────────────────────────────────────────
 *
 * After V2 removal, daily-sync should contain ONLY step 2 (report enqueueing).
 * MICROS sync is fully owned by sync-orchestrator.
 *
 * Protected by Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { runLabourDeltaSync } from "@/services/micros/labour/sync";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { getLocationConfig, getAllLocationConfigs } from "@/lib/micros/micros-location-registry";
import { runLocationSync } from "@/services/micros/location-sync";
import { logger } from "@/lib/logger";
import { sendDailyReport } from "@/services/reports/dailyReport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

// â”€â”€ Thin cron enqueuer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function GET(req: NextRequest) {
  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Date in SAST (UTC+2)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  // ── 1. [DEPRECATED V2] Kick off intraday syncs per active MICROS connection
  //
  // REMOVAL GATE: Remove this block once sync_schedules has confirmed coverage
  // for ALL live sites AND sync-orchestrator has been stable for ≥ 7 days.
  // See module-level doc for gate conditions and SQL verification query.
  // DO NOT REMOVE without production DB confirmation.
  const cfgStatus = getMicrosConfigStatus();
  if (cfgStatus.enabled && cfgStatus.configured) {
    Promise.resolve().then(async () => {
      // Use per-location configs — each location has its own credentials
      const allConfigs = await getAllLocationConfigs();
      const enabledConfigs = allConfigs.filter((c) => c.enabled && c.configured);

      await Promise.allSettled(
        enabledConfigs.map((cfg) => runLocationSync(cfg, today))
      );

      await runLabourDeltaSync();
    }).catch((err) => logger.warn("[DailySync] Background sync error", { err: String(err) }));
  }
  // ── END DEPRECATED V2 BLOCK ────────────────────────────────────────────────

  // â”€â”€ 2. Enqueue send_daily_report async job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const supabase = createServerClient() as any;

  const { data: sites } = await supabase
    .from("sites")
    .select("id")
    .eq("is_active", true);

  const siteIds: string[] = (sites ?? []).map((s: any) => s.id as string);

  if (siteIds.length === 0) {
    logger.warn("[DailySync] No active sites â€” nothing to enqueue");
    return NextResponse.json({ ok: true, enqueued: 0, note: "No active sites" });
  }

  let enqueued = 0;
  for (const siteId of siteIds) {
    const idempotencyKey = `send_daily_report|${siteId}|${today}`;
    const { error } = await supabase.rpc("enqueue_async_job", {
      p_job_type:        "send_daily_report",
      p_payload:         { site_id: siteId, date: today },
      p_idempotency_key: idempotencyKey,
      p_available_at:    new Date().toISOString(),
      p_priority:        100,
    });
    if (error) {
      logger.warn("[DailySync] Failed to enqueue send_daily_report", { siteId, error });
    } else {
      enqueued++;
    }
  }

  logger.info("[DailySync] Enqueued daily report jobs", { enqueued, date: today });
  return NextResponse.json({ ok: true, enqueued, date: today });
}

// â”€â”€ Internal report-send handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Called by the async worker when processing a `send_daily_report` job.
// Contains the original full data pull + email composition logic.
//
// POST /api/cron/daily-sync/run?siteId=<id>&date=<YYYY-MM-DD>
// (or siteId=ALL for all active sites)

export async function POST(req: NextRequest) {
  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const siteId: string | undefined = body.site_id;
  const today: string = body.date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  // run the actual report build + email send (extracted below)
  return sendDailyReport(siteId, today);
}
