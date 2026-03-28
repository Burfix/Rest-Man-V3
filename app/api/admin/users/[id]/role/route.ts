/**
 * PATCH /api/admin/users/[id]/role — update user role
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { patchUserRoleSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_ROLES, "PATCH /api/admin/users/[id]/role");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchUserRoleSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    // Deactivate old roles
    await supabase
      .from("user_roles")
      .update({ is_active: false, revoked_at: new Date().toISOString() } as any)
      .eq("user_id", params.id)
      .eq("organisation_id", ctx.orgId!)
      .eq("is_active", true);

    // Create new role
    const { error } = await supabase.from("user_roles").insert({
      user_id: params.id,
      organisation_id: ctx.orgId,
      role: d.role,
      site_id: d.site_id ?? null,
      region_id: d.region_id ?? null,
      granted_by: ctx.userId,
    } as any);

    if (error) {
      logger.error("Failed to update role", { err: error, targetUser: params.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: params.id,
      action: "role.changed",
      metadata: { new_role: d.role, site_id: d.site_id, region_id: d.region_id },
    } as any);

    return NextResponse.json({ success: true, role: d.role });
  } catch (err) {
    logger.error("Admin role PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
