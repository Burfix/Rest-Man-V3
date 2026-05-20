/**
 * GET /api/health
 *
 * System health check endpoint.
 * No auth required — safe for uptime monitors, load balancers, and Vercel healthchecks.
 *
 * Returns:
 *   status               "healthy" | "degraded" | "unhealthy"
 *   checks.database      "ok" | "error"
 *   checks.scheduler_lag_seconds          seconds since oldest queued job became available
 *   checks.oldest_queued_job_age_seconds  seconds since oldest queued job was created
 *   checks.dead_letter_count              jobs that exhausted all retries
 *   checks.micros_last_sync_minutes_ago   minutes since the most recent MICROS sync
 *
 * Thresholds (conservative — tighten once P50 lag is known):
 *   degraded:   scheduler_lag > 5min OR dead_letter_count > 0 OR micros_sync > 90min
 *   unhealthy:  database error OR scheduler_lag > 15min OR dead_letter_count > 10
 *
 * HTTP 200 = healthy/degraded (monitors should alert on degraded separately if needed)
 * HTTP 503 = unhealthy
 */

import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { pingRedis, getCommandCount } from "@/lib/cache/redis";
import * as Sentry from "@sentry/nextjs";
import { validateLocationRefUniqueness } from "@/lib/micros/micros-location-registry";

// ── Redis status cache (30 s TTL) ──────────────────────────────────────────
// Avoids issuing a Redis PING on every health check (every 5 min = 288 commands/day).
// With 30 s cache: max 2 pings/min = ~48 commands/day.

let _cachedRedisStatus: { status: "ok" | "error"; checkedAt: number } | null = null;
const REDIS_STATUS_TTL_MS = 30_000;

async function getRedisStatus(): Promise<"ok" | "error"> {
  const now = Date.now();
  if (_cachedRedisStatus && now - _cachedRedisStatus.checkedAt < REDIS_STATUS_TTL_MS) {
    return _cachedRedisStatus.status;
  }
  const status = await pingRedis();
  _cachedRedisStatus = { status, checkedAt: now };
  return status;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Thresholds ────────────────────────────────────────────────────────────────
const LAG_DEGRADED_S   =  5 * 60;   // 5 min
const LAG_UNHEALTHY_S  = 15 * 60;   // 15 min
const DL_DEGRADED      =  1;         // any dead-letter is degraded
const DL_UNHEALTHY     = 10;
const MICROS_DEGRADED_MIN = 90;      // minutes

// ── Supabase proxy (tables added in migrations 062-064 not yet typed) ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: ReturnType<typeof createServerClient>): any {
  return supabase;
}

// ── Sub-checks ────────────────────────────────────────────────────────────────

async function checkDatabase(supabase: ReturnType<typeof createServerClient>): Promise<"ok" | "error"> {
  try {
    // Lightweight probe: select 1 row from a small system table
    const { error } = await supabase
      .from("sites")
      .select("id")
      .limit(1);
    return error ? "error" : "ok";
  } catch {
    return "error";
  }
}

interface SchedulerChecks {
  scheduler_lag_seconds:          number | null;
  oldest_queued_job_age_seconds:  number | null;
  dead_letter_count:              number;
}

