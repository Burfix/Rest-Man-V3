/**
 * Booking confirmation notifications.
 *
 * Sends a WhatsApp message and/or email whenever a reservation is created,
 * regardless of which channel triggered the booking (WhatsApp chat or website form).
 *
 * Both functions are fire-and-forget safe: they never throw — they log errors
 * and return a boolean so callers can proceed without crashing.
 */

import { Resend } from "resend";
import { sendWhatsAppMessage } from "@/services/whatsapp/client";
import type { Reservation } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-ZA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Africa/Johannesburg",
    });
  } catch {
    return iso;
  }
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${pad(hour12)}:${pad(m ?? 0)} ${suffix}`;
}

// ─── WhatsApp confirmation ────────────────────────────────────────────────────

/**
 * Send a booking confirmation WhatsApp message to the guest.
 *
 * Returns true if sent successfully, false on any error.
 */
export async function sendBookingConfirmationWhatsApp(
  reservation: Reservation
): Promise<boolean> {
  const { phone_number, customer_name, booking_date, booking_time, guest_count, event_name, special_notes } = reservation;

  if (!phone_number || phone_number === "website-no-phone") return false;

  const venueName = process.env.VENUE_NAME ?? "Si Cantina Sociale";
  const venuePhone = process.env.VENUE_PHONE ?? "";
  const venueAddress = process.env.VENUE_ADDRESS ?? "";

  const eventLine = event_name ? `🎉 *Event:* ${event_name}\n` : "";
  const notesLine = special_notes ? `📝 *Notes:* ${special_notes}\n` : "";
  const phoneLine = venuePhone ? `📞 ${venuePhone}` : "";
  const addressLine = venueAddress ? `📍 ${venueAddress}` : "";
  const contactBlock = [phoneLine, addressLine].filter(Boolean).join("\n");

  const message = [
    `✅ *Booking Confirmed — ${venueName}*`,
    ``,
    `Hi ${customer_name.split(" ")[0]}! Your table is reserved. Here are your booking details:`,
    ``,
    `📅 *Date:* ${formatDate(booking_date)}`,
    `⏰ *Time:* ${formatTime(booking_time)}`,
    `👥 *Guests:* ${guest_count}`,
    eventLine.trimEnd(),
    notesLine.trimEnd(),
    ``,
    `If you need to change or cancel your booking, please contact us:`,
    contactBlock,
    ``,
    `We look forward to seeing you! 🍷`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    await sendWhatsAppMessage(phone_number, message);
    console.info(`[Notifications] WA confirmation sent → ${phone_number}`);
    return true;
  } catch (err) {
    console.error("[Notifications] WA confirmation failed:", err);
    return false;
  }
}

// ─── Email confirmation ───────────────────────────────────────────────────────

/**
 * Send a booking confirmation email.
 *
 * - If `customerEmail` is provided → sends a guest-facing confirmation.
 * - Always sends an internal notification to `RESTAURANT_EMAIL` (staff copy).
 *
 * Returns true if at least the staff email was sent, false on total failure.
 */
export async function sendBookingConfirmationEmail(
  reservation: Reservation,
  customerEmail: string | null
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const restaurantEmail = process.env.RESTAURANT_EMAIL;

  if (!apiKey) {
    console.warn("[Notifications] RESEND_API_KEY not configured — skipping email.");
    return false;
  }

  const resend = new Resend(apiKey);
  const venueName = process.env.VENUE_NAME ?? "Si Cantina Sociale";
  const fromAddress = process.env.SMTP_FROM ?? `${venueName} <onboarding@resend.dev>`;

  const { customer_name, booking_date, booking_time, guest_count, event_name, special_notes, phone_number } = reservation;

  const dateStr = formatDate(booking_date);
  const timeStr = formatTime(booking_time);

  // ── Guest email ────────────────────────────────────────────────────────────
  let guestSent = false;
  if (customerEmail) {
    const guestHtml = buildGuestEmail({
      venueName,
      customer_name,
      dateStr,
      timeStr,
      guest_count,
      event_name,
      special_notes,
    });

    try {
      await resend.emails.send({
        from: fromAddress,
        to: customerEmail,
        subject: `Your booking at ${venueName} — ${dateStr}`,
        html: guestHtml,
      });
      console.info(`[Notifications] Guest email sent → ${customerEmail}`);
      guestSent = true;
    } catch (err) {
      console.error("[Notifications] Guest email failed:", err);
    }
  }

  // ── Staff notification ─────────────────────────────────────────────────────
  let staffSent = false;
  if (restaurantEmail) {
    const staffHtml = buildStaffEmail({
      venueName,
      customer_name,
      phone_number,
      customerEmail,
      dateStr,
      timeStr,
      guest_count,
      event_name,
      special_notes,
      reservation_id: reservation.id,
      source: reservation.source_channel,
    });

    try {
      await resend.emails.send({
        from: fromAddress,
        to: restaurantEmail,
        subject: `New Booking: ${customer_name} — ${dateStr} @ ${timeStr}`,
        html: staffHtml,
      });
      console.info(`[Notifications] Staff email sent → ${restaurantEmail}`);
      staffSent = true;
    } catch (err) {
      console.error("[Notifications] Staff email failed:", err);
    }
  }

  return guestSent || staffSent;
}

// ─── Email templates ──────────────────────────────────────────────────────────

interface GuestEmailData {
  venueName: string;
  customer_name: string;
  dateStr: string;
  timeStr: string;
  guest_count: number;
  event_name: string | null;
  special_notes: string | null;
}

function buildGuestEmail(d: GuestEmailData): string {
  const eventRow = d.event_name
    ? `<tr><td style="padding:8px 0;color:#666;font-size:14px;">Event</td><td style="padding:8px 0;font-weight:600;">${esc(d.event_name)}</td></tr>`
    : "";
  const notesRow = d.special_notes
    ? `<tr><td style="padding:8px 0;color:#666;font-size:14px;vertical-align:top">Notes</td><td style="padding:8px 0;font-size:14px;">${esc(d.special_notes)}</td></tr>`
    : "";
  const venuePhone = process.env.VENUE_PHONE ?? "";
  const venueAddress = process.env.VENUE_ADDRESS ?? "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">

        <!-- Header -->
        <tr><td style="background:#1a1a1a;padding:32px 40px;text-align:center;">
          <h1 style="margin:0;color:#c8a96e;font-family:Georgia,serif;font-size:26px;letter-spacing:2px;">${esc(d.venueName)}</h1>
          <p style="margin:8px 0 0;color:#999;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Booking Confirmation</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:40px;">
          <p style="margin:0 0 24px;font-size:16px;color:#333;">Dear ${esc(d.customer_name.split(" ")[0])},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">Thank you for your reservation. We're looking forward to welcoming you!</p>

          <!-- Details box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #eee;border-radius:6px;padding:0;">
            <tr><td style="padding:24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;color:#666;font-size:14px;width:120px;">Date</td><td style="padding:8px 0;font-weight:600;font-size:15px;">${esc(d.dateStr)}</td></tr>
                <tr><td style="padding:8px 0;color:#666;font-size:14px;">Time</td><td style="padding:8px 0;font-weight:600;font-size:15px;">${esc(d.timeStr)}</td></tr>
                <tr><td style="padding:8px 0;color:#666;font-size:14px;">Guests</td><td style="padding:8px 0;font-weight:600;">${d.guest_count} ${d.guest_count === 1 ? "guest" : "guests"}</td></tr>
                ${eventRow}
                ${notesRow}
              </table>
            </td></tr>
          </table>

          <p style="margin:24px 0 0;font-size:14px;color:#777;line-height:1.6;">Need to change or cancel? Contact us:</p>
          ${venuePhone ? `<p style="margin:4px 0;font-size:14px;color:#333;">📞 ${esc(venuePhone)}</p>` : ""}
          ${venueAddress ? `<p style="margin:4px 0;font-size:14px;color:#333;">📍 ${esc(venueAddress)}</p>` : ""}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#aaa;">This is an automated confirmation from ${esc(d.venueName)}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

interface StaffEmailData {
  venueName: string;
  customer_name: string;
  phone_number: string;
  customerEmail: string | null;
  dateStr: string;
  timeStr: string;
  guest_count: number;
  event_name: string | null;
  special_notes: string | null;
  reservation_id: string;
  source: string;
}

function buildStaffEmail(d: StaffEmailData): string {
  const eventRow = d.event_name
    ? `<tr><td style="padding:6px 0;color:#666;font-size:13px;width:120px;">Event</td><td style="padding:6px 0;font-weight:600;">${esc(d.event_name)}</td></tr>`
    : "";
  const notesRow = d.special_notes
    ? `<tr><td style="padding:6px 0;color:#666;font-size:13px;vertical-align:top">Notes</td><td style="padding:6px 0;font-size:13px;">${esc(d.special_notes)}</td></tr>`
    : "";
  const emailRow = d.customerEmail
    ? `<tr><td style="padding:6px 0;color:#666;font-size:13px;">Email</td><td style="padding:6px 0;">${esc(d.customerEmail)}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 20px;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#fff;border-radius:8px;overflow:hidden;border-top:4px solid #c8a96e;">
        <tr><td style="padding:24px 32px;background:#1a1a1a;">
          <h2 style="margin:0;color:#c8a96e;font-size:18px;">📋 New Booking — ${esc(d.venueName)}</h2>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #eee;border-radius:4px;">
            <tr><td style="padding:20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:6px 0;color:#666;font-size:13px;width:120px;">Guest</td><td style="padding:6px 0;font-weight:700;font-size:15px;">${esc(d.customer_name)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Phone</td><td style="padding:6px 0;"><a href="tel:${esc(d.phone_number)}" style="color:#c8a96e;">${esc(d.phone_number)}</a></td></tr>
                ${emailRow}
                <tr><td colspan="2" style="padding:10px 0 4px;border-top:1px solid #eee;"></td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Date</td><td style="padding:6px 0;font-weight:600;">${esc(d.dateStr)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Time</td><td style="padding:6px 0;font-weight:600;">${esc(d.timeStr)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Guests</td><td style="padding:6px 0;font-weight:600;">${d.guest_count}</td></tr>
                ${eventRow}
                ${notesRow}
                <tr><td colspan="2" style="padding:10px 0 4px;border-top:1px solid #eee;"></td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Source</td><td style="padding:6px 0;font-size:12px;color:#888;">${esc(d.source)}</td></tr>
                <tr><td style="padding:6px 0;color:#666;font-size:13px;">Res. ID</td><td style="padding:6px 0;font-size:11px;color:#aaa;font-family:monospace;">${esc(d.reservation_id)}</td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center;">
          Sent automatically by the ${esc(d.venueName)} concierge system.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Simple HTML escaper to prevent injection in email templates */
function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
