import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    customer_name,
    phone_number,
    booking_date,
    booking_time,
    guest_count,
    event_name,
    special_notes,
  } = body as Record<string, unknown>;

  // Validate required fields
  if (typeof customer_name !== "string" || !customer_name.trim())
    return NextResponse.json({ error: "customer_name is required" }, { status: 422 });
  if (typeof phone_number !== "string" || !phone_number.trim())
    return NextResponse.json({ error: "phone_number is required" }, { status: 422 });
  if (typeof booking_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(booking_date))
    return NextResponse.json({ error: "booking_date must be YYYY-MM-DD" }, { status: 422 });
  if (typeof booking_time !== "string" || !/^\d{2}:\d{2}/.test(booking_time))
    return NextResponse.json({ error: "booking_time must be HH:MM" }, { status: 422 });
  if (typeof guest_count !== "number" || guest_count < 1)
    return NextResponse.json({ error: "guest_count must be a positive number" }, { status: 422 });

  const { data, error } = await supabase
    .from("reservations")
    .insert({
      customer_name: (customer_name as string).trim(),
      phone_number:  (phone_number as string).trim(),
      booking_date,
      booking_time:  (booking_time as string).slice(0, 5),
      guest_count:   Math.floor(guest_count as number),
      event_name:    typeof event_name === "string" && event_name.trim() ? event_name.trim() : null,
      special_notes: typeof special_notes === "string" && special_notes.trim() ? special_notes.trim() : null,
      status:          "confirmed",
      source_channel:  "manual",
    })
    .select()
    .single();

  if (error) {
    console.error("[manual booking] insert error", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ booking: data }, { status: 201 });
}
