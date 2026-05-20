import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { MicrosSyncService } from "@/services/micros/MicrosSyncService";
import { getMicrosConnectionBySiteId } from "@/services/micros/status";
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

  // Resolve siteId: body overrides cookie, must be within user's accessible sites
  const bodySiteId = rawBody.siteId as string | undefined;
  if (bodySiteId && !ctx.siteIds.includes(bodySiteId)) {
    return NextResponse.json({ ok: false, message: "Access denied: site not in your accessible sites" }, { status: 403 });
  }
  const resolvedSiteId = bodySiteId ?? ctx.siteId;

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

    const result = await dispatchSync(parsed.data, resolvedSiteId, traceId);
    return NextResponse.json({ ...result, source: "manual", checkedAt: new Date().toISOString() });
  }

  // Legacy path — keep backward compat for callers that send {loc_ref, date}
  const date = rawBody.date as string | undefined;
  try {
    // Resolve tenant-scoped connection for this user's site
    const connection = await getMicrosConnectionBySiteId(resolvedSiteId);
    if (!connection?.loc_ref) {
      return NextResponse.json({
        ok: false,
        message: `No MICROS connection found for site ${resolvedSiteId}`,
      }, { status: 404 });
    }

    const svc = new MicrosSyncService();
    const result = await svc.runFullSync({
      siteId:            resolvedSiteId,
      organisationId:    ctx.orgId ?? "",
      microsLocationRef: connection.loc_ref,
    }, date ?? todayISO());

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

  // Resolve all active MICROS connections and sync each one
  const { createServerClient } = await import("@/lib/supabase/server");
  const db = createServerClient() as any;

  const { data: connections } = await db
    .from("micros_connections")
    .select("id, site_id, loc_ref, location_name")
    .not("loc_ref", "is", null)
    .neq("loc_ref", "");

  if (!connections?.length) {
    return NextResponse.json({ ok: false, message: "No MICROS connections found" });
  }

  // Resolve organisationId per site via user_roles
  const { data: roleRows } = await db
    .from("user_roles")
    .select("site_id, organisation_id")
    .in("site_id", connections.map((c: any) => c.site_id))
    .not("organisation_id", "is", null)
    .limit(100);

  const orgBySite: Record<string, string> = {};
  for (const row of (roleRows ?? []) as any[]) {
    if (row.site_id && row.organisation_id && !orgBySite[row.site_id]) {
      orgBySite[row.site_id] = row.organisation_id;
    }
  }

  const today = todayISO();
  const svc = new MicrosSyncService();

  const results = await Promise.allSettled(
    (connections as any[]).map((conn) =>
      svc.runFullSync({
        siteId:            conn.site_id,
        organisationId:    orgBySite[conn.site_id] ?? "",
        microsLocationRef: conn.loc_ref,
      }, today)
    )
  );

  const summary = results.map((r, i) => ({
    siteId: connections[i].site_id,
    location: connections[i].location_name,
    ok:    r.status === "fulfilled" ? r.value.success : false,
    error: r.status === "rejected"  ? String((r as PromiseRejectedResult).reason) : undefined,
  }));

  return NextResponse.json({ ok: true, sites: summary, source: "cron" });
}
