/**
 * GET  /api/actions/[id]/events — Get lifecycle events for an action
 * POST /api/actions/[id]/events — Add a manual event/note to an action
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

const VALID_EVENT_TYPES = [
  "created", "started", "completed", "escalated",
  "cancelled", "reopened", "assigned", "note",
] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const supabase = createServerClient();

    const { data, error } = await (supabase.from("action_events" as any) as any)
      .select("*")
      .eq("action_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`[GET /api/actions/${id}/events]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    console.error(`[GET /api/actions/${id}/events] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const body = await req.json();
    const { event_type, actor, notes, metadata } = body as {
      event_type?: string;
      actor?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
    };

    if (!event_type || !VALID_EVENT_TYPES.includes(event_type as never)) {
      return NextResponse.json(
        { error: `event_type must be one of: ${VALID_EVENT_TYPES.join(", ")}` },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Verify action exists
    const { data: existing, error: fetchErr } = await supabase
      .from("actions")
      .select("id")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const { data, error } = await (supabase.from("action_events" as any) as any)
      .insert({
        action_id:  id,
        event_type,
        actor:      actor ?? "system",
        notes:      notes ?? null,
        metadata:   metadata ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error(`[POST /api/actions/${id}/events]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    console.error(`[POST /api/actions/${id}/events] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
