/**
 * POST /api/system-health/jobs/run
 *
 * Manually enqueue a sync job by inserting a 'queued' row into sync_jobs.
 * The scheduler will pick it up on the next tick (within 3 minutes).
 *
 * Body: { jobType: string, siteId?: string }
 * Permission: run_jobs
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/permissions";
import { logger } from "@/lib/logger";
import * as Sentry from "@sentry/nextjs";

export const dynamic = "force-dynamic";

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

  try {
    const { data, error } = await (supabase as any)
      .from("sync_jobs")
      .insert({
        site_id:      targetSiteId,
        job_type:     jobType,
        status:       "queued",
        attempt_count: 0,
        max_attempts:  3,
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw error;

    logger.info("system.health.job.manual_enqueue", {
      jobType,
      siteId:    targetSiteId,
      jobId:     data?.id,
      requestedBy: ctx.userId,
    });

    return NextResponse.json({
      ok:      true,
      jobId:   data?.id,
      message: `${jobType} queued — runs on next scheduler tick (within 3 minutes)`,
    });
  } catch (err) {
    logger.error("system.health.job.enqueue_failed", { jobType, siteId: targetSiteId, err: String(err) });
    Sentry.captureException(err, {
      tags:  { route: "POST /api/system-health/jobs/run" },
      extra: { jobType, siteId: targetSiteId },
    });
    return NextResponse.json({ error: "Failed to enqueue job" }, { status: 500 });
  }
}
