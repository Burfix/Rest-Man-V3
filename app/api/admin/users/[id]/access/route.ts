/**
 * POST /api/admin/users/[id]/access — grant site access to user
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { grantSiteAccessSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_USERS, "POST /api/admin/users/[id]/access");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(grantSiteAccessSchema, body);
    if (!v.success) return v.response;

    const rows = v.data.site_ids.map((siteId) => ({
      user_id: params.id,
      site_id: siteId,
      granted_by: ctx.userId,
    }));

    const { error } = await supabase
      .from("user_site_access")
      .upsert(rows as any, { onConflict: "user_id,site_id" });

    if (error) {
      logger.error("Failed to grant access", { err: error, targetUser: params.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      target_user_id: params.id,
      action: "access.granted",
      metadata: { site_ids: v.data.site_ids },
    } as any);

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Admin access POST failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
