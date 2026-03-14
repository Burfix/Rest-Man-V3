/**
 * Today's bookings summary — used by the Operations Command Dashboard.
 */

import { createServerClient } from "@/lib/supabase/server";
import { Reservation, TodayBookingsSummary } from "@/types";
import { todayISO } from "@/lib/utils";
import { SERVICE_CHARGE_THRESHOLD } from "@/lib/constants";

export async function getTodayBookingsSummary(): Promise<TodayBookingsSummary> {
  const supabase = createServerClient();
  const today = todayISO();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("booking_date", today)
    .neq("status", "cancelled")
    .order("booking_time", { ascending: true });

  if (error) {
    throw new Error(`[OpsSvc/Bookings] ${error.message}`);
  }

  const bookings = (data ?? []) as Reservation[];

  return {
    total: bookings.length,
    totalCovers: bookings.reduce((s, r) => s + r.guest_count, 0),
    largeBookings: bookings.filter((r) => r.guest_count > SERVICE_CHARGE_THRESHOLD).length,
    eventLinked: bookings.filter((r) => !!r.event_name).length,
    escalationsToday: bookings.filter((r) => r.escalation_required).length,
    bookings,
  };
}
