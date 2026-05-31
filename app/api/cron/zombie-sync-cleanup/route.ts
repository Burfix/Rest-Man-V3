/**
 * GET /api/cron/zombie-sync-cleanup
 *
 * Daily Vercel cron that calls cleanup_zombie_sync_runs(60) to mark any
 * micros_sync_runs stuck in 'running' for > 60 minutes as 'error'.
 *
 * The application-level zombie cleanup in MicrosSyncService.ts (5-min
 * threshold, per-connection) acts as the first line of defence. This cron
 * acts as a guaranteed safety net that runs independently of whether the
 * next sync is triggered.
 *
 * Protected by: Authorization: Bearer ${CRON_SECRET}
 *
 * DOES NOT touch micros_connections, credentials, or sync architecture.
 */

import { NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";
import { jsonCompatError, jsonCompatSuccess } from "@/lib/api/response";

export const dynamic    = "force-dynamic";
export const runtime    = "nodejs";
export const maxDuration = 10;

const ZOMBIE_TIMEOUT_MINUTES = 60;

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return jsonCompatError(
      { error: "Unauthorized" },
      "UNAUTHORIZED",
      "Unauthorized",
      {
        status: 401,
        meta: { durationMs: Date.now() - startedAt, source: "cron-zombie-sync-cleanup" },
      },
    );
  }

  try {
    const supabase = getServiceRoleClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .rpc("cleanup_zombie_sync_runs", { p_timeout_minutes: ZOMBIE_TIMEOUT_MINUTES });

    if (error) {
      logger.error("zombie-cleanup: rpc failed", { error: error.message, code: error.code });
      return jsonCompatError(
        { error: "zombie cleanup RPC failed", detail: error.message },
        "ZOMBIE_CLEANUP_RPC_FAILED",
        "Zombie cleanup RPC failed",
        {
          status: 500,
          details: { message: error.message, code: error.code },
          meta: { durationMs: Date.now() - startedAt, source: "cron-zombie-sync-cleanup" },
        },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = Array.isArray(data) ? (data as any[])[0] : data as any;
    const cleanedCount = (result?.cleaned_count as number) ?? 0;

    if (cleanedCount > 0) {
      logger.warn("zombie-cleanup: stale runs terminated", {
        cleanedCount,
        timeoutMinutes: ZOMBIE_TIMEOUT_MINUTES,
        durationMs: Date.now() - startedAt,
      });
    } else {
      logger.info("zombie-cleanup: no stale runs found", {
        timeoutMinutes: ZOMBIE_TIMEOUT_MINUTES,
        durationMs: Date.now() - startedAt,
      });
    }

    const payload = {
      ok:             true,
      cleanedCount,
      timeoutMinutes: ZOMBIE_TIMEOUT_MINUTES,
      durationMs:     Date.now() - startedAt,
    };

    return jsonCompatSuccess(payload, payload, {
      meta: { durationMs: payload.durationMs, source: "cron-zombie-sync-cleanup" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("zombie-cleanup: unexpected error", { error: message });
    return jsonCompatError(
      { error: message },
      "ZOMBIE_CLEANUP_FAILED",
      "Zombie cleanup failed",
      {
        status: 500,
        details: message,
        meta: { durationMs: Date.now() - startedAt, source: "cron-zombie-sync-cleanup" },
      },
    );
  }
}
