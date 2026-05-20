/**
 * GET /api/system-health/checks
 *
 * Lightweight, programmatically-consumable health checks.
 * Complements the full /api/system-health UI payload with a simple
 * { ok, generatedAt, checks[] } contract suitable for monitoring tools,
 * dashboards, and automated deployment verification.
 *
 * Access: super_admin | head_office | executive | auditor
 *
 * Each check is independently try/caught — a DB error in one check never
 * prevents the others from running.  Unknown/uninstrumented checks return
 * status: "unknown" rather than faking health.
 */

import { NextResponse }           from "next/server";
import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { createClient }           from "@supabase/supabase-js";
import { logger }                 from "@/lib/logger";

export const dynamic = "force-dynamic";

const ELEVATED = new Set(["super_admin", "head_office", "executive", "auditor", "area_manager"]);

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = "healthy" | "warning" | "critical" | "unknown";

interface HealthCheck {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
  siteId?: string;
  lastSeenAt?: string | null;
}

interface ChecksPayload {
  ok: boolean;
  generatedAt: string;
  checks: HealthCheck[];
}

// ── Service-role client (bypasses RLS — needed to read micros_connections) ────

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

// ── Individual check runners ──────────────────────────────────────────────────

/** Check 1: MICROS connectivity per site */
async function checkMicrosConnections(): Promise<HealthCheck[]> {
  try {
    const db = serviceDb();
    const { data, error } = await db
      .from("micros_connections")
      .select("site_id, status, loc_ref, last_sync_at, last_sync_error")
      .order("site_id");

    if (error) {
      return [{
        key: "micros_connections",
        label: "MICROS Connections",
        status: "unknown",
        message: `Query failed: ${error.message}`,
      }];
    }

    const rows = (data ?? []) as Array<{
      site_id: string;
      status: string | null;
      loc_ref: string | null;
      last_sync_at: string | null;
      last_sync_error: string | null;
    }>;

    if (rows.length === 0) {
      return [{
        key: "micros_connections",
        label: "MICROS Connections",
        status: "warning",
        message: "No MICROS connections configured for any site",
      }];
    }

    return rows.map((row) => {
      const connected = row.status === "connected";
      const hasError  = !!row.last_sync_error;
      const status: CheckStatus =
        connected && !hasError ? "healthy" :
        connected && hasError  ? "warning" :
        "critical";
      return {
        key:       `micros_connection_${row.site_id.slice(-8)}`,
        label:     `MICROS · site ${row.site_id.slice(-8)}`,
        status,
        message:   connected
          ? (hasError ? `Connected with error: ${row.last_sync_error}` : `Connected — loc: ${row.loc_ref ?? "?"}`)
          : `Status: ${row.status ?? "unknown"}`,
        siteId:    row.site_id,
        lastSeenAt: row.last_sync_at,
      };
    });
  } catch (err) {
    return [{
      key: "micros_connections",
      label: "MICROS Connections",
      status: "unknown",
      message: `Check failed: ${String(err)}`,
    }];
  }
}

/** Check 2: Most recent successful MICROS sync */
async function checkLastSync(): Promise<HealthCheck> {
  try {
    const db = serviceDb();
    const { data, error } = await db
      .from("micros_sync_runs")
      .select("started_at, completed_at, status, error_message")
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return {
        key: "last_sync",
        label: "Last Successful Sync",
        status: "unknown",
        message: `Query failed: ${error.message}`,
      };
    }

    if (!data) {
      return {
        key: "last_sync",
        label: "Last Successful Sync",
        status: "warning",
        message: "No successful sync runs recorded",
        lastSeenAt: null,
      };
    }

    const row = data as { started_at: string; completed_at: string | null; status: string; error_message: string | null };
    const completedAt = row.completed_at ?? row.started_at;
    const ageMinutes  = (Date.now() - new Date(completedAt).getTime()) / 60_000;

    const status: CheckStatus =
      ageMinutes <= 60  ? "healthy" :
      ageMinutes <= 180 ? "warning" :
      "critical";

    return {
      key: "last_sync",
      label: "Last Successful Sync",
      status,
      message: status === "healthy"
        ? `Synced ${Math.round(ageMinutes)} min ago`
        : `Last sync was ${Math.round(ageMinutes / 60)} hours ago — sync may be delayed`,
      lastSeenAt: completedAt,
    };
  } catch (err) {
    return {
      key: "last_sync",
      label: "Last Successful Sync",
      status: "unknown",
      message: `Check failed: ${String(err)}`,
    };
  }
}

