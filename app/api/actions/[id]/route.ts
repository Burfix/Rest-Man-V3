/**
 * PATCH  /api/actions/[id]  — Transition action state with lifecycle tracking
 * DELETE /api/actions/[id]  — Delete an action
 *
 * PATCH body:
 *   { status: "in_progress" | "completed" | "escalated" | "cancelled" | "pending" }
 *   Optional: { actor?: string, notes?: string }
 *
 * Validates transitions. Writes action_event. Sets lifecycle timestamps.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getLatestRevenueFigure } from "@/lib/revenueSnapshot";
import {
  ACTION_STATUSES,
  getTransitionError,
  transitionToEventType,
  type ActionStatus,
} from "@/lib/actions/lifecycle";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const body = await req.json();
    const { status, actor, notes } = body as {
      status?: string;
      actor?: string;
      notes?: string;
    };

    if (!status || !ACTION_STATUSES.includes(status as ActionStatus)) {
      return NextResponse.json(
        { error: `status must be one of: ${ACTION_STATUSES.join(", ")}` },
        { status: 400 },
      );
    }

    const supabase = createServerClient();

    // Fetch existing action
    const { data: existing, error: fetchErr } = await supabase
      .from("actions")
      .select("id, status, revenue_before")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const from = existing.status as ActionStatus;
    const to = status as ActionStatus;

    // Validate transition
    const transitionErr = getTransitionError(from, to);
    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 409 });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: to };

    // Set lifecycle timestamps
    switch (to) {
      case "in_progress":
        update.started_at = now;
        break;
      case "completed": {
        update.completed_at = now;
        // Capture post-action revenue for impact delta
        const rev = await getLatestRevenueFigure(supabase);
        const revBefore = typeof existing.revenue_before === "number" ? existing.revenue_before : null;
        update.revenue_after = rev.sales;
        update.revenue_date_after = rev.date;
        update.revenue_delta = revBefore != null && rev.sales != null ? rev.sales - revBefore : null;
        break;
      }
      case "escalated":
        update.escalated_at = now;
        break;
      case "pending":
        update.reopened_at = now;
        break;
    }

    const { data, error } = await supabase
      .from("actions")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[PATCH /api/actions/${id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Write lifecycle event
    const eventType = transitionToEventType(from, to);
    await (supabase.from("action_events" as any) as any).insert({
      action_id:  id,
      event_type: eventType,
      actor:      actor ?? "gm",
      notes:      notes ?? null,
      metadata:   { from, to },
    });

    return NextResponse.json({ action: data });
  } catch (err) {
    console.error(`[PATCH /api/actions/${id}] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("actions")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(`[DELETE /api/actions/${id}]`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(`[DELETE /api/actions/${id}] unexpected:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
