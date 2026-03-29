/**
 * PATCH /api/daily-ops/[id] — transition task status
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = await apiGuard(PERMISSIONS.COMPLETE_ACTION, "PATCH /api/daily-ops/[id]");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    const body = await req.json();
    const { status, comments_start, comments_end, blocker_reason, escalated_to, assigned_to } = body;

    if (!status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }

    const validStatuses = ["not_started", "started", "in_progress", "blocked", "delayed", "completed", "escalated", "missed"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }

    // Fetch current task
    const { data: task, error: fetchErr } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .eq("id", params.id)
      .eq("site_id", ctx.siteId)
      .single();

    if (fetchErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    // Start flow
    if (status === "started" || status === "in_progress") {
      if (!comments_start && !(task as any).comments_start) {
        return NextResponse.json({ error: "Start comment is required" }, { status: 400 });
      }
      if (!(task as any).started_at) {
        updates.started_at = new Date().toISOString();
      }
      if (comments_start) updates.comments_start = comments_start;
    }

    // Complete flow
    if (status === "completed") {
      if (!comments_end) {
        return NextResponse.json({ error: "Completion comment is required" }, { status: 400 });
      }
      updates.completed_at = new Date().toISOString();
      updates.comments_end = comments_end;

      // Calculate duration
      const startedAt = (task as any).started_at;
      if (startedAt) {
        const dur = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000);
        updates.duration_minutes = dur;
      }
    }

    // Block / Delay / Escalate flow
    if (status === "blocked" || status === "delayed" || status === "escalated") {
      if (!blocker_reason) {
        return NextResponse.json({ error: "Blocker reason is required" }, { status: 400 });
      }
      if (!escalated_to) {
        return NextResponse.json({ error: "Escalation contact is required" }, { status: 400 });
      }
      updates.blocker_reason = blocker_reason;
      updates.escalated_to = escalated_to;
    }

    // Assignment
    if (assigned_to !== undefined) {
      updates.assigned_to = assigned_to || null;
    }

    const { data: updated, error: updateErr } = await supabase
      .from("daily_ops_tasks")
      .update(updates)
      .eq("id", params.id)
      .select("*")
      .single();

    if (updateErr) {
      logger.error("Failed to update daily ops task", { err: updateErr });
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ task: updated });
  } catch (err) {
    logger.error("Daily ops PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
