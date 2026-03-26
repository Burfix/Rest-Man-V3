/**
 * POST /api/micros/labour-sync
 * GET  /api/micros/labour-sync  (Vercel Cron)
 *
 * Triggers a labour data sync from Oracle BIAPI → Supabase.
 * Supports ?mode=full|delta (default: delta).
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { todayISO } from "@/lib/utils";
import { runLabourFullSync, runLabourDeltaSync } from "@/services/micros/labour/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/micros/labour-sync");
  if (guard.error) return guard.error;

  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({
      ok: false,
      message: cfgStatus.enabled
        ? `Missing config: ${cfgStatus.missing.join(", ")}`
        : "MICROS integration is disabled.",
    });
  }

  let mode: "full" | "delta" = "delta";
  let date: string | undefined;

  try {
    const body = await req.json().catch(() => ({}));
    if (body.mode === "full") mode = "full";
    if (body.date) date = body.date;
  } catch {
    // no body is fine
  }

  const result = mode === "full"
    ? await runLabourFullSync(date ?? todayISO())
    : await runLabourDeltaSync();

  return NextResponse.json({
    ok: result.success,
    mode: result.mode,
    message: result.message,
    businessDate: result.businessDate,
    timecardsUpserted: result.timecardsUpserted ?? 0,
    jobCodesSynced: result.jobCodesSynced ?? 0,
    errors: result.errors ?? [],
    checkedAt: new Date().toISOString(),
  });
  } catch (err) {
    logger.error("Labour sync route crash", { err });
    return NextResponse.json({ ok: false, message: "Labour sync crashed — see logs" }, { status: 500 });
  }
}

/** Vercel Cron sends GET requests, protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  try {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({ ok: false, message: "MICROS not configured" });
  }

  // Cron uses delta sync for efficiency
  const result = await runLabourDeltaSync();

  return NextResponse.json({
    ok: result.success,
    mode: result.mode,
    message: result.message,
    timecardsUpserted: result.timecardsUpserted ?? 0,
    source: "cron",
  });
  } catch (err) {
    logger.error("Labour sync cron crash", { err });
    return NextResponse.json({ ok: false, message: "Labour cron failed" }, { status: 500 });
  }
}
