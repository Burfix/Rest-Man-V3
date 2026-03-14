/**
 * PATCH /api/bookings/[id]/status
 *
 * Updates a reservation's status and optionally sends a WhatsApp notification.
 *
 * Body: { status: "confirmed" | "cancelled", notify?: boolean }
 * Auth: Supabase session (dashboard staff only)
 *
 * Returns: { reservation, waSent }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import {
  getReservationById,
  updateReservationStatus,
} from "@/services/bookings/service";
import {
  sendBookingConfirmedNotice,
  sendBookingCancellationNotice,
} from "@/services/notifications/whatsappBookings";
import type { ReservationStatus } from "@/types";

const ALLOWED_STATUSES: ReservationStatus[] = ["confirmed", "cancelled", "pending"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { status?: unknown; notify?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { status, notify = true } = body;

  if (!status || !ALLOWED_STATUSES.includes(status as ReservationStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const reservationId = params.id;
  if (!reservationId) {
    return NextResponse.json({ error: "Missing reservation id" }, { status: 400 });
  }

  // ── Fetch current reservation ─────────────────────────────────────────────
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

  // ── Update status ─────────────────────────────────────────────────────────
  try {
    await updateReservationStatus(reservationId, status as ReservationStatus);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // ── Send WhatsApp notification (non-blocking) ──────────────────────────────
  let waSent = false;
  if (notify) {
    const updatedReservation = { ...reservation, status: status as ReservationStatus };
    if (status === "confirmed") {
      waSent = await sendBookingConfirmedNotice(updatedReservation);
    } else if (status === "cancelled") {
      waSent = await sendBookingCancellationNotice(updatedReservation);
    }
  }

  return NextResponse.json(
    { reservation: { ...reservation, status }, waSent },
    { status: 200 }
  );
}
