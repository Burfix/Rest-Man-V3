/**
 * GET /api/admin/overview — enhanced admin dashboard summary stats
 *
 * Reads aggregate counts from v_tenant_summary (migration 065) instead of
 * running 5 parallel queries + JS joins. Role distribution and weekly revenue
 * still use direct queries as they have no corresponding contract view.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";
import type { VTenantSummary, VStore, VRoleDistribution, VAuditSummary } from "@/lib/admin/contractTypes";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/overview");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const unrestricted = isSuperAdmin(ctx);
    const orgId = ctx.orgId;

    if (!unrestricted && !orgId) {
      return NextResponse.json({ data: null, error: "No organisation" }, { status: 400 });
    }

    // --- Core aggregate counts from contract-layer view ----------------------
    // v_tenant_summary replaces 3 of the 5 parallel queries + JS joins.
    // One query now returns: totalStores, activeStores, totalUsers,
    // activeToday, connectedIntegrations, staleIntegrations — per org.
    const tenantQ = supabase.from("v_tenant_summary").select("*");
    if (!unrestricted && orgId) tenantQ.eq("org_id", orgId);

    // --- Role distribution (v_role_distribution — migration 066) ------------
    // Replaces live scan of user_roles + JS accumulation.
    const roleQ = supabase
      .from("v_role_distribution")
      .select("org_id, role, member_count");
    if (!unrestricted && orgId) roleQ.eq("org_id", orgId);

    // --- Audit count (v_audit_summary — migration 066) -----------------------
    // Replaces COUNT(*head) on access_audit_log.
    const auditQ = supabase
      .from("v_audit_summary")
      .select("org_id, audit_count");
    if (!unrestricted && orgId) auditQ.eq("org_id", orgId);

    // --- Store list for the overview sub-panel (from v_stores) ---------------
    const storeListQ = supabase
      .from("v_stores")
      .select("id, name, is_active, store_code, org_id");
    if (!unrestricted && orgId) storeListQ.eq("org_id", orgId);

    const [tenantRes, rolesRes, auditRes, storeListRes] = await Promise.all([
      tenantQ,
      roleQ,
      auditQ,
      storeListQ,
    ]);

    const tenantRows = ((tenantRes.data as VTenantSummary[] | null) ?? []);

    if (tenantRows.length === 0 && !tenantRes.error) {
      logger.warn("ADMIN_API_EMPTY_DATA", {
        route: "GET /api/admin/overview",
        view: "v_tenant_summary",
        orgId,
        unrestricted,
        timestamp: new Date().toISOString(),
      });
    }

    // Aggregate summary totals across visible orgs
    const totalStores       = tenantRows.reduce((s, r) => s + Number(r.total_stores ?? 0), 0);
    const activeStores      = tenantRows.reduce((s, r) => s + Number(r.active_stores ?? 0), 0);
    const totalUsers        = tenantRows.reduce((s, r) => s + Number(r.total_users ?? 0), 0);
    const activeToday       = tenantRows.reduce((s, r) => s + Number(r.active_today ?? 0), 0);
    const integrationCount  = tenantRows.reduce((s, r) => s + Number(r.connected_integrations ?? 0), 0);
    const staleCount        = tenantRows.reduce((s, r) => s + Number(r.stale_integrations ?? 0), 0);
    const totalOrgs         = tenantRows.length;

    // Org breakdown — keyed by org_id for the UI breakdown widget
    const orgBreakdown: Record<string, { name: string; stores: number; users: number }> = {};
    for (const ts of tenantRows) {
      orgBreakdown[ts.org_id] = {
        name: ts.org_name,
        stores: Number(ts.active_stores ?? 0),
        users: Number(ts.total_users ?? 0),
      };
    }

    // Role distribution from v_role_distribution (view, not raw user_roles)
    const roleCounts: Record<string, number> = {};
    for (const r of ((rolesRes.data as VRoleDistribution[] | null) ?? [])) {
      roleCounts[r.role] = (roleCounts[r.role] ?? 0) + Number(r.member_count ?? 0);
    }
    const activeRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);

    // Audit count from v_audit_summary (view, not raw access_audit_log COUNT)
    const auditEntries = ((auditRes.data as VAuditSummary[] | null) ?? [])
      .reduce((s, r) => s + Number(r.audit_count ?? 0), 0);

    // --- Weekly revenue (last 7 days from daily_sales_summary view) ----------
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().slice(0, 10);

    const salesQ = supabase
      .from("daily_sales_summary")
      .select("net_sales")
      .gte("business_date", weekStr);
    if (!unrestricted && orgId) {
      // Scope to org's site ids
      const siteIds = ((storeListRes.data ?? []) as VStore[]).map((s) => s.id);
      if (siteIds.length > 0) salesQ.in("site_id", siteIds);
    }

    const { data: salesRows } = await salesQ;
    const weeklyRevenue = (salesRows ?? []).reduce(
      (sum: number, r: any) => sum + (Number(r.net_sales) || 0),
      0,
    );

    return NextResponse.json({ error: null, data: {
      totalStores,
      activeStores,
      totalUsers,
      activeRoles,
      auditEntries,
      roleCounts,
      totalOrgs,
      activeToday,
      integrationCount,
      staleStores: staleCount,
      weeklyRevenue,
      orgBreakdown,
      stores: ((storeListRes.data as VStore[] | null) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        is_active: s.is_active,
        store_code: s.store_code,
      })),
    } });
  } catch (err) {
    logger.error("Admin overview failed", { err });
    return NextResponse.json({ data: null, error: "Internal server error" }, { status: 500 });
  }
}
