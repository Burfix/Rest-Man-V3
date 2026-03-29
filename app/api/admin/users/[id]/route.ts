/**
 * DELETE /api/admin/users/[id] — remove a user (revoke invite or delete user)
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { requireSuperAdmin } from "@/lib/admin/helpers";
import { logger } from "@/lib/logger";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "DELETE /api/admin/users/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    requireSuperAdmin(ctx);
  } catch {
    return NextResponse.json({ error: "Super admin required" }, { status: 403 });
  }

  const targetId = params.id;

  // Prevent self-deletion
  if (targetId === ctx.userId) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  try {
    // 1. Remove site access
    await supabase
      .from("user_site_access")
      .delete()
      .eq("user_id", targetId);

    // 2. Deactivate all roles
    await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", targetId);

    // 3. Delete profile
    await supabase
      .from("profiles")
      .delete()
      .eq("id", targetId);

    // 4. Delete auth user (removes login ability + any pending invite)
    const { error: authErr } = await supabase.auth.admin.deleteUser(targetId);
    if (authErr) {
      // Non-fatal — auth user may not exist for old manual invites
      logger.warn("Could not delete auth user (may not exist)", { targetId, err: authErr });
    }

    // 5. Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: targetId,
      action: "user.deleted",
      metadata: {},
    } as any);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Admin user DELETE failed", { err, targetId });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
