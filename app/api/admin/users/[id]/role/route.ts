/**
 * PATCH /api/admin/users/[id]/role — update user role and site access
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
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

    // For super_admin, resolve the target user's org so we can deactivate the right rows
    let targetOrgId = ctx.orgId;
    if (isSuperAdmin(ctx)) {
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("organisation_id")
        .eq("user_id", params.id)
        .eq("is_active", true)
        .limit(1)
        .single();
      if (existingRole?.organisation_id) targetOrgId = existingRole.organisation_id;
    }

    // Deactivate old roles
    const deactivateQ = supabase
      .from("user_roles")
      .update({ is_active: false, revoked_at: new Date().toISOString() } as any)
      .eq("user_id", params.id)
      .eq("is_active", true);
    if (targetOrgId) deactivateQ.eq("organisation_id", targetOrgId);

    await deactivateQ;

    // Create new role
    const { error } = await supabase.from("user_roles").insert({
      user_id: params.id,
      organisation_id: targetOrgId,
      role: d.role,
      site_id: d.site_id ?? null,
      region_id: d.region_id ?? null,
      granted_by: ctx.userId,
    } as any);

    if (error) {
      logger.error("Failed to update role", { err: error, targetUser: params.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update site access if site_ids provided
    if (d.site_ids !== undefined) {
      // Remove existing site access
      await supabase
        .from("user_site_access")
        .delete()
        .eq("user_id", params.id);

      // Add new site access
      if (d.site_ids.length > 0) {
        const accessRows = d.site_ids.map((siteId: string) => ({
          user_id: params.id,
          site_id: siteId,
          granted_by: ctx.userId,
        }));
        await supabase.from("user_site_access").insert(accessRows as any);
      }
    }

    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: params.id,
      action: "role.changed",
      metadata: { new_role: d.role, site_id: d.site_id, site_ids: d.site_ids, region_id: d.region_id },
    } as any);

    return NextResponse.json({ success: true, role: d.role, site_ids: d.site_ids });
  } catch (err) {
    logger.error("Admin role PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
