/**
 * POST /api/bookings/reminders/run
 *
 * Finds all non-cancelled reservations for tomorrow (SAST) and sends each
 * guest a WhatsApp reminder. Designed to be called once daily by a cron job.
 *
 * Auth: Bearer token — must match CRON_SECRET env var.
 *       Set this as a secret in Vercel and configure a cron trigger.
 *
 * Returns: { date, processed, sent, skipped }
 *
 * Vercel cron config example (vercel.json):
 *   { "crons": [{ "path": "/api/bookings/reminders/run", "schedule": "0 8 * * *" }] }
 * (Vercel cron uses GET; use a webhook/external cron for POST)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendBookingReminder } from "@/services/notifications/whatsappBookings";
import type { Reservation } from "@/types";

/** Tomorrow's date in Africa/Johannesburg timezone as YYYY-MM-DD */
function tomorrowSAST(): string {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" })
  );
  now.setDate(now.getDate() + 1);
  return now.toLocaleDateString("en-CA"); // YYYY-MM-DD
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth via CRON_SECRET ───────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this server." },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Fetch tomorrow's bookings ──────────────────────────────────────────────
  const tomorrow = tomorrowSAST();
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("booking_date", tomorrow)
    .neq("status", "cancelled")
    .order("booking_time", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: `DB error: ${error.message}` },
      { status: 500 }
    );
  }

  const reservations = (data ?? []) as Reservation[];

  // ── Send reminders ────────────────────────────────────────────────────────
  let sent = 0;
  let skipped = 0;

  for (const reservation of reservations) {
    const ok = await sendBookingReminder(reservation);
    if (ok) {
      sent++;
    } else {
      skipped++; // no phone / WA error
    }
  }

  console.info(
    `[Reminders] ${tomorrow}: processed=${reservations.length} sent=${sent} skipped=${skipped}`
  );

  return NextResponse.json(
    { date: tomorrow, processed: reservations.length, sent, skipped },
    { status: 200 }
  );
}
