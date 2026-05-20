/**
 * GET /api/admin/sync-logs — paginated sync_runs + error summary
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "GET /api/admin/sync-logs");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
    const siteFilter = url.searchParams.get("site_id") ?? null;
    const statusFilter = url.searchParams.get("status") ?? null;
    const offset = (page - 1) * limit;

    // Build runs query
    let query = supabase
      .from("sync_runs")
      .select("*", { count: "exact" })
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Scope to org unless super_admin
    if (!isSuperAdmin(ctx)) {
      const { data: orgSites } = await supabase
        .from("sites")
        .select("id")
        .eq("organisation_id", ctx.orgId ?? "");
      const ids = (orgSites ?? []).map((s: any) => s.id);
      if (ids.length > 0) query = query.in("site_id", ids);
      else return NextResponse.json({ runs: [], errors: [], total: 0, page, limit });
    }

    if (siteFilter) query = query.eq("site_id", siteFilter);
    if (statusFilter) query = query.eq("status", statusFilter);

    const { data: runs, count } = await query;

    // Fetch recent errors
    let errQuery = supabase
      .from("sync_errors")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25);

    if (siteFilter) errQuery = errQuery.eq("site_id", siteFilter);

    const { data: errors } = await errQuery;

    // Fetch store names for display
    const siteIds = Array.from(new Set((runs ?? []).map((r: any) => r.site_id)));
    let storeMap: Record<string, string> = {};
    if (siteIds.length > 0) {
      const { data: stores } = await supabase
        .from("sites")
        .select("id, name")
        .in("id", siteIds);
      storeMap = Object.fromEntries((stores ?? []).map((s: any) => [s.id, s.name]));
    }

    const enrichedRuns = (runs ?? []).map((r: any) => ({
      ...r,
      store_name: storeMap[r.site_id] ?? "Unknown",
    }));

    return NextResponse.json({
      runs: enrichedRuns,
      errors: errors ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    logger.error("Sync logs GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
