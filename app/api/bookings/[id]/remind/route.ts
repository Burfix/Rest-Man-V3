/**
 * POST /api/bookings/[id]/remind
 *
 * Sends a WhatsApp reminder to the guest for a specific booking.
 * Intended for manual "send reminder now" from the dashboard.
 *
 * Auth: Requires MANAGE_DAILY_OPS permission (gm, supervisor, head_office,
 *       area_manager, super_admin). Read-only roles (viewer, contractor,
 *       auditor) cannot trigger outbound guest communications.
 *
 * Returns: { sent: boolean, reason?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getReservationById } from "@/services/bookings/service";
import { sendBookingReminder } from "@/services/notifications/whatsappBookings";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // ── Auth + RBAC ────────────────────────────────────────────────────────────
  const guard = await apiGuard(PERMISSIONS.MANAGE_DAILY_OPS, "POST /api/bookings/[id]/remind");
  if (guard.error) return guard.error as unknown as NextResponse;

  const reservationId = params.id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!reservationId || !UUID_RE.test(reservationId)) {
    return NextResponse.json({ error: "Invalid reservation ID" }, { status: 400 });
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
