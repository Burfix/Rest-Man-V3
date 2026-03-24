import { NextResponse } from "next/server";
import { getInventoryItems, getFoodCostSummary } from "@/services/inventory/service";
import { isMicrosEnabled } from "@/lib/micros/config";
import { syncInventoryFromMicros } from "@/services/micros/inventory/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // If MICROS is enabled, sync live stock counts before returning data
    if (isMicrosEnabled()) {
      try {
        await syncInventoryFromMicros();
      } catch (err) {
        // Log but don't block — serve stale data if sync fails
        console.error("[api/inventory] MICROS sync failed, serving cached:", err);
      }
    }

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
