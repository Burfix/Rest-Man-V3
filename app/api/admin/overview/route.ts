/**
 * GET /api/admin/overview — enhanced admin dashboard summary stats
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/overview");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const unrestricted = isSuperAdmin(ctx);
    const orgId = ctx.orgId;

    if (!unrestricted && !orgId) {
      return NextResponse.json({ error: "No organisation" }, { status: 400 });
    }

    // --- Core counts ---------------------------------------------------------
    const storeQ = supabase.from("sites").select("id, name, is_active, store_code, organisation_id", { count: "exact" });
    if (!unrestricted && orgId) storeQ.eq("organisation_id", orgId);

    const roleQ = supabase.from("user_roles").select("role, is_active, organisation_id").eq("is_active", true);
    if (!unrestricted && orgId) roleQ.eq("organisation_id", orgId);

    const [storesRes, usersRes, rolesRes, auditRes, orgsRes] = await Promise.all([
      storeQ,
      supabase.from("profiles").select("id, email, full_name, last_seen_at", { count: "exact" }),
      roleQ,
      supabase.from("access_audit_log").select("id", { count: "exact" }),
      supabase.from("organisations").select("id, name, slug", { count: "exact" }),
    ]);

    const stores = storesRes.data ?? [];
    const totalStores = storesRes.count ?? stores.length;
    const activeStores = stores.filter((s: any) => s.is_active).length;
    const totalUsers = usersRes.count ?? 0;
    const auditEntries = auditRes.count ?? 0;
    const totalOrgs = orgsRes.count ?? 0;

    // Role distribution
    const roleCounts: Record<string, number> = {};
    for (const r of (rolesRes.data ?? []) as any[]) {
      roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;
    }
    const activeRoles = Object.values(roleCounts).reduce((a, b) => a + b, 0);

    // --- Active users today --------------------------------------------------
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const activeToday = ((usersRes.data ?? []) as any[]).filter(
      (u: any) => u.last_seen_at && new Date(u.last_seen_at) >= todayStart
    ).length;

    // --- Integration stats ---------------------------------------------------
    const siteIds = stores.map((s: any) => s.id);
    let integrationCount = 0;
    let staleCount = 0;
    if (siteIds.length > 0) {
      const { data: conns } = await supabase
        .from("micros_connections")
        .select("site_id, status, last_sync_at")
        .in("site_id", siteIds);
      const now = Date.now();
      integrationCount = (conns ?? []).filter((c: any) => c.status === "connected").length;
      staleCount = (conns ?? []).filter((c: any) => {
        if (!c.last_sync_at) return true;
        return now - new Date(c.last_sync_at).getTime() > 24 * 60 * 60 * 1000;
      }).length;
    }

    // --- Weekly revenue (last 7 days) ----------------------------------------
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = weekAgo.toISOString().slice(0, 10);

    const salesQ = supabase
      .from("daily_sales_summary")
      .select("net_sales")
      .gte("business_date", weekStr);
    if (siteIds.length > 0 && !unrestricted) salesQ.in("site_id", siteIds);

    const { data: salesRows } = await salesQ;
    const weeklyRevenue = (salesRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.net_sales) || 0), 0);

    // --- Org breakdown -------------------------------------------------------
    const orgBreakdown: Record<string, { name: string; stores: number; users: number }> = {};
    for (const org of (orgsRes.data ?? []) as any[]) {
      orgBreakdown[org.id] = { name: org.name, stores: 0, users: 0 };
    }
    for (const s of stores as any[]) {
      if (s.organisation_id && orgBreakdown[s.organisation_id]) {
        orgBreakdown[s.organisation_id].stores++;
      }
    }
    for (const r of (rolesRes.data ?? []) as any[]) {
      if (r.organisation_id && orgBreakdown[r.organisation_id]) {
        orgBreakdown[r.organisation_id].users++;
      }
    }

    return NextResponse.json({
      // Current data
      totalStores,
      activeStores,
      totalUsers,
      activeRoles,
      auditEntries,
      roleCounts,
      // New enhanced data
      totalOrgs,
      activeToday,
      integrationCount,
      staleStores: staleCount,
      weeklyRevenue,
      orgBreakdown,
      stores: stores.map((s: any) => ({ id: s.id, name: s.name, is_active: s.is_active, store_code: s.store_code })),
    });
  } catch (err) {
    logger.error("Admin overview failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
