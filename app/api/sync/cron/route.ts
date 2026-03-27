/**
 * GET /api/sync/cron
 *
 * Vercel Cron endpoint — runs the V2 sync engine for ALL active sites.
 * Protected by CRON_SECRET bearer token.
 *
 * Iterates all active sites with MICROS connections and runs sales sync.
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
