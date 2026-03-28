/**
 * GET /api/admin/data-health — cross-store data freshness overview
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/data-health");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Fetch all stores
    const storeQuery = supabase.from("sites").select("id, name, store_code, is_active, organisation_id");
    if (!isSuperAdmin(ctx) && ctx.orgId) storeQuery.eq("organisation_id", ctx.orgId);
    const { data: stores } = await storeQuery;

    const siteIds = (stores ?? []).map((s: any) => s.id);
    if (siteIds.length === 0) return NextResponse.json({ stores: [] });

    // Fetch MICROS connections for sync status
    const { data: connections } = await supabase
      .from("micros_connections")
      .select("site_id, status, last_sync_at")
      .in("site_id", siteIds);

    // Fetch latest sync runs per store
    const { data: recentRuns } = await supabase
      .from("sync_runs")
      .select("site_id, sync_type, status, started_at, finished_at, records_fetched")
      .in("site_id", siteIds)
      .order("started_at", { ascending: false })
      .limit(100);

    // Fetch recent sync errors
    const { data: errors } = await supabase
      .from("sync_errors")
      .select("site_id, sync_type, message, created_at")
      .in("site_id", siteIds)
      .order("created_at", { ascending: false })
      .limit(50);

    // Fetch latest sales date per store
    const { data: latestSales } = await supabase
      .from("daily_sales_summary")
      .select("site_id, business_date")
      .in("site_id", siteIds)
      .order("business_date", { ascending: false })
      .limit(siteIds.length);

    const now = Date.now();
    const connMap = new Map((connections ?? []).map((c: any) => [c.site_id, c]));
    const salesMap = new Map<string, string>();
    for (const s of (latestSales ?? []) as any[]) {
      if (!salesMap.has(s.site_id)) salesMap.set(s.site_id, s.business_date);
    }

    // Build per-store health
    const storeHealth = (stores ?? []).map((store: any) => {
      const conn = connMap.get(store.id) as any;
      const lastSync = conn?.last_sync_at ? new Date(conn.last_sync_at) : null;
      const lastSalesDate = salesMap.get(store.id) ?? null;
      const staleMinutes = lastSync ? Math.floor((now - lastSync.getTime()) / 60000) : null;
      const storeRuns = ((recentRuns ?? []) as any[]).filter((r: any) => r.site_id === store.id);
      const storeErrors = ((errors ?? []) as any[]).filter((e: any) => e.site_id === store.id);
      const failedRuns = storeRuns.filter((r: any) => r.status === "failed").length;

      let health: "healthy" | "warning" | "critical" | "unknown" = "unknown";
      if (staleMinutes === null) health = "unknown";
      else if (staleMinutes < 120 && failedRuns === 0) health = "healthy";
      else if (staleMinutes < 1440) health = "warning";
      else health = "critical";

      return {
        id: store.id,
        name: store.name,
        store_code: store.store_code,
        is_active: store.is_active,
        integration_status: conn?.status ?? "none",
        last_sync_at: conn?.last_sync_at ?? null,
        stale_minutes: staleMinutes,
        last_sales_date: lastSalesDate,
        recent_errors: storeErrors.length,
        failed_runs: failedRuns,
        health,
      };
    });

    const summary = {
      total: storeHealth.length,
      healthy: storeHealth.filter((s) => s.health === "healthy").length,
      warning: storeHealth.filter((s) => s.health === "warning").length,
      critical: storeHealth.filter((s) => s.health === "critical").length,
      unknown: storeHealth.filter((s) => s.health === "unknown").length,
    };

    return NextResponse.json({ stores: storeHealth, summary });
  } catch (err) {
    logger.error("Data health GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
