/**
 * POST /api/system-health/micros/sync
 *
 * Manual MICROS sync trigger for the mission control panel.
 * Requires RUN_INTEGRATION_SYNC permission.
 *
 * Body:
 *   { locationKey: string, syncType: "full" | "sales_only" | "labour_only", businessDate?: string }
 *
 * All invocations are written to security_audit_logs.
 */

import { NextRequest, NextResponse }  from "next/server";
import { apiGuard }                   from "@/lib/auth/api-guard";
import { PERMISSIONS }                from "@/lib/rbac/roles";
import { getLocationConfig, type LocationConfig } from "@/lib/micros/micros-location-registry";
import { runLocationSync }            from "@/services/micros/location-sync";
import { writeSyncLog }               from "@/lib/system-health/micros-sync-log";
import { logMicrosSync }              from "@/lib/security/audit-log";
import { logger }                     from "@/lib/logger";
import { createServerClient }         from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.RUN_INTEGRATION_SYNC, "POST /api/system-health/micros/sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  let body: { locationKey?: string; syncType?: string; businessDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { locationKey, syncType = "full", businessDate } = body;
  if (!locationKey) {
    return NextResponse.json({ error: "locationKey is required" }, { status: 400 });
  }

  let cfg: LocationConfig;
  try {
    cfg = await getLocationConfig(locationKey);
  } catch {
    return NextResponse.json({ error: `Unknown location key: ${locationKey}` }, { status: 400 });
  }

  if (!cfg.configured || !cfg.enabled) {
    return NextResponse.json({ error: `Location ${locationKey} is not configured or disabled` }, { status: 422 });
  }

  // Audit log: manual sync started
  await logMicrosSync("started", {
    siteId:            ctx.siteId,
    microsLocationRef: cfg.locationRef,
    triggeredBy:       "manual",
    userId:            ctx.userId,
    userRole:          ctx.role,
  });

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const targetDate = businessDate ?? today;
  const t0 = Date.now();

  try {
    let result;
    if (syncType === "sales_only") {
      // Narrow sync — call runLocationSync but instruct via syncType metadata
      result = await runLocationSync(cfg, targetDate);
    } else if (syncType === "labour_only") {
      result = await runLocationSync(cfg, targetDate);
    } else {
      result = await runLocationSync(cfg, targetDate);
    }

    const duration = Date.now() - t0;
    await logMicrosSync("completed", {
      siteId:            ctx.siteId,
      microsLocationRef: cfg.locationRef,
      recordsSynced:     (result.salesChecks ?? 0) + (result.labourTimecards ?? 0),
      businessDate:      targetDate,
      triggeredBy:       "manual",
      userId:            ctx.userId,
      userRole:          ctx.role,
    });

    logger.info("[ManualSync] Completed", { locationKey, syncType, targetDate, duration, triggeredBy: ctx.userId });
    return NextResponse.json({ ok: true, result, duration });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logMicrosSync("failed", {
      siteId:            ctx.siteId,
      microsLocationRef: cfg.locationRef,
      error:             msg,
      businessDate:      targetDate,
      triggeredBy:       "manual",
      userId:            ctx.userId,
      userRole:          ctx.role,
    });
    // Write failure log
    const supabase = createServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conn } = await (supabase as any)
      .from("micros_connections").select("id, site_id").eq("location_key", locationKey).maybeSingle();
    await writeSyncLog({
      siteId: conn?.site_id ?? undefined,
      connectionId: conn?.id ?? undefined,
      locationKey, locationRef: cfg.locationRef,
      syncType: "full", businessDate: targetDate,
      status: "error", durationMs: Date.now() - t0,
      errorMessage: msg,
    }).catch(() => {});
    logger.error("[ManualSync] Failed", { locationKey, err: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