async function checkScheduler(supabase: ReturnType<typeof createServerClient>): Promise<SchedulerChecks> {
  const now = Date.now();

  // ── Dead-letter count (sync + async combined) ─────────────────────────────
  const [syncDlResult, asyncDlResult] = await Promise.allSettled([
    db(supabase)
      .from("sync_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter"),
    db(supabase)
      .from("async_job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead_letter"),
  ]);

  const syncDl  = syncDlResult.status  === "fulfilled" ? (syncDlResult.value.count  ?? 0) : 0;
  const asyncDl = asyncDlResult.status === "fulfilled" ? (asyncDlResult.value.count ?? 0) : 0;
  const dead_letter_count = (syncDl as number) + (asyncDl as number);

  // ── Oldest queued job (scheduler lag) ────────────────────────────────────
  // A queued job with available_at in the past that hasn't been claimed yet.
  const [syncOldestResult, asyncOldestResult] = await Promise.allSettled([
    db(supabase)
      .from("sync_job_queue")
      .select("available_at, created_at")
      .eq("status", "queued")
      .lte("available_at", new Date().toISOString())
      .order("available_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db(supabase)
      .from("async_job_queue")
      .select("available_at, created_at")
      .eq("status", "queued")
      .lte("available_at", new Date().toISOString())
      .order("available_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const syncOldest  = syncOldestResult.status  === "fulfilled" ? syncOldestResult.value.data  : null;
  const asyncOldest = asyncOldestResult.status === "fulfilled" ? asyncOldestResult.value.data : null;

  // Pick whichever overdue job has been waiting longest
  let oldest: { available_at: string; created_at: string } | null = null;
  for (const row of [syncOldest, asyncOldest]) {
    if (!row) continue;
    if (!oldest || new Date(row.available_at) < new Date(oldest.available_at)) {
      oldest = row;
    }
  }

  const scheduler_lag_seconds = oldest
    ? Math.round((now - new Date(oldest.available_at).getTime()) / 1000)
    : null;

  const oldest_queued_job_age_seconds = oldest
    ? Math.round((now - new Date(oldest.created_at).getTime()) / 1000)
    : null;

  return { scheduler_lag_seconds, oldest_queued_job_age_seconds, dead_letter_count };
}

interface MicrosChecks {
  micros_last_sync_minutes_ago: number | null;
}

async function checkMicros(supabase: ReturnType<typeof createServerClient>): Promise<MicrosChecks> {
  try {
    const { data } = await db(supabase)
      .from("micros_connections")
      .select("last_sync_at")
      .eq("status", "active")
      .not("last_sync_at", "is", null)
      .order("last_sync_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data?.last_sync_at) return { micros_last_sync_minutes_ago: null };

    const minutesAgo = Math.round(
      (Date.now() - new Date(data.last_sync_at).getTime()) / 60_000
    );
    return { micros_last_sync_minutes_ago: minutesAgo };
  } catch {
    return { micros_last_sync_minutes_ago: null };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  const supabase = createServerClient();
  const startedAt = Date.now();

  const [dbResult, schedulerResult, microsResult, redisResult] = await Promise.allSettled([
    checkDatabase(supabase),
    checkScheduler(supabase),
    checkMicros(supabase),
    getRedisStatus(),
  ]);

  const database  = dbResult.status  === "fulfilled" ? dbResult.value  : "error" as const;
  const scheduler = schedulerResult.status === "fulfilled" ? schedulerResult.value : null;
  const micros    = microsResult.status    === "fulfilled" ? microsResult.value    : null;
  const redis     = redisResult.status     === "fulfilled" ? redisResult.value     : "error" as const;

  const lag  = scheduler?.scheduler_lag_seconds ?? 0;
  const dl   = scheduler?.dead_letter_count     ?? 0;
  const sync = micros?.micros_last_sync_minutes_ago;

  // ── Location ref conflict check ────────────────────────────────────────────
  const locRefConflicts = validateLocationRefUniqueness();
  const hasLocRefConflict = locRefConflicts.length > 0;
  if (hasLocRefConflict) {
    logger.error("MICROS location ref conflict detected", { conflicts: locRefConflicts });
  }

  // ── Overall status ─────────────────────────────────────────────────────────
  const isUnhealthy =
    database === "error"    ||
    lag  >= LAG_UNHEALTHY_S ||
    dl   >= DL_UNHEALTHY;

  const isDegraded =
    !isUnhealthy && (
      lag  >= LAG_DEGRADED_S                                       ||
      dl   >= DL_DEGRADED                                          ||
      (sync !== null && sync !== undefined && sync >= MICROS_DEGRADED_MIN) ||
      hasLocRefConflict
    );

  const status = isUnhealthy ? "unhealthy" : isDegraded ? "degraded" : "healthy";

  if (status !== "healthy") {
    logger.warn("health.check.non_healthy", {
      status, database, lag, dl, sync,
      duration_ms: Date.now() - startedAt,
    });

    // Report to Sentry so degraded/unhealthy states surface as alerts
    Sentry.captureMessage(
      `Health check ${status}`,
      status === "unhealthy" ? "error" : "warning",
    );
    Sentry.setContext("health_check", {
      status,
      database,
      scheduler_lag_seconds: lag,
      dead_letter_count:     dl,
      micros_sync_minutes:   sync ?? null,
      duration_ms:           Date.now() - startedAt,
    });
  }

  const body = {
    status,
    checks: {
      database,
      redis,
      redis_commands_today: getCommandCount(),
      scheduler_lag_seconds:          scheduler?.scheduler_lag_seconds          ?? null,
      oldest_queued_job_age_seconds:  scheduler?.oldest_queued_job_age_seconds  ?? null,
      dead_letter_count:              scheduler?.dead_letter_count              ?? 0,
      micros_last_sync_minutes_ago:   micros?.micros_last_sync_minutes_ago      ?? null,
      micros_location_ref_conflicts:  hasLocRefConflict
        ? locRefConflicts.map((c) => ({ locationRef: c.locationRef, keys: c.keys }))
        : null,
    },
    checked_at:   new Date().toISOString(),
    duration_ms:  Date.now() - startedAt,
  };

  return Response.json(body, { status: isUnhealthy ? 503 : 200 });
}
