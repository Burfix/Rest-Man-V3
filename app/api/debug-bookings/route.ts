/**
 * Diagnostic endpoint — remove after debugging.
 * GET /api/debug-bookings
 *
 * Returns the raw website API response + filter results
 * so we can confirm what Vercel is actually fetching.
 */

import { NextResponse } from "next/server";
import { todayISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

const WEBSITE_RESERVATIONS_URL =
  "https://www.sicantinasociale.co.za/api/reservations";

export async function GET() {
  const today = todayISO();
  try {
    const res = await fetch(WEBSITE_RESERVATIONS_URL, { cache: "no-store" });
    const status = res.status;
    const contentType = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${status}`, contentType, today });
    }

    const raw = await res.json();
    const total = Array.isArray(raw) ? raw.length : "NOT_AN_ARRAY";
    const upcoming = Array.isArray(raw)
      ? raw.filter(
          (r: { reservationDate: string; status: string }) =>
            r.reservationDate >= today && r.status !== "cancelled"
        )
      : [];

    return NextResponse.json({
      today,
      httpStatus: status,
      total,
      upcomingCount: upcoming.length,
      upcoming: upcoming.slice(0, 3).map((r: { reservationDate: string; reservationTime: string; partySize: number; customerName: string; status: string }) => ({
        date: r.reservationDate,
        time: r.reservationTime,
        name: r.customerName,
        party: r.partySize,
        status: r.status,
      })),
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      today,
    });
  }
}
