/**
 * GET  /api/events          — list upcoming site events
 * POST /api/events          — add a new event
 *
 * Query params (GET): ?siteId= (optional override for head_office)
 * Body (POST): { siteId?, eventName, eventDate, category, upliftMultiplier, notes? }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { apiGuard } from "@/lib/auth/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await apiGuard(null, "GET /api/events");
  if (guard.error) return guard.error;

  const { ctx } = guard;
  const siteId  = req.nextUrl.searchParams.get("siteId") ?? ctx.siteId;

  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("site_events")
    .select("id, event_name, event_date, category, uplift_multiplier, confirmed, notes, created_at")
    .eq("site_id", siteId)
    .gte("event_date", new Date().toISOString().slice(0, 10))
    .order("event_date", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }

  return NextResponse.json({ events: data ?? [] });
}

export async function POST(req: NextRequest) {
  const guard = await apiGuard(null, "POST /api/events");
  if (guard.error) return guard.error;

  const { ctx } = guard;

  let body: {
    siteId?: string;
    eventName?: string;
    eventDate?: string;
    category?: string;
    upliftMultiplier?: number;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const siteId           = body.siteId ?? ctx.siteId;
  const eventName        = (body.eventName ?? "").trim();
  const eventDate        = body.eventDate ?? "";
  const category         = body.category ?? "custom";
  const upliftMultiplier = Number(body.upliftMultiplier ?? 1.0);

  if (!eventName) {
    return NextResponse.json({ error: "eventName is required" }, { status: 400 });
  }
  if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return NextResponse.json({ error: "eventDate must be ISO YYYY-MM-DD" }, { status: 400 });
  }
  if (upliftMultiplier < 1.0 || upliftMultiplier > 3.0) {
    return NextResponse.json(
      { error: "upliftMultiplier must be between 1.0 and 3.0" },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  const { data, error } = await (supabase as any)
    .from("site_events")
    .insert({
      site_id:           siteId,
      event_name:        eventName,
      event_date:        eventDate,
      category,
      uplift_multiplier: upliftMultiplier,
      confirmed:         true,
      notes:             body.notes ?? null,
      created_by:        ctx.userId,
    })
    .select("id, event_name, event_date, category, uplift_multiplier")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save event" }, { status: 500 });
  }

  return NextResponse.json({ event: data }, { status: 201 });
}
