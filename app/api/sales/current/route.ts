import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { todayISO } from "@/lib/utils";
import { getMicrosStatus } from "@/services/micros/status";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/sales/current");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  const date = req.nextUrl.searchParams.get("date") ?? todayISO();

  try {
    const [microsStatus, forecast, bookingsResult] = await Promise.all([
      getMicrosStatus(),
      generateRevenueForecast(date),
      supabase
        .from("reservations")
        .select("guest_count")
        .eq("site_id", ctx.siteId)
        .eq("booking_date", date)
        .neq("status", "cancelled"),
    ]);

    const bookings = bookingsResult.data ?? [];
    const totalBookings = bookings.length;
    const totalCovers = bookings.reduce((s, r) => s + (Number(r.guest_count) || 0), 0);

    const snapshot = await getCurrentSalesSnapshot(date, microsStatus, forecast, totalBookings, totalCovers);
    return NextResponse.json(snapshot);
  } catch (err) {
    logger.error("Failed to load sales data", { route: "GET /api/sales/current", err });
    return NextResponse.json({ error: "Failed to load sales data" }, { status: 500 });
  }
}
