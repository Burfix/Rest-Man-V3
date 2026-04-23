/**
 * POST /api/micros/labour-sync
 * GET  /api/micros/labour-sync  (Vercel Cron)
 *
 * Triggers a labour data sync from Oracle BIAPI → Supabase.
 * Supports new SyncRequest contract when sync_type is present.
 * Legacy {loc_ref, date, mode} shape kept for backward compat.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { todayISO } from "@/lib/utils";
import { runLabourFullSync, runLabourDeltaSync } from "@/services/micros/labour/sync";
import { SyncRequest as SyncRequestSchema } from "@/lib/sync/contract";
import { dispatchSync } from "@/lib/sync/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/micros/labour-sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({
      ok: false,
      message: cfgStatus.enabled
        ? `Missing config: ${cfgStatus.missing.join(", ")}`
        : "MICROS integration is disabled.",
    });
  }

  let rawBody: Record<string, unknown> = {};
  try {
    rawBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  } catch {
    // no body is fine
  }

  const traceId = (rawBody.trace_id as string | undefined) ?? crypto.randomUUID();

  // New contract path
  if (rawBody.sync_type === "labour") {
    const parsed = SyncRequestSchema.safeParse({
      loc_ref: rawBody.loc_ref ?? process.env.MICROS_LOCATION_REF ?? "",
      sync_type: "labour",
      mode: rawBody.mode ?? "delta",
      business_date: rawBody.business_date ?? rawBody.date,
      trace_id: traceId,
    });
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: "Invalid request", errors: parsed.error.flatten().fieldErrors }, { status: 400 });
    }
    const result = await dispatchSync(parsed.data, ctx.siteId, traceId);
    return NextResponse.json({ ...result, source: "manual", checkedAt: new Date().toISOString() });
  }

  // Legacy path — preserve old response shape
  const mode: "full" | "delta" = rawBody.mode === "full" ? "full" : "delta";
  const date = rawBody.date as string | undefined;

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
