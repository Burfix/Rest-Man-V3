import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createBookingSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/bookings/manual");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(createBookingSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data, error } = await supabase
      .from("reservations")
      .insert({
        site_id: ctx.siteId,
        customer_name: d.customer_name.trim(),
        phone_number: d.phone_number.trim(),
        booking_date: d.booking_date,
        booking_time: d.booking_time.slice(0, 5),
        guest_count: Math.floor(d.guest_count),
        event_name: d.event_name?.trim() || null,
        special_notes: d.special_notes?.trim() || null,
        status: "confirmed",
        source_channel: "manual",
      })
      .select()
      .single();

    if (error) throw error;
    logger.info("Manual booking created", { route: "POST /api/bookings/manual", siteId: ctx.siteId });
    return NextResponse.json({ booking: data }, { status: 201 });
  } catch (err) {
    logger.error("Failed to create manual booking", { route: "POST /api/bookings/manual", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
