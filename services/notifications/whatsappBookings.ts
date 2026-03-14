/**
 * WhatsApp booking notification templates.
 *
 * Three distinct message types:
 *   sendBookingReminder        — day-before reminder (cron / manual)
 *   sendBookingConfirmedNotice — staff manually confirmed the reservation
 *   sendBookingCancellationNotice — reservation was cancelled
 *
 * All functions are fire-and-forget safe: they return a boolean and never throw.
 */

import { sendWhatsAppMessage } from "@/services/whatsapp/client";
import type { Reservation } from "@/types";

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}

function venueName()  { return process.env.VENUE_NAME    ?? "Si Cantina Sociale"; }
function venuePhone() { return process.env.VENUE_PHONE   ?? ""; }
function venueAddr()  { return process.env.VENUE_ADDRESS ?? ""; }

function contactBlock(): string {
  return [venuePhone(), venueAddr()].filter(Boolean).join("\n");
}

function hasValidPhone(phone: string | null | undefined): boolean {
  return !!phone && phone !== "website-no-phone";
}

// ─── 1. Day-before reminder ───────────────────────────────────────────────────

/**
 * Send a reminder the day before the booking.
 * Called by the reminders/run cron route and the manual remind API.
 */
export async function sendBookingReminder(reservation: Reservation): Promise<boolean> {
  if (!hasValidPhone(reservation.phone_number)) return false;

  const firstName = reservation.customer_name.split(" ")[0];
  const eventLine = reservation.event_name
    ? `🎉 *Event:* ${reservation.event_name}`
    : null;
  const contact = contactBlock();

  const lines = [
    `⏰ *Reminder — ${venueName()}*`,
    ``,
    `Hi ${firstName}! Just a reminder that your table is booked for *tomorrow*:`,
    ``,
    `📅 *Date:* ${formatDate(reservation.booking_date)}`,
    `⏰ *Time:* ${formatTime(reservation.booking_time)}`,
    `👥 *Guests:* ${reservation.guest_count}`,
    ...(eventLine ? [eventLine] : []),
    ``,
    `Need to make a change? Reach us:`,
    ...(contact ? [contact] : []),
    ``,
    `See you tomorrow! 🍷`,
  ];

  try {
    await sendWhatsAppMessage(reservation.phone_number, lines.join("\n"));
    console.info(`[WA Bookings] Reminder sent → ${reservation.phone_number}`);
    return true;
  } catch (err) {
    console.error("[WA Bookings] Reminder failed:", err);
    return false;
  }
}

// ─── 2. Booking confirmed by staff ───────────────────────────────────────────

/**
 * Sent when staff manually moves a booking from pending → confirmed.
 */
export async function sendBookingConfirmedNotice(reservation: Reservation): Promise<boolean> {
  if (!hasValidPhone(reservation.phone_number)) return false;

  const firstName = reservation.customer_name.split(" ")[0];
  const eventLine = reservation.event_name
    ? `🎉 *Event:* ${reservation.event_name}`
    : null;
  const contact = contactBlock();

  const lines = [
    `✅ *Booking Confirmed — ${venueName()}*`,
    ``,
    `Hi ${firstName}! Your reservation has been confirmed by our team:`,
    ``,
    `📅 *Date:* ${formatDate(reservation.booking_date)}`,
    `⏰ *Time:* ${formatTime(reservation.booking_time)}`,
    `👥 *Guests:* ${reservation.guest_count}`,
    ...(eventLine ? [eventLine] : []),
    ``,
    `Have questions? We're here:`,
    ...(contact ? [contact] : []),
    ``,
    `We look forward to seeing you! 🍷`,
  ];

  try {
    await sendWhatsAppMessage(reservation.phone_number, lines.join("\n"));
    console.info(`[WA Bookings] Confirmed notice sent → ${reservation.phone_number}`);
    return true;
  } catch (err) {
    console.error("[WA Bookings] Confirmed notice failed:", err);
    return false;
  }
}

// ─── 3. Booking cancelled ─────────────────────────────────────────────────────

/**
 * Sent when staff cancels a booking.
 */
export async function sendBookingCancellationNotice(reservation: Reservation): Promise<boolean> {
  if (!hasValidPhone(reservation.phone_number)) return false;

  const firstName = reservation.customer_name.split(" ")[0];
  const contact = contactBlock();

  const lines = [
    `❌ *Booking Cancelled — ${venueName()}*`,
    ``,
    `Hi ${firstName}, your booking on *${formatDate(reservation.booking_date)}* at *${formatTime(reservation.booking_time)}* has been cancelled.`,
    ``,
    `If this was a mistake or you'd like to rebook, please contact us:`,
    ...(contact ? [contact] : []),
    ``,
    `We hope to see you another time. 🍷`,
  ];

  try {
    await sendWhatsAppMessage(reservation.phone_number, lines.join("\n"));
    console.info(`[WA Bookings] Cancellation notice sent → ${reservation.phone_number}`);
    return true;
  } catch (err) {
    console.error("[WA Bookings] Cancellation notice failed:", err);
    return false;
  }
}
