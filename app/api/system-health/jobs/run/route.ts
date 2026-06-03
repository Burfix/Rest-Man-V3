/**
 * POST /api/system-health/jobs/run
 *
 * Manually enqueue a sync job via the enqueue_sync_job DB RPC.
 * The scheduler claims it on the next tick (within 3 minutes).
 *
 * Looks up micros_connections for the site to get connection_id and loc_ref
 * before calling enqueue_sync_job — never assumes those values.
 *
 * Body: { jobType: "sales_sync" | "labour_sync" | "inventory_sync", siteId?: string }
 * Permission: RUN_JOBS
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

// Map UI-facing jobType names → scheduler sync_type values used in sync_job_queue
const JOB_TYPE_TO_SYNC_TYPE: Record<string, string> = {
  sales_sync:     "daily_sales",
  labour_sync:    "labour",
  inventory_sync: "inventory",
};

const RUNNABLE_JOB_TYPES = ["sales_sync", "labour_sync", "inventory_sync"] as const;

const bodySchema = z.object({
  jobType: z.enum(RUNNABLE_JOB_TYPES),
  siteId:  z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const guard = await apiGuard(
    PERMISSIONS.RUN_JOBS as any,
    "POST /api/system-health/jobs/run",
  );
  if (guard.error) return guard.error;

  const { ctx, supabase } = guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { jobType, siteId: requestedSiteId } = parsed.data;
  const targetSiteId = requestedSiteId ?? ctx.siteId;
  const syncType = JOB_TYPE_TO_SYNC_TYPE[jobType];

  try {
    // Resolve connection row — required for connection_id and loc_ref
    const { data: conn, error: connErr } = await (supabase as any)
      .from("micros_connections")
      .select("id, loc_ref, status")
      .eq("site_id", targetSiteId)
      .maybeSingle();

    if (connErr) throw new Error(`micros_connections lookup failed: ${connErr.message}`);
    if (!conn?.id) {
      return NextResponse.json(
        { error: "No MICROS connection found for this site. Configure MICROS in Integrations first." },
        { status: 422 },
      );
    }
    if (!conn.loc_ref) {
      return NextResponse.json(
        { error: "MICROS connection is missing loc_ref. Check integration settings." },
        { status: 422 },
      );
    }

    // Use today's business date in SAST
    const businessDate = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

    // Enqueue via the idempotent DB function — safe to call multiple times
    const { data: jobId, error: enqErr } = await (supabase as any).rpc("enqueue_sync_job", {
      p_site_id:       targetSiteId,
      p_connection_id: conn.id,
      p_loc_ref:       conn.loc_ref,
      p_sync_type:     syncType,
      p_mode:          "delta",
      p_business_date: businessDate,
      p_priority:      50, // manual trigger gets elevated priority
    });

    if (enqErr) throw new Error(`enqueue_sync_job failed: ${enqErr.message}`);

    logger.info("system.health.job.manual_enqueue", {
      jobType,
      syncType,
      siteId:      targetSiteId,
      connectionId: conn.id,
      locRef:      conn.loc_ref,
      businessDate,
      jobId,
      requestedBy: ctx.userId,
    });

    return NextResponse.json({
      ok:           true,
      jobId,
      syncType,
      businessDate,
      message: `${jobType} queued for ${businessDate} — scheduler picks up within 3 minutes`,
    });

  } catch (err) {
    logger.error("system.health.job.enqueue_failed", { jobType, syncType, siteId: targetSiteId, err: String(err) });
    Sentry.captureException(err, {
      tags:  { route: "POST /api/system-health/jobs/run" },
      extra: { jobType, syncType, siteId: targetSiteId },
    });
    return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
  }
}
