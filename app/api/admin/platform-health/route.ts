/**
 * GET /api/admin/platform-health
 *
 * ForgeStack Platform Observability Health Centre.
 *
 * Returns a comprehensive operational health snapshot covering:
 *   1. MICROS token expiry status (per connection)
 *   2. Sync staleness (per site — time since last successful sync)
 *   3. Active zombie sync runs (stuck in 'running' > 30 min)
 *   4. MPS scoring coverage (sites with no score in last 24h)
 *   5. Overall MICROS connection health
 *
 * Auth: CRON_SECRET Bearer (for internal health checks) OR
 *       super_admin / executive / head_office session.
 *
 * NEVER returns credential values, tokens, client secrets, or passwords.
 */

import { NextRequest } from "next/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getTokenExpiryReport, TokenExpiryStatus } from "@/lib/monitoring/token-expiry";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { logger } from "@/lib/logger";
import { jsonError, jsonSuccess } from "@/lib/api/response";
import {
  MicrosConnectionStalenessRowSchema,
  MicrosSyncRunZombieRowSchema,
  MpsScoreCoverageRowSchema,
  safeParseRows,
} from "@/lib/db/row-schemas";
import {
  classifyStaleness,
  type StalenessStatus,
} from "@/lib/observability/platform-health";

export const dynamic    = "force-dynamic";
export const runtime    = "nodejs";
export const maxDuration = 20;

// ── Auth ─────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(["super_admin", "executive", "head_office"]);

async function authorize(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  try {
    // getUserContext() reads cookies — no arg needed
    const ctx = await getUserContext();
    return !!ctx && ADMIN_ROLES.has(ctx.role);
  } catch {
    return false;
  }
}

// ── Sync staleness check ─────────────────────────────────────────────────────

interface SiteStalenessSummary {
  siteId:           string;
  siteName:         string;
  lastSuccessAt:    string | null;
  minutesSinceLast: number | null;
  status:           StalenessStatus;
}

async function getSyncStaleness(): Promise<SiteStalenessSummary[]> {
  const supabase = getServiceRoleClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("micros_connections")
    .select("id, last_successful_sync_at, site_id, sites ( name )");

  if (error) throw new Error(`sync-staleness: ${error.message}`);

  const validRows = safeParseRows(
    (data ?? []) as unknown[],
    MicrosConnectionStalenessRowSchema,
    "platform-health/sync-staleness",
  );

  return validRows.map((row) => {
    const lastAt = row.last_successful_sync_at
      ? new Date(row.last_successful_sync_at)
      : null;
    const minutesSince = lastAt
      ? Math.round((Date.now() - lastAt.getTime()) / 60_000)
      : null;

    return {
      siteId:           row.site_id,
      siteName:         row.sites?.name ?? "Unknown",
      lastSuccessAt:    lastAt?.toISOString() ?? null,
      minutesSinceLast: minutesSince,
      status:           classifyStaleness(minutesSince),
    };
  });
}

// ── Zombie sync run detection ─────────────────────────────────────────────────

const ZOMBIE_ALERT_MINUTES = 30;

interface ZombieRunSummary {
  runId:          string;
  siteName:       string;
  syncType:       string;
  startedAt:      string;
  runningMinutes: number;
  severity:       "WARNING" | "CRITICAL";
}

async function getZombieRuns(): Promise<ZombieRunSummary[]> {
  const supabase = getServiceRoleClient();
  const cutoff   = new Date(Date.now() - ZOMBIE_ALERT_MINUTES * 60_000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("micros_sync_runs")
    .select("id, sync_type, started_at, connection_id, micros_connections ( site_id, sites ( name ) )")
    .eq("status", "running")
    .lt("started_at", cutoff)
    .order("started_at", { ascending: true });

  if (error) throw new Error(`zombie-runs: ${error.message}`);

  const validRows = safeParseRows(
    (data ?? []) as unknown[],
    MicrosSyncRunZombieRowSchema,
    "platform-health/zombie-runs",
  );

  return validRows.map((row) => {
    const startedAt      = new Date(row.started_at);
    const runningMinutes = Math.round((Date.now() - startedAt.getTime()) / 60_000);

    return {
      runId:          row.id,
      siteName:       row.micros_connections?.sites?.name ?? "Unknown",
      syncType:       row.sync_type,
      startedAt:      startedAt.toISOString(),
      runningMinutes,
      severity:       runningMinutes >= 60 ? "CRITICAL" : "WARNING",
    } satisfies ZombieRunSummary;
  });
}

// ── MPS scoring coverage ──────────────────────────────────────────────────────

interface MpsCoverageSummary {
  siteId:      string;
  siteName:    string;
  lastScoreAt: string | null;
  hasScore24h: boolean;
  status:      "OK" | "MISSING";
}

async function getMpsCoverage(): Promise<MpsCoverageSummary[]> {
  const supabase  = getServiceRoleClient();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Get all active sites
  const { data: sites, error: siteErr } = await supabase
    .from("sites")
    .select("id, name")
    .eq("is_active", true);

  if (siteErr) throw new Error(`mps-coverage sites: ${siteErr.message}`);

  // Get latest MPS score per site for last 24h
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scores, error: scoreErr } = await (supabase as any)
    .from("manager_performance_scores")
    .select("site_id, period_date")
    .gte("period_date", yesterday)
    .order("period_date", { ascending: false });

  if (scoreErr) throw new Error(`mps-coverage scores: ${scoreErr.message}`);

  const validScores = safeParseRows(
    (scores ?? []) as unknown[],
    MpsScoreCoverageRowSchema,
    "platform-health/mps-coverage",
  );

  const sitesWithRecentScores = new Set(validScores.map((s) => s.site_id));

  return (sites ?? []).map((site) => ({
    siteId:      site.id,
    siteName:    site.name,
    lastScoreAt: validScores.find((s) => s.site_id === site.id)?.period_date ?? null,
    hasScore24h: sitesWithRecentScores.has(site.id),
    status:      sitesWithRecentScores.has(site.id) ? "OK" : "MISSING",
  }));
}

