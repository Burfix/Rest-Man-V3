/**
 * GET /api/admin/verify-counts
 *
 * Contract-layer integrity check.
 *
 * INVARIANTS that must hold:
 *   overview.totalStores === stores tab count (v_stores)
 *   overview.totalUsers  === users tab count  (v_users)
 *   overview.integrationCount === integrations tab connected count (v_integrations)
 *
 * Returns { ok: true } when all invariants pass.
 * Returns { ok: false, failures: [...] } with details when any fail.
 *
 * This endpoint is super_admin only and is never called by the UI.
 * Use it in staging/production to assert the contract layer is healthy
 * after migrations or data changes.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface Failure {
  invariant: string;
  expected: number;
  actual: number;
}

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/verify-counts");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  // Super-admin only — this endpoint reveals aggregate counts across all orgs
  if (ctx.role !== "super_admin") {
    return NextResponse.json({ error: "super_admin required" }, { status: 403 });
  }

  try {
    // Run three view queries in parallel
    const [tenantRes, storesRes, usersRes, integrationsRes] = await Promise.all([
      supabase.from("v_tenant_summary").select("total_stores, active_stores, total_users, connected_integrations"),
      supabase.from("v_stores").select("id", { count: "exact", head: true }),
      supabase.from("v_users").select("user_id", { count: "exact", head: true }),
      supabase
        .from("v_integrations")
        .select("store_id", { count: "exact", head: true })
        .eq("micros_status", "connected"),
    ]);

    const tenantRows = tenantRes.data ?? [];

    // Derived totals from v_tenant_summary
    const summaryTotalStores  = tenantRows.reduce((s: number, r: any) => s + Number(r.total_stores ?? 0), 0);
    const summaryTotalUsers   = tenantRows.reduce((s: number, r: any) => s + Number(r.total_users ?? 0), 0);
    const summaryConnected    = tenantRows.reduce((s: number, r: any) => s + Number(r.connected_integrations ?? 0), 0);

    // Actual row counts from the view queries
    const viewStoreCount       = storesRes.count ?? 0;
    const viewUserCount        = usersRes.count ?? 0;
    const viewConnectedCount   = integrationsRes.count ?? 0;

    const failures: Failure[] = [];

    if (summaryTotalStores !== viewStoreCount) {
      failures.push({
        invariant: "v_tenant_summary.total_stores === COUNT(v_stores)",
        expected: summaryTotalStores,
        actual: viewStoreCount,
      });
    }

    if (summaryTotalUsers !== viewUserCount) {
      failures.push({
        invariant: "v_tenant_summary.total_users === COUNT(v_users)",
        expected: summaryTotalUsers,
        actual: viewUserCount,
      });
    }

    if (summaryConnected !== viewConnectedCount) {
      failures.push({
        invariant: "v_tenant_summary.connected_integrations === COUNT(v_integrations WHERE micros_status='connected')",
        expected: summaryConnected,
        actual: viewConnectedCount,
      });
    }

    if (failures.length > 0) {
      logger.error("Admin contract invariants violated", { failures });
      return NextResponse.json({ ok: false, failures });
    }

    return NextResponse.json({
      ok: true,
      counts: {
        total_stores: viewStoreCount,
        total_users: viewUserCount,
        connected_integrations: viewConnectedCount,
      },
    });
  } catch (err) {
    logger.error("verify-counts failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
