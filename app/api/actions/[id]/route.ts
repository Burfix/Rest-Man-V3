/**
 * PATCH  /api/actions/[id]  — Transition action state with lifecycle tracking
 * DELETE /api/actions/[id]  — Delete an action
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { getLatestRevenueFigure } from "@/lib/revenueSnapshot";
import { ACTION_STATUSES, getTransitionError, transitionToEventType, type ActionStatus } from "@/lib/actions/lifecycle";
import { patchActionSchema, validateBody } from "@/lib/validation/schemas";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const guard = await apiGuard(PERMISSIONS.COMPLETE_ACTION, "PATCH /api/actions/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const body = await req.json();
    const v = validateBody(patchActionSchema, body);
    if (!v.success) return v.response;
    const { status, actor, notes } = v.data;

    // Fetch existing action — tenant-scoped
    const { data: existing, error: fetchErr } = await supabase
      .from("actions")
      .select("id, status, site_id")
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    const from = existing.status as ActionStatus;
    const to = status as ActionStatus;

    const transitionErr = getTransitionError(from, to);
    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 409 });
    }

    const now = new Date().toISOString();
    const update: Record<string, unknown> = { status: to };

    switch (to) {
      case "in_progress":
        update.started_at = now;
        break;
      case "completed": {
        const rev = await getLatestRevenueFigure(supabase);
        update.completed_at = now;
        update.revenue_after = rev.sales;
        update.revenue_date_after = rev.date;
        if (notes != null) update.completion_note = notes;
        break;
      }
      case "escalated":
        update.escalated_at = now;
        break;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("actions")
      .update(update)
      .eq("id", id)
      .eq("site_id", ctx.siteId)
      .select()
      .single();

    if (updateErr) {
      logger.error("Failed to update action", { route: "PATCH /api/actions/[id]", err: updateErr, actionId: id });
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Insert lifecycle event
    const eventType = transitionToEventType(from, to);
    await (supabase.from("action_events" as any) as any)
      .insert({
        action_id: id,
        event_type: eventType,
        from_status: from,
        to_status: to,
        actor: actor ?? ctx.email,
        notes: notes ?? null,
      })
      .then(() => {});

    logger.info("Action transitioned", {
      route: "PATCH /api/actions/[id]",
      actionId: id,
      from,
      to,
      siteId: ctx.siteId,
      userId: ctx.userId,
    });

    return NextResponse.json({ action: updated });
  } catch (err) {
    logger.error("Unexpected error", { route: "PATCH /api/actions/[id]", err, actionId: id });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const guard = await apiGuard(PERMISSIONS.ESCALATE_ACTION, "DELETE /api/actions/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  try {
    const { error } = await supabase
      .from("actions")
      .delete()
      .eq("id", id)
      .eq("site_id", ctx.siteId);

    if (error) {
      logger.error("Failed to delete action", { route: "DELETE /api/actions/[id]", err: error, actionId: id });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info("Action deleted", { route: "DELETE /api/actions/[id]", actionId: id, siteId: ctx.siteId });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("Unexpected error", { route: "DELETE /api/actions/[id]", err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
