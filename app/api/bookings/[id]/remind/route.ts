/**
 * POST /api/bookings/[id]/remind
 *
 * Sends a WhatsApp reminder to the guest for a specific booking.
 * Intended for manual "send reminder now" from the dashboard.
 *
 * Auth: Supabase session (dashboard staff only)
 *
 * Returns: { sent: boolean, reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getReservationById } from "@/services/bookings/service";
import { sendBookingReminder } from "@/services/notifications/whatsappBookings";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id" }, { status: 400 });
  }

  // ── Fetch reservation ─────────────────────────────────────────────────────
  let reservation;
  try {
    reservation = await getReservationById(reservationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!reservation) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }

  if (reservation.status === "cancelled") {
    return NextResponse.json(
      { sent: false, reason: "Booking is cancelled — reminder not sent" },
      { status: 200 }
    );
  }

  if (!reservation.phone_number || reservation.phone_number === "website-no-phone") {
    return NextResponse.json(
      { sent: false, reason: "No WhatsApp number on this booking" },
      { status: 200 }
    );
  }

  // ── Send reminder ─────────────────────────────────────────────────────────
  const sent = await sendBookingReminder(reservation);

  return NextResponse.json({ sent }, { status: 200 });
}
