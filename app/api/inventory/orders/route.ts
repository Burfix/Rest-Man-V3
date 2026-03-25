import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createPurchaseOrderSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/inventory/orders");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { data, error } = await (supabase as any)
      .from("purchase_orders")
      .select("*, purchase_order_items(*)")
      .eq("site_id", ctx.siteId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    logger.error("Failed to fetch purchase orders", { route: "GET /api/inventory/orders", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/inventory/orders");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createPurchaseOrderSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data: order, error } = await (supabase as any)
      .from("purchase_orders")
      .insert({
        site_id: ctx.siteId,
        supplier_name: d.supplier_name,
        status: "draft",
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) throw error;

    if (d.items && d.items.length > 0) {
      const items = d.items.map((item: any) => ({
        order_id: order.id,
        inventory_item_id: item.inventory_item_id,
        quantity: item.quantity,
        unit_cost: item.unit_price ?? 0,
      }));
      const { error: itemsErr } = await (supabase as any).from("purchase_order_items").insert(items);
      if (itemsErr) throw itemsErr;
    }

    logger.info("Purchase order created", { route: "POST /api/inventory/orders", orderId: order.id, siteId: ctx.siteId });
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    logger.error("Failed to create purchase order", { route: "POST /api/inventory/orders", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
