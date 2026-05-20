/**
 * GET  /api/actions/[id]/events — Get lifecycle events for an action
 * POST /api/actions/[id]/events — Add a manual event/note to an action
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createActionEventSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/actions/[id]/events");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Verify action belongs to user's site
    const { data: action } = await supabase
      .from("actions")
      .select("id")
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .single();

    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const { data, error } = await (supabase.from("action_events" as any) as any)
      .select("*")
      .eq("action_id", id)
      .order("created_at", { ascending: true });

    if (error) {
      logger.error("Failed to fetch events", { route: "GET /api/actions/[id]/events", err: error, actionId: id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    logger.error("Unexpected error", { route: "GET /api/actions/[id]/events", err, actionId: id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/actions/[id]/events");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    // Verify action belongs to user's site
    const { data: action } = await supabase
      .from("actions")
      .select("id")
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .single();

    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const body = await req.json();
    const v = validateBody(createActionEventSchema, body);
    if (!v.success) return v.response;
    const d = v.data;

    const { data, error } = await (supabase.from("action_events" as any) as any)
      .insert({
        action_id: id,
        event_type: d.event_type,
        actor: d.actor ?? ctx.email,
        notes: d.notes ?? null,
        metadata: d.metadata ?? null,
      })
      .select()
      .single();

    if (error) {
      logger.error("Failed to create event", { route: "POST /api/actions/[id]/events", err: error, actionId: id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info("Action event created", { route: "POST /api/actions/[id]/events", actionId: id, eventType: d.event_type });
    return NextResponse.json({ event: data }, { status: 201 });
  } catch (err) {
    logger.error("Unexpected error", { route: "POST /api/actions/[id]/events", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
