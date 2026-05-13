/**
 * GET /api/cron/daily-sync
 *
 * Vercel-scheduled cron (0 0 * * * â†’ midnight UTC / 2AM SAST).
 *
 * Thin enqueuer â€” enqueues `send_daily_report` async jobs for each active
 * site into async_job_queue. The async worker (runAsyncJobBatch) processes
 * them and calls back /api/cron/daily-sync/run?siteId= with Bearer auth.
 *
 * POST /api/cron/daily-sync/run?siteId=<id>&date=<YYYY-MM-DD>
 * is the internal handler that does the actual data pull + email send.
 *
 * Protected by Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { MicrosSyncService } from "@/services/micros/MicrosSyncService";
import { runLabourDeltaSync } from "@/services/micros/labour/sync";
import { getMicrosConfigStatus } from "@/lib/micros/config";
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

  // ── 1. Kick off intraday syncs per active MICROS connection ──────────────
  const cfgStatus = getMicrosConfigStatus();
  if (cfgStatus.enabled && cfgStatus.configured) {
    Promise.resolve().then(async () => {
      const db2 = createServerClient() as any;
      const { data: conns } = await db2
        .from("micros_connections")
        .select("site_id, loc_ref, location_name")
        .not("loc_ref", "is", null)
        .neq("loc_ref", "");

      if (conns?.length) {
        const siteIds = (conns as any[]).map((c: any) => c.site_id as string);
        const { data: roleRows } = await db2
          .from("user_roles")
          .select("site_id, organisation_id")
          .in("site_id", siteIds)
          .not("organisation_id", "is", null)
          .limit(100);
        const orgBySite: Record<string, string> = {};
        for (const row of (roleRows ?? []) as any[]) {
          if (row.site_id && row.organisation_id && !orgBySite[row.site_id]) {
            orgBySite[row.site_id] = row.organisation_id;
          }
        }
        await Promise.allSettled(
          (conns as any[]).map((conn: any) =>
            new MicrosSyncService().runFullSync({
              siteId:            conn.site_id,
              organisationId:    orgBySite[conn.site_id] ?? "",
              microsLocationRef: conn.loc_ref,
            }, today)
          )
        );
      }
      await runLabourDeltaSync();
    }).catch((err) => logger.warn("[DailySync] Background sync error", { err: String(err) }));
  }

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
