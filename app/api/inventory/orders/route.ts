import { NextRequest, NextResponse } from "next/server";
import { createPurchaseOrder, getPurchaseOrders } from "@/services/inventory/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const orders = await getPurchaseOrders();
    return NextResponse.json(orders);
  } catch (err) {
    console.error("[api/inventory/orders] Error:", err);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { supplier_name, items } = body;

    if (!supplier_name || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "supplier_name and items[] required" }, { status: 400 });
    }

    const order = await createPurchaseOrder(supplier_name, items);
    if (!order) {
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("[api/inventory/orders] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
