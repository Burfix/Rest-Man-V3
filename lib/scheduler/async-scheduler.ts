/**
 * lib/scheduler/async-scheduler.ts
 *
 * Executes claimed async jobs: compute_accountability, send_daily_report,
 * send_weekly_report, google_reviews_sync.
 *
 * Thin glue layer — all real business logic lives in services/.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { markAsyncJobSuccess, markAsyncJobFailed } from "./claim";
import type { ClaimedAsyncJob, SchedulerWorkerContext } from "./types";

// ── Single-job executor ───────────────────────────────────────────────────────

export async function executeAsyncJob(
  supabase: ReturnType<typeof createServerClient>,
  job: ClaimedAsyncJob,
  ctx: SchedulerWorkerContext,
): Promise<boolean> {
  const logBase = {
    job_id:   job.id,
    job_type: job.job_type,
    trace_id: job.trace_id,
    attempt:  job.attempts,
    payload:  job.payload,
  };

  if (ctx.dry_run) {
    logger.info("async_worker.dry_run_skip", logBase);
    await markAsyncJobSuccess(supabase, job.id);
    return true;
  }

  logger.info("async_worker.start", logBase);

  try {
    switch (job.job_type) {
      case "compute_accountability":
        await handleComputeAccountability(job);
        break;

      case "send_daily_report":
        await handleSendDailyReport(job);
        break;

      case "send_weekly_report":
        await handleSendWeeklyReport(job);
        break;

      case "google_reviews_sync":
        await handleGoogleReviewsSync(job);
        break;

      default: {
        const unknown: never = job.job_type;
        throw new Error(`Unknown async job type: ${unknown}`);
      }
    }

    await markAsyncJobSuccess(supabase, job.id);
    logger.info("async_worker.success", logBase);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("async_worker.failed", { ...logBase, err: msg });
    await markAsyncJobFailed(supabase, job.id, msg, 60);
    return false;
  }
}

// ── Batch loop ────────────────────────────────────────────────────────────────

export async function runAsyncJobBatch(
  supabase: ReturnType<typeof createServerClient>,
  jobs: ClaimedAsyncJob[],
  ctx: SchedulerWorkerContext,
): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;

  for (const job of jobs) {
    if (Date.now() > ctx.deadline_ms) {
      logger.warn("async_worker.batch_bailed_early", {
        tick_id:   ctx.tick_id,
        remaining: jobs.length - succeeded - failed,
      });
      break;
    }

    const ok = await executeAsyncJob(supabase, job, ctx);
    if (ok) { succeeded++; } else { failed++; }
  }

  return { succeeded, failed };
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleComputeAccountability(job: ClaimedAsyncJob): Promise<void> {
  const { calculateAllSitesScores, calculateDailyScores } =
    await import("@/services/accountability/score-calculator");

  const site_id: string | undefined = job.payload?.site_id as string | undefined;
  const date: string | undefined    = job.payload?.date as string | undefined;

  if (site_id && date) {
    await calculateDailyScores(site_id, date);
  } else {
    // Full multi-site run (date defaults to yesterday inside service)
    await calculateAllSitesScores(date);
  }
}

async function handleSendDailyReport(job: ClaimedAsyncJob): Promise<void> {
  const { sendDailyReport } = await import("@/services/reports/dailyReport");

  const site_id: string | undefined = job.payload?.site_id as string;
  const date: string | undefined    = job.payload?.date as string;

  await sendDailyReport(site_id, date ?? new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }));
}

async function handleSendWeeklyReport(job: ClaimedAsyncJob): Promise<void> {
  const { generateWeeklyReport } =
    await import("@/services/reports/weeklyReport");
  const { sendWeeklyReportEmail } =
    await import("@/services/reports/weeklyReportEmail");

  const org_id: string | undefined = (job.payload?.org_id as string | undefined)
    ?? (job.payload?.site_id as string | undefined);
  const date: string | undefined    = job.payload?.date as string | undefined;

  if (!org_id) {
    throw new Error("send_weekly_report job missing org_id or site_id in payload");
  }

  const report = await generateWeeklyReport(org_id);
  if (report) {
    const recipients = process.env.WEEKLY_REPORT_EMAIL
      ? process.env.WEEKLY_REPORT_EMAIL.split(",").map((e) => e.trim())
      : [];
    if (recipients.length > 0) {
      await sendWeeklyReportEmail(report, recipients);
    }
  }
}

async function handleGoogleReviewsSync(job: ClaimedAsyncJob): Promise<void> {
  const site_id: string = job.payload?.site_id as string ?? "ALL";

  const cronSecret = process.env.CRON_SECRET;
  const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url        = `${baseUrl}/api/reviews/google-sync?siteId=${encodeURIComponent(site_id)}`;

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${cronSecret}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "no body");
    throw new Error(`google-sync fetch failed: ${res.status} — ${text}`);
  }
}
