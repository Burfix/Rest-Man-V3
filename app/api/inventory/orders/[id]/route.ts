import { NextRequest, NextResponse } from "next/server";
import { updatePurchaseOrderStatus } from "@/services/inventory/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const body = await req.json();
    const { status } = body;

    if (!["ordered", "received", "cancelled"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const ok = await updatePurchaseOrderStatus(params.id, status);
    if (!ok) {
      return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/inventory/orders/[id]] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
