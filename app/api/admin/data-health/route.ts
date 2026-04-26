/**
 * GET /api/admin/data-health — cross-store data freshness overview
 *
 * Reads from v_site_health_summary (migration 065).
 * Health classification, staleness, and error counts are computed in SQL.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";
import type { VSiteHealth } from "@/lib/admin/contractTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/data-health");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Single query replacing 5-query + JS join pattern.
    // Health is classified in SQL using canonical thresholds.
    const q = supabase
      .from("v_site_health_summary")
      .select("site_id, store_name, store_code, is_active, org_id, integration_status, last_sync_at, stale_minutes, last_sales_date, recent_errors, failed_runs, health")
      .order("store_name");
    if (!isSuperAdmin(ctx) && ctx.orgId) q.eq("org_id", ctx.orgId);

    const { data, error } = await q;

    if (error) {
      logger.error("Data health GET failed", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const stores = ((data as VSiteHealth[] | null) ?? []).map((r) => ({
      id: r.site_id,
      name: r.store_name,
      store_code: r.store_code,
      is_active: r.is_active,
      integration_status: r.integration_status,
      last_sync_at: r.last_sync_at,
      stale_minutes: r.stale_minutes,
      last_sales_date: r.last_sales_date,
      recent_errors: Number(r.recent_errors ?? 0),
      failed_runs: Number(r.failed_runs ?? 0),
      health: r.health,
    }));

    const summary = {
      total:    stores.length,
      healthy:  stores.filter((s) => s.health === "healthy").length,
      warning:  stores.filter((s) => s.health === "warning").length,
      critical: stores.filter((s) => s.health === "critical").length,
      unknown:  stores.filter((s) => s.health === "unknown").length,
    };

    return NextResponse.json({ stores, summary });
  } catch (err) {
    logger.error("Data health GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
