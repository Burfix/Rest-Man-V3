import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { getInventoryItems, getFoodCostSummary } from "@/services/inventory/service";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/inventory");
  if (guard.error) return guard.error;

  try {
    const [items, foodCost] = await Promise.all([
      getInventoryItems(),
      getFoodCostSummary(),
    ]);
    return NextResponse.json({ items, foodCost });
  } catch (err) {
    logger.error("Failed to fetch inventory", { route: "GET /api/inventory", err });
    return NextResponse.json({ error: "Failed to fetch inventory" }, { status: 500 });
  }
}
