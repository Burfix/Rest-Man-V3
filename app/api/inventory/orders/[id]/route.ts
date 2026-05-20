import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { patchPurchaseOrderSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "PATCH /api/inventory/orders/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchPurchaseOrderSchema, body);
    if (!v.success) return v.response;

    const { data, error } = await (supabase as any)
      .from("purchase_orders")
      .update(v.data)
      .eq("id", params.id)
      .eq("site_id", ctx.siteId)
      .select()
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    logger.info("Purchase order updated", { route: "PATCH /api/inventory/orders/[id]", orderId: params.id, siteId: ctx.siteId });
    return NextResponse.json(data);
  } catch (err) {
    logger.error("Failed to update purchase order", { route: "PATCH /api/inventory/orders/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(PERMISSIONS.ESCALATE_ACTION, "DELETE /api/inventory/orders/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { error } = await (supabase as any)
      .from("purchase_orders")
      .delete()
      .eq("id", params.id)
      .eq("site_id", ctx.siteId);

    if (error) throw error;
    logger.info("Purchase order deleted", { route: "DELETE /api/inventory/orders/[id]", orderId: params.id, siteId: ctx.siteId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Failed to delete purchase order", { route: "DELETE /api/inventory/orders/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
