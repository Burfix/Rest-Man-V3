import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { patchBookingStatusSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getReservationById, updateReservationStatus } from "@/services/bookings/service";
import { sendBookingConfirmedNotice, sendBookingCancellationNotice } from "@/services/notifications/whatsappBookings";
import type { ReservationStatus } from "@/types";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "PATCH /api/bookings/[id]/status");
  if (guard.error) return guard.error;

  try {
    const body = await request.json();
    const v = validateBody(patchBookingStatusSchema, body);
    if (!v.success) return v.response;
    const { status, notify = true } = v.data;

    const reservation = await getReservationById(params.id);
    if (!reservation) {
      return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    }

    await updateReservationStatus(params.id, status as ReservationStatus);

    let waSent = false;
    if (notify) {
      const updated = { ...reservation, status: status as ReservationStatus };
      if (status === "confirmed") waSent = await sendBookingConfirmedNotice(updated);
      else if (status === "cancelled") waSent = await sendBookingCancellationNotice(updated);
    }

    return NextResponse.json({ reservation: { ...reservation, status }, waSent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to update booking status", { route: "PATCH /api/bookings/[id]/status", err, msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
