/**
 * GET /api/sync/cron
 *
 * ⚠️  V1 ORPHANED SYNC ENGINE — NOT SCHEDULED ⚠️
 *
 * This endpoint is NOT in vercel.json and is NOT called by any cron job.
 * It is dead code from the V1 sync engine generation.
 *
 * MICROS sync is now owned by:
 *   V3 (canonical): /api/cron/sync-orchestrator → scheduler/tick
 *
 * This file can be safely deleted. It is retained only for reference until
 * the V2 calls in /api/cron/daily-sync are also removed and V3 is confirmed
 * as the sole sync engine across all live sites.
 *
 * Architecture summary:
 *   V1 (this file)   → runSync(microsSalesAdapter)   [ORPHANED — NOT SCHEDULED]
 *   V2 (daily-sync)  → runLocationSync()              [DEPRECATED — pending removal]
 *   V3 (orchestrator)→ scheduler/tick                 [CANONICAL — owns sync]
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { runSync, microsSalesAdapter } from "@/lib/sync";
import { todayISO } from "@/lib/utils";
import type { SyncConfig } from "@/lib/sync/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Cron auth
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const businessDate = todayISO();

  // Fetch all active sites with MICROS connections
  const { data: sites } = await supabase
    .from("sites")
    .select("id, name")
    .eq("is_active", true);

  if (!sites || sites.length === 0) {
    return NextResponse.json({ ok: true, message: "No active sites", runs: [] });
  }

  const results: Array<{
    siteId: string;
    siteName: string;
    status: string;
    durationMs: number;
    error?: string;
  }> = [];

  // Run sync for each site sequentially (to avoid rate-limiting Oracle API)
  for (const site of sites) {
    const config: SyncConfig = {
      siteId: site.id,
      syncType: "sales",
      source: "micros",
      trigger: "cron",
      businessDate,
      idempotencyKey: `cron:sales:${site.id}:${businessDate}`,
    };

    try {
      const result = await runSync(microsSalesAdapter, config);
      results.push({
        siteId: site.id,
        siteName: site.name,
        status: result.status,
        durationMs: result.durationMs,
        error: result.errors.length > 0 ? result.errors[0].message : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        siteId: site.id,
        siteName: site.name,
        status: "error",
        durationMs: 0,
        error: msg,
      });
    }
  }

  const successCount = results.filter((r) => r.status === "success" || r.status === "partial").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  logger.info("Cron sync completed", {
    route: "GET /api/sync/cron",
    businessDate,
    sites: sites.length,
    success: successCount,
    errors: errorCount,
  });

  return NextResponse.json({
    ok: errorCount === 0,
    businessDate,
    totalSites: sites.length,
    success: successCount,
    errors: errorCount,
    runs: results,
  });
}
