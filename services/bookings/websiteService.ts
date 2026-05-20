/**
 * Fetches reservations directly from the restaurant website API.
 * Source: https://www.sicantinasociale.co.za/api/reservations
 *
 * This replaces the legacy WordPress-plugin push mechanism.
 * The website API is public and returns all reservations as JSON.
 */

import { Reservation, ReservationStatus } from "@/types";
import { todayISO } from "@/lib/utils";
import { SERVICE_CHARGE_THRESHOLD } from "@/lib/constants";

const WEBSITE_RESERVATIONS_URL =
  "https://www.sicantinasociale.co.za/api/reservations";

// ── Raw shape returned by the website API ─────────────────────────────────────

interface WebsiteReservation {
  id: number;
  reservationDate: string;   // "YYYY-MM-DD"
  reservationTime: string;   // "HH:mm:ss"
  partySize: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  specialRequests: string | null;
  status: string;            // "pending" | "confirmed" | "completed" | "cancelled"
  createdAt: string;
  updatedAt: string;
}

// ── Schema mapping ────────────────────────────────────────────────────────────

function toReservationStatus(raw: string): ReservationStatus {
  if (raw === "confirmed" || raw === "completed") return "confirmed";
  if (raw === "cancelled") return "cancelled";
  return "pending";
}

function mapWebsiteReservation(r: WebsiteReservation): Reservation {
  const time = r.reservationTime.length >= 5
    ? r.reservationTime.slice(0, 5)   // "13:00:00" → "13:00"
    : r.reservationTime;

  return {
    id: String(r.id),
    customer_name: r.customerName,
    phone_number: r.customerPhone,
    booking_date: r.reservationDate,
    booking_time: time,
    guest_count: r.partySize,
    event_name: null,
    special_notes: r.specialRequests,
    status: toReservationStatus(r.status),
    service_charge_applies: r.partySize > SERVICE_CHARGE_THRESHOLD,
    escalation_required: false,
    source_channel: "website",
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

export async function getAllWebsiteReservations(): Promise<Reservation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(WEBSITE_RESERVATIONS_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `[WebsiteBookings] Failed to fetch reservations: HTTP ${res.status}`
      );
    }
    const raw: WebsiteReservation[] = await res.json();
    return raw.map(mapWebsiteReservation);
  } finally {
    clearTimeout(timer);
  }
}

/** Upcoming reservations: today onwards, excluding cancelled. */
export async function getUpcomingWebsiteReservations(): Promise<Reservation[]> {
  const all = await getAllWebsiteReservations();
  const today = todayISO();
  return all
    .filter((r) => r.booking_date >= today && r.status !== "cancelled")
    .sort(
      (a, b) =>
        a.booking_date.localeCompare(b.booking_date) ||
        a.booking_time.localeCompare(b.booking_time)
    );
}

/** Today's reservations only, excluding cancelled. */
export async function getTodayWebsiteReservations(): Promise<Reservation[]> {
  const all = await getAllWebsiteReservations();
  const today = todayISO();
  return all
    .filter((r) => r.booking_date === today && r.status !== "cancelled")
    .sort((a, b) => a.booking_time.localeCompare(b.booking_time));
}