/** Check 3: RLS hardening status (migration 088) */
async function checkRlsHardening(): Promise<HealthCheck> {
  // pg_policies is a system catalog view — not queryable via PostgREST.
  // This check is manual. Return "unknown" with clear instructions.
  // Tier-4: add a Supabase RPC (verify_rls_policies()) to automate this.
  return {
    key: "rls_hardening",
    label: "RLS Hardening (Migration 088)",
    status: "unknown",
    message:
      "Cannot verify automatically — requires pg_policies access. " +
      "Manual check: confirm policies auth_select_zone_snapshots, auth_select_sales_uploads, " +
      "auth_select_dol exist in Supabase Dashboard → Table Editor → RLS. " +
      "Migration 088 was deployed 2026-05-19.",
  };
}

/** Check 4: Stale labour data per site */
async function checkLabourFreshness(): Promise<HealthCheck[]> {
  try {
    const db = serviceDb();
    // Check micros_labour_daily for recent records (within 24h)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (db.from("micros_labour_daily") as any)
      .select("site_id, business_date, created_at")
      .order("business_date", { ascending: false })
      .limit(20);

    if (error) {
      return [{
        key: "labour_freshness",
        label: "Labour Data Freshness",
        status: "unknown",
        message: `Table not instrumented or query failed: ${error.message}`,
      }];
    }

    const rows = (data ?? []) as Array<{ site_id: string; business_date: string; created_at: string }>;
    if (rows.length === 0) {
      return [{
        key: "labour_freshness",
        label: "Labour Data Freshness",
        status: "warning",
        message: "No labour records found in micros_labour_daily",
        lastSeenAt: null,
      }];
    }

    // Group by site_id, take latest per site
    const latestBySite = new Map<string, { business_date: string; created_at: string }>();
    for (const row of rows) {
      if (!latestBySite.has(row.site_id)) {
        latestBySite.set(row.site_id, { business_date: row.business_date, created_at: row.created_at });
      }
    }

    const today = new Date().toISOString().split("T")[0];
    return Array.from(latestBySite.entries()).map(([siteId, latest]) => {
      const ageHours = (Date.now() - new Date(latest.created_at).getTime()) / 3_600_000;
      const hasToday = latest.business_date === today;
      const status: CheckStatus =
        hasToday && ageHours <= 2 ? "healthy" :
        hasToday                  ? "warning" :
        ageHours <= 26            ? "warning" :
        "critical";
      return {
        key:       `labour_freshness_${siteId.slice(-8)}`,
        label:     `Labour Freshness · site ${siteId.slice(-8)}`,
        status,
        message: hasToday
          ? `Today's data present — ${Math.round(ageHours * 60)} min old`
          : `No data for today — last record: ${latest.business_date}`,
        siteId,
        lastSeenAt: latest.created_at,
      };
    });
  } catch (err) {
    return [{
      key: "labour_freshness",
      label: "Labour Data Freshness",
      status: "unknown",
      message: `Table not instrumented: ${String(err)}`,
    }];
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err) {
    return authErrorResponse(err);
  }

  if (!ELEVATED.has(ctx.role ?? "")) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 },
    );
  }

  // ── Run all checks in parallel ─────────────────────────────────────────────
  const generatedAt = new Date().toISOString();

  const [microsChecks, lastSyncCheck, rlsCheck, labourChecks] = await Promise.all([
    checkMicrosConnections(),
    checkLastSync(),
    checkRlsHardening(),
    checkLabourFreshness(),
  ]);

  const checks: HealthCheck[] = [
    ...microsChecks,
    lastSyncCheck,
    rlsCheck,
    ...labourChecks,
  ];

  const ok = checks.every(c => c.status !== "critical");

  logger.info("api.system-health.checks", {
    userId: ctx.userId,
    role: ctx.role,
    checksCount: checks.length,
    criticalCount: checks.filter(c => c.status === "critical").length,
    ok,
  });

  const payload: ChecksPayload = { ok, generatedAt, checks };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
