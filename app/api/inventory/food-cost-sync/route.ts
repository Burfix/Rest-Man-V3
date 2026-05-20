import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { syncFoodCostFromBI } from "@/services/micros/foodCostSync";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/inventory/food-cost-sync
 *
 * Triggers a food cost sync from MICROS BI API (getMenuItemDimensions + getMenuItemDailyTotals).
 * Body: { businessDate?: "YYYY-MM-DD" }
 */
export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "POST /api/inventory/food-cost-sync");
  if (guard.error) return guard.error;
  const { ctx } = guard;

  try {
    const body = await req.json().catch(() => ({}));
    const businessDate = body.businessDate ?? todayISO();

    // Get locRef from micros_connections
    const { data: connection } = await (guard as any).supabase
      ?.from("micros_connections")
      ?.select("loc_ref")
      ?.eq("site_id", ctx.siteId)
      ?.maybeSingle();

    const locRef = connection?.loc_ref || process.env.MICROS_LOCATION_REF || process.env.MICROS_LOC_REF || "2000002";

    const result = await syncFoodCostFromBI({
      siteId: ctx.siteId,
      locRef,
      businessDate,
      syncDimensions: true,
      actorUserId: ctx.userId,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    logger.error("Food cost sync API error", { route: "POST /api/inventory/food-cost-sync", err });
    return NextResponse.json({ error: "Food cost sync failed" }, { status: 500 });
  }
}