// ── Overall severity rollup ───────────────────────────────────────────────────

type OverallSeverity = "HEALTHY" | "WARNING" | "CRITICAL";

function rollupSeverity(
  tokenStatus:    TokenExpiryStatus,
  stalenessItems: SiteStalenessSummary[],
  zombies:        ZombieRunSummary[],
  mps:            MpsCoverageSummary[],
): OverallSeverity {
  if (
    tokenStatus === "CRITICAL" ||
    stalenessItems.some((s) => s.status === "RED") ||
    zombies.some((z) => z.severity === "CRITICAL")
  ) {
    return "CRITICAL";
  }
  if (
    tokenStatus === "HIGH" ||
    tokenStatus === "WARNING" ||
    stalenessItems.some((s) => s.status === "AMBER") ||
    zombies.length > 0 ||
    mps.some((m) => m.status === "MISSING")
  ) {
    return "WARNING";
  }
  return "HEALTHY";
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const allowed = await authorize(req);
  if (!allowed) {
    return jsonError("FORBIDDEN", "Forbidden", {
      status: 403,
      meta: { durationMs: Date.now() - t0, source: "admin-platform-health" },
    });
  }

  try {
    // Run all health checks in parallel
    const [tokenReport, staleness, zombies, mpsCoverage] = await Promise.allSettled([
      getTokenExpiryReport(),
      getSyncStaleness(),
      getZombieRuns(),
      getMpsCoverage(),
    ]);

    const token     = tokenReport.status === "fulfilled" ? tokenReport.value     : null;
    const stale     = staleness.status   === "fulfilled" ? staleness.value       : [];
    const zombie    = zombies.status     === "fulfilled" ? zombies.value         : [];
    const mps       = mpsCoverage.status === "fulfilled" ? mpsCoverage.value     : [];

    const errors: string[] = [];
    if (tokenReport.status === "rejected") errors.push(`token: ${tokenReport.reason?.message}`);
    if (staleness.status   === "rejected") errors.push(`staleness: ${staleness.reason?.message}`);
    if (zombies.status     === "rejected") errors.push(`zombies: ${zombies.reason?.message}`);
    if (mpsCoverage.status === "rejected") errors.push(`mps: ${mpsCoverage.reason?.message}`);

    const overall = rollupSeverity(
      token?.overall ?? "NO_DATA",
      stale,
      zombie,
      mps,
    );

    if (overall !== "HEALTHY") {
      logger.warn("platform-health: degraded state detected", {
        overall,
        tokenOverall:     token?.overall,
        redStaleness:     stale.filter((s) => s.status === "RED").map((s) => s.siteName),
        criticalZombies:  zombie.filter((z) => z.severity === "CRITICAL").length,
        missingMps:       mps.filter((m) => m.status === "MISSING").map((m) => m.siteName),
      });
    }

    return jsonSuccess(
      {
        asOf:       new Date().toISOString(),
        overall,
        durationMs: Date.now() - t0,
        tokenExpiry: token,
        syncStaleness: {
          items:      stale,
          redCount:   stale.filter((s) => s.status === "RED").length,
          amberCount: stale.filter((s) => s.status === "AMBER").length,
          greenCount: stale.filter((s) => s.status === "GREEN").length,
        },
        zombieSyncRuns: {
          items:         zombie,
          criticalCount: zombie.filter((z) => z.severity === "CRITICAL").length,
          warningCount:  zombie.filter((z) => z.severity === "WARNING").length,
        },
        mpsCoverage: {
          items:        mps,
          missingCount: mps.filter((m) => m.status === "MISSING").length,
          coveredCount: mps.filter((m) => m.status === "OK").length,
        },
        errors: errors.length > 0 ? errors : null,
      },
      { meta: { durationMs: Date.now() - t0, source: "admin-platform-health" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("platform-health: unhandled error", { error: message });
    return jsonError("PLATFORM_HEALTH_FAILED", "Platform health check failed", {
      status: 500,
      details: message,
      meta: { durationMs: Date.now() - t0, source: "admin-platform-health" },
    });
  }
}
