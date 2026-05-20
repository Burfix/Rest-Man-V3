/**
 * PATCH /api/admin/stores/[id] — update a store
 * DELETE /api/admin/stores/[id] — permanently delete a store
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { isSuperAdmin } from "@/lib/admin/helpers";
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

    // Build query — super_admin can update any store; org-scoped users only their own org
    let query = supabase
      .from("sites")
      .update({ ...v.data, updated_at: new Date().toISOString() })
      .eq("id", params.id);

    if (!isSuperAdmin(ctx) && ctx.orgId) {
      query = query.eq("organisation_id", ctx.orgId);
    }

    const { data, error } = await query.select();

    if (error) {
      logger.error("Failed to update store", { err: error, storeId: params.id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      action: "store.updated",
      metadata: { store_id: params.id, changes: v.data },
    } as any);

    return NextResponse.json({ store: data[0] });
  } catch (err) {
    logger.error("Admin stores PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── DELETE — permanently remove a store ───────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.MANAGE_STORE_SETTINGS, "DELETE /api/admin/stores/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  // Only super_admin can permanently delete stores
  if (!isSuperAdmin(ctx)) {
    return NextResponse.json({ error: "Only super admins can delete stores" }, { status: 403 });
  }

  const storeId = params.id;

  try {
    // Verify store exists
    const { data: store } = await supabase
      .from("sites")
      .select("id, name")
      .eq("id", storeId)
      .maybeSingle();

    if (!store) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    // Delete from tables with RESTRICT FK (no cascade) before deleting the site
    // compliance_documents: REFERENCES sites(id) with no cascade action
    await supabase.from("compliance_documents").delete().eq("site_id", storeId);
    // micros_connections: REFERENCES sites(id) with no cascade action
    await supabase.from("micros_connections").delete().eq("site_id", storeId);

    // Delete the site — CASCADE/SET NULL handle the remaining FKs
    const { error } = await supabase
      .from("sites")
      .delete()
      .eq("id", storeId);

    if (error) {
      logger.error("Failed to delete store", { err: error, storeId });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log
    await supabase.from("access_audit_log").insert({
      actor_user_id: ctx.userId,
      action: "store.deleted",
      metadata: { store_id: storeId, store_name: (store as any).name },
    } as any);

    logger.info("Store deleted", { storeId, storeName: (store as any).name, actor: ctx.email });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Admin stores DELETE failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
