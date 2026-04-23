/**
 * lib/scheduler/sync-scheduler.ts
 *
 * Reads sync_schedules rows that are due, enqueues one sync_job_queue item
 * per schedule, and bumps next_run_at.
 *
 * This is purely a scheduling concern — it does not execute sync logic.
 * Actual execution is done by worker.ts.
 *
 * On a Hobby Vercel plan (daily cron only), this runs once per day.
 * On Pro (5-minute cron), it runs on every tick and only enqueues due items.
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { todayISO } from "@/lib/utils";
import type { DueSyncSchedule } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbAny(supabase: ReturnType<typeof createServerClient>): any {
  return supabase;
}

/**
 * Evaluate all due sync_schedules and enqueue a sync_job_queue item for each.
 *
 * Returns the number of jobs successfully enqueued.
 */
export async function enqueueDueSyncJobs(
  supabase: ReturnType<typeof createServerClient>,
  opts: {
    maxSchedules?: number;
    dryRun?: boolean;
    traceId: string;
  },
): Promise<number> {
  const { maxSchedules = 50, dryRun = false, traceId } = opts;
  const db = dbAny(supabase);

  // ── Step 1: Find due schedules ────────────────────────────────────────────
  const { data, error } = await db.rpc("get_due_sync_schedules", {
    now_ts:   new Date().toISOString(),
    max_rows: maxSchedules,
  });

  if (error) {
    logger.error("sync_scheduler.get_due_failed", { traceId, error: error.message });
    return 0;
  }

  const schedules = parseScheduleRows((data as unknown[]) ?? []);
  if (schedules.length === 0) {
    logger.info("sync_scheduler.no_due_schedules", { traceId });
    return 0;
  }

  logger.info("sync_scheduler.due_schedules_found", {
    traceId,
    count: schedules.length,
    dryRun,
  });

  let enqueued = 0;

  for (const schedule of schedules) {
    if (dryRun) {
      logger.info("sync_scheduler.dry_run_enqueue", {
        traceId,
        schedule_id: schedule.id,
        loc_ref: schedule.loc_ref,
        sync_type: schedule.sync_type,
      });
      enqueued++;
      continue;
    }

    try {
      const jobId = await enqueueOneJob(db, schedule, traceId);
      if (jobId) {
        logger.info("sync_scheduler.job_enqueued", {
          traceId,
          schedule_id: schedule.id,
          job_id: jobId,
          loc_ref: schedule.loc_ref,
          sync_type: schedule.sync_type,
        });
        enqueued++;

        // Advance next_run_at on the schedule
        await db.rpc("bump_schedule_next_run", {
          p_schedule_id: schedule.id,
          p_success:     true,
        });
      }
    } catch (err) {
      logger.warn("sync_scheduler.enqueue_one_failed", {
        traceId,
        schedule_id: schedule.id,
        err: String(err),
      });
    }
  }

  logger.info("sync_scheduler.enqueue_complete", { traceId, enqueued, total: schedules.length });
  return enqueued;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function enqueueOneJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  schedule: DueSyncSchedule,
  traceId: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("enqueue_sync_job", {
    p_site_id:       schedule.site_id,
    p_connection_id: schedule.connection_id,
    p_loc_ref:       schedule.loc_ref,
    p_sync_type:     schedule.sync_type,
    p_mode:          "delta",
    p_business_date: todayISO(),
    p_priority:      100,
    p_trace_id:      traceId,
  });

  if (error) {
    logger.warn("sync_scheduler.enqueue_rpc_failed", {
      traceId,
      schedule_id: schedule.id,
      error: error.message,
    });
    return null;
  }

  return data as string | null;
}

function parseScheduleRows(rows: unknown[]): DueSyncSchedule[] {
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      if (!row.id || !row.site_id || !row.loc_ref || !row.sync_type) return null;
      return {
        id:              String(row.id),
        site_id:         String(row.site_id),
        connection_id:   row.connection_id != null ? String(row.connection_id) : null,
        loc_ref:         String(row.loc_ref),
        sync_type:       String(row.sync_type),
        cadence_minutes: Number(row.cadence_minutes ?? 60),
      } satisfies DueSyncSchedule;
    })
    .filter((r): r is DueSyncSchedule => r !== null);
}
