/**
 * PATCH /api/admin/stores/[id] — update a store
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { patchStoreSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "PATCH /api/admin/stores/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchStoreSchema, body);
    if (!v.success) return v.response;

    const { data, error } = await supabase
      .from("sites")
      .update({ ...v.data, updated_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("organisation_id", ctx.orgId!)
      .select("*")
      .single();

    if (error) {
      logger.error("Failed to update store", { err: error, storeId: params.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      action: "store.updated",
      metadata: { store_id: params.id, changes: v.data },
    } as any);

    return NextResponse.json({ store: data });
  } catch (err) {
    logger.error("Admin stores PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
