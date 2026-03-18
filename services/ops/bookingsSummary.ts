/**
 * Today's bookings summary — used by the Operations Command Dashboard.
 * Data source: sicantinasociale.co.za website API (live).
 */

import { Reservation, TodayBookingsSummary } from "@/types";
import { SERVICE_CHARGE_THRESHOLD } from "@/lib/constants";
import { getTodayWebsiteReservations } from "@/services/bookings/websiteService";

export async function getTodayBookingsSummary(): Promise<TodayBookingsSummary> {
  const bookings = await getTodayWebsiteReservations();

  return {
    total: bookings.length,
    totalCovers: bookings.reduce((s, r) => s + r.guest_count, 0),
    largeBookings: bookings.filter((r) => r.guest_count > SERVICE_CHARGE_THRESHOLD).length,
    eventLinked: bookings.filter((r) => !!r.event_name).length,
    escalationsToday: bookings.filter((r) => r.escalation_required).length,
    bookings,
  };
}
