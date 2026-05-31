/**
 * GET /api/head-office/system-health
 *
 * Returns per-store data freshness and sync health from v_site_health_summary.
 * Reads only from contract-layer views — no raw table queries.
 *
 * Response: { data: SystemHealthRow[], summary: HealthSummary, error: string | null }
 */

import { getUserContext, authErrorResponse } from "@/lib/auth/get-user-context";
import { getTokenExpiryReport } from "@/lib/monitoring/token-expiry";
import { logger } from "@/lib/logger";
import { ELEVATED_ROLES } from "@/lib/rbac/roles";
import type { VSiteHealth } from "@/lib/admin/contractTypes";
import { getServiceRoleClient } from "@/lib/supabase/service-role-client";
import { jsonCompatError, jsonCompatSuccess } from "@/lib/api/response";

export const dynamic = "force-dynamic";


function serviceDb() {
  return getServiceRoleClient();
}

export async function GET() {
  const startedAt = Date.now();
  let ctx;
  try {
    ctx = await getUserContext();
  } catch (err: unknown) {
    return authErrorResponse(err);
  }

  if (!ELEVATED_ROLES.has(ctx.role)) {
    return jsonCompatError(
      { data: [], summary: null, tokenExpiry: null, error: "Insufficient permissions" },
      "FORBIDDEN",
      "Insufficient permissions",
      {
        status: 403,
        meta: { durationMs: Date.now() - startedAt, source: "head-office-system-health" },
      },
    );
  }

  const db = serviceDb() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  try {
    const isSuperAdmin = ctx.role === "super_admin";

    // Resolve visible org IDs
    const { data: roleRows } = await db
      .from("user_roles")
      .select("organisation_id")
      .eq("user_id", ctx.userId)
      .eq("is_active", true)
      .in("role", Array.from(ELEVATED_ROLES));

    const orgIds: string[] = Array.from(
      new Set(
        ((roleRows ?? []) as any[])
          .map((r: any) => r.organisation_id as string | null)
          .filter((id): id is string => !!id),
      ),
    );

    // Query v_site_health_summary — contract-layer view, no raw tables
    const q = db
      .from("v_site_health_summary")
      .select("site_id, store_name, store_code, is_active, org_id, integration_status, last_sync_at, stale_minutes, last_sales_date, recent_errors, failed_runs, health")
      .eq("is_active", true)
      .order("health", { ascending: true }); // critical first alphabetically, reorder in JS

    if (!isSuperAdmin && orgIds.length > 0) {
      q.in("org_id", orgIds);
    }

    const { data, error } = await q;

    if (error) {
      logger.error("System health query failed", { err: error });
      return jsonCompatError(
        { data: [], summary: null, tokenExpiry: null, error: "System health query failed" },
        "SYSTEM_HEALTH_QUERY_FAILED",
        "System health query failed",
        {
          status: 500,
          details: error.message,
          meta: { durationMs: Date.now() - startedAt, source: "head-office-system-health" },
        },
      );
    }

    const rows = (data as VSiteHealth[] | null) ?? [];

    // Summary counters
    const summary = {
      total:    rows.length,
      healthy:  rows.filter((r) => r.health === "healthy").length,
      warning:  rows.filter((r) => r.health === "warning").length,
      critical: rows.filter((r) => r.health === "critical").length,
      unknown:  rows.filter((r) => r.health === "unknown").length,
      stale_count: rows.filter((r) => r.stale_minutes !== null && r.stale_minutes > 1440).length,
      with_errors: rows.filter((r) => r.recent_errors > 0).length,
      last_sync_at: rows
        .map((r) => r.last_sync_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null,
    };

    // Map to a lean shape for the UI
    const stores = rows.map((r) => ({
      site_id:          r.site_id,
      store_name:       r.store_name,
      store_code:       r.store_code,
      health:           r.health,
      integration_status: r.integration_status,
      last_sync_at:     r.last_sync_at,
      stale_minutes:    r.stale_minutes,
      last_sales_date:  r.last_sales_date,
      recent_errors:    r.recent_errors,
      failed_runs:      r.failed_runs,
    }));

    // ── Token expiry monitoring (non-fatal if it fails) ─────────────────────
    let tokenExpiry = null;
    try {
      tokenExpiry = await getTokenExpiryReport();
    } catch (tokenErr) {
      logger.warn("System health: token expiry check failed (non-fatal)", {
        error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr),
      });
    }

    return jsonCompatSuccess(
      { data: stores, summary, tokenExpiry, error: null },
      { stores, summary, tokenExpiry },
      {
        meta: {
          durationMs: Date.now() - startedAt,
          organisationId: isSuperAdmin ? undefined : orgIds[0],
          source: "head-office-system-health",
        },
      },
    );
  } catch (err) {
    logger.error("System health route failed", { err });
    return jsonCompatError(
      { data: [], summary: null, tokenExpiry: null, error: "Internal server error" },
      "SYSTEM_HEALTH_FAILED",
      "Internal server error",
      {
        status: 500,
        meta: { durationMs: Date.now() - startedAt, source: "head-office-system-health" },
      },
    );
  }
}
