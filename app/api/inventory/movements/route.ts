import { NextRequest, NextResponse } from "next/server";
import { createStockMovement } from "@/services/inventory/service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { inventory_item_id, type, quantity, note } = body;

    if (!inventory_item_id || !type || quantity == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const movement = await createStockMovement(inventory_item_id, type, quantity, note);
    if (!movement) {
      return NextResponse.json({ error: "Failed to create movement" }, { status: 500 });
    }
    return NextResponse.json(movement, { status: 201 });
  } catch (err) {
    console.error("[api/inventory/movements] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
