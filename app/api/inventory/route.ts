import { NextResponse } from "next/server";
import { getInventoryItems, getFoodCostSummary } from "@/services/inventory/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [items, foodCost] = await Promise.all([
      getInventoryItems(),
      getFoodCostSummary(),
    ]);
    return NextResponse.json({ items, foodCost });
  } catch (err) {
    console.error("[api/inventory] Error:", err);
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 });
  }
}
