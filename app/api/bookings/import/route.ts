/**
 * POST /api/bookings/import
 *
 * Accepts a booking from an external source (e.g. WordPress contact form)
 * and creates a reservation in Supabase.
 *
 * Auth: Bearer token in Authorization header must match IMPORT_API_KEY env var.
 *
 * Body (JSON):
 *   customer_name  string  required
 *   phone_number   string  required
 *   booking_date   string  required  YYYY-MM-DD
 *   booking_time   string  required  e.g. "19:00"
 *   guest_count    number  required
 *   special_notes  string  optional
 *   event_name     string  optional
 *   source         string  optional  defaults to "website"
 */

import { NextResponse } from "next/server";
import { createReservation } from "@/services/bookings/service";
import {
  sendBookingConfirmationWhatsApp,
  sendBookingConfirmationEmail,
} from "@/services/notifications/confirmations";
import type { BookingDraft } from "@/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const apiKey = process.env.IMPORT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Import API is not configured on this server." },
      { status: 503 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token !== apiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    customer_name,
    phone_number,
    booking_date,
    booking_time,
    guest_count,
    special_notes,
    event_name,
    customer_email,
  } = body as Record<string, string | number | undefined>;

  // ── Required field checks ─────────────────────────────────────────────────
  const missing: string[] = [];
  if (!customer_name) missing.push("customer_name");
  if (!phone_number)  missing.push("phone_number");
  if (!booking_date)  missing.push("booking_date");
  if (!booking_time)  missing.push("booking_time");
  if (!guest_count)   missing.push("guest_count");

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // ── Build draft ───────────────────────────────────────────────────────────
  const draft: BookingDraft = {
    customer_name:  String(customer_name).trim(),
    phone_number:   String(phone_number).trim(),
    booking_date:   String(booking_date).trim(),
    booking_time:   String(booking_time).trim(),
    guest_count:    Number(guest_count),
    special_notes:  special_notes ? String(special_notes).trim() : null,
    event_name:     event_name    ? String(event_name).trim()    : null,
  };

  // ── Create reservation ────────────────────────────────────────────────────
  try {
    const reservation = await createReservation(draft, false, "website", true);

    // ── Send confirmations (non-blocking — never fail the response) ──────────
    const email = customer_email ? String(customer_email).trim() : null;
    sendBookingConfirmationWhatsApp(reservation).catch(() => {});
    sendBookingConfirmationEmail(reservation, email).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        reservation_id: reservation.id,
        message: "Booking created successfully.",
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Validation errors (past date, bad fields) → 422
    const status = message.includes("[BookingService]") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
