import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { MicrosSyncService } from "@/services/micros/MicrosSyncService";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { todayISO } from "@/lib/utils";
import { SyncRequest as SyncRequestSchema } from "@/lib/sync/contract";
import { dispatchSync } from "@/lib/sync/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/micros/sync");
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
  } catch { /* no body is fine */ }

  const traceId = (rawBody.trace_id as string | undefined) ?? crypto.randomUUID();

  // If the caller supplied sync_type, use the new orchestrator path
  if (rawBody.sync_type) {
    const parsed = SyncRequestSchema.safeParse({
      loc_ref: rawBody.loc_ref ?? process.env.MICROS_LOCATION_REF ?? "",
      sync_type: rawBody.sync_type,
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

  // Legacy path — keep backward compat for callers that send {loc_ref, date}
  const date = rawBody.date as string | undefined;
  try {
    const svc = new MicrosSyncService();
    const result = await svc.runFullSync(date ?? todayISO());

    logger.info("MICROS sync completed", { route: "POST /api/micros/sync", success: result.success, trace_id: traceId });
    return NextResponse.json({
      ok: result.success,
      message: result.message,
      businessDate: result.businessDate,
      recordsSynced: result.recordsSynced,
      errors: result.errors ?? [],
      source: "manual",
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { route: "POST /api/micros/sync" } });
    logger.error("MICROS sync crashed", { route: "POST /api/micros/sync", err });
    return NextResponse.json({ ok: false, message: msg, errors: [msg], source: "manual" }, { status: 500 });
  }
}

/** Vercel Cron sends GET requests, protected by CRON_SECRET. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cfgStatus = getMicrosConfigStatus();
  if (!cfgStatus.enabled || !cfgStatus.configured) {
    return NextResponse.json({ ok: false, message: "MICROS not configured" });
  }

  try {
    const svc = new MicrosSyncService();
    const result = await svc.runFullSync(todayISO());

    return NextResponse.json({
      ok: result.success,
      message: result.message,
      businessDate: result.businessDate,
      recordsSynced: result.recordsSynced,
      source: "cron",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { route: "GET /api/micros/sync", trigger: "cron" } });
    logger.error("MICROS cron sync crashed", { route: "GET /api/micros/sync", err });
    return NextResponse.json({ ok: false, message: msg, source: "cron" }, { status: 500 });
  }
}
