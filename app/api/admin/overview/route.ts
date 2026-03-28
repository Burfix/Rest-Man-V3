/**
 * GET /api/admin/overview — admin dashboard summary stats
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "GET /api/admin/overview");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const orgId = ctx.orgId;
    if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

    const [storesRes, usersRes, rolesRes, auditRes] = await Promise.all([
      supabase
        .from("sites")
        .select("id, name, is_active, store_code", { count: "exact" })
        .eq("organisation_id", orgId),
      supabase
        .from("profiles")
        .select("id", { count: "exact" }),
      supabase
        .from("user_roles")
        .select("role, is_active")
        .eq("organisation_id", orgId)
        .eq("is_active", true),
      supabase
        .from("access_audit_log")
        .select("id", { count: "exact" }),
    ]);

    const totalStores = storesRes.count ?? 0;
    const activeStores = (storesRes.data ?? []).filter((s: any) => s.is_active).length;
    const totalUsers = usersRes.count ?? 0;
    const activeRoles = rolesRes.data?.length ?? 0;
    const auditEntries = auditRes.count ?? 0;

    // Role distribution
    const roleCounts: Record<string, number> = {};
    for (const r of (rolesRes.data ?? []) as any[]) {
      roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;
    }

    return NextResponse.json({
      totalStores,
      activeStores,
      totalUsers,
      activeRoles,
      auditEntries,
      roleCounts,
    });
  } catch (err) {
    logger.error("Admin overview failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
