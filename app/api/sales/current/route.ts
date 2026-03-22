/**
 * GET /api/sales/current?date=YYYY-MM-DD — Returns the unified sales snapshot
 *
 * This is the canonical API for the current sales state, resolving
 * from MICROS → manual upload → forecast in priority order.
 */

import { NextRequest, NextResponse } from "next/server";
import { todayISO } from "@/lib/utils";
import { getMicrosStatus } from "@/services/micros/status";
import { generateRevenueForecast } from "@/services/revenue/forecast";
import { getCurrentSalesSnapshot } from "@/lib/sales/service";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayISO();

  try {
    const [microsStatus, forecast, bookingsResult] = await Promise.all([
      getMicrosStatus(),
      generateRevenueForecast(date),
      createServerClient()
        .from("reservations")
        .select("guest_count")
        .eq("booking_date", date)
        .neq("status", "cancelled"),
    ]);

    const bookings = bookingsResult.data ?? [];
    const totalBookings = bookings.length;
    const totalCovers = bookings.reduce(
      (s, r) => s + (Number(r.guest_count) || 0),
      0,
    );

    const snapshot = await getCurrentSalesSnapshot(
      date,
      microsStatus,
      forecast,
      totalBookings,
      totalCovers,
    );

    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[sales/current] Error:", err);
    return NextResponse.json(
      { error: "Failed to load sales data" },
      { status: 500 },
    );
  }
}
