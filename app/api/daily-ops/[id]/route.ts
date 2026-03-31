/**
 * PATCH /api/daily-ops/[id] — transition task status
 * Writes an accountability log entry on every status change.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";
import { computeSla } from "@/services/accountability/score-calculator";

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
    const { status, comments_start, comments_end, blocker_reason, escalated_to, actor_name } = body;

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

    const now    = new Date().toISOString();
    const updates: Record<string, unknown> = {
      status,
      updated_at: now,
    };

    // ── Start flow ────────────────────────────────────────────────────────────
    if (status === "started" || status === "in_progress") {
      if (!comments_start && !(task as any).comments_start) {
        return NextResponse.json({ error: "Start comment is required" }, { status: 400 });
      }
      if (!(task as any).started_at) {
        updates.started_at  = now;
        updates.started_by  = ctx.userId;
      }
      if (comments_start) updates.comments_start = comments_start;
    }

    // ── Complete flow ─────────────────────────────────────────────────────────
    let slaMet: boolean | null = null;
    let minutesFromSla: number | null = null;
    let timeToCompleteMinutes: number | null = null;

    if (status === "completed") {
      if (!comments_end) {
        return NextResponse.json({ error: "Completion comment is required" }, { status: 400 });
      }
      updates.completed_at   = now;
      updates.completed_by   = ctx.userId;
      updates.comments_end   = comments_end;

      const startedAt = (task as any).started_at;
      if (startedAt) {
        timeToCompleteMinutes = Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000);
        updates.duration_minutes         = timeToCompleteMinutes;
        updates.time_to_complete_minutes = timeToCompleteMinutes;
      }

      // SLA computation
      const t = task as any;
      if (t.due_time && t.task_date) {
        const slaResult     = computeSla(t.task_date, t.due_time, now);
        slaMet              = slaResult.sla_met;
        minutesFromSla      = slaResult.minutes_from_sla;
      }
    }

    // ── Block / Delay / Escalate flow ─────────────────────────────────────────
    if (status === "blocked" || status === "delayed" || status === "escalated") {
      if (!blocker_reason) {
        return NextResponse.json({ error: "Blocker reason is required" }, { status: 400 });
      }
      updates.blocker_reason = blocker_reason;
      if (escalated_to) updates.escalated_to = escalated_to;

      if (status === "blocked") {
        updates.blocked_by     = ctx.userId;
        updates.blocked_at     = now;
        updates.blocked_reason = blocker_reason;
      }
      if (status === "delayed") {
        if (!(task as any).delayed_at) updates.delayed_at = now;
      }
      if (status === "escalated") {
        updates.escalated_by = ctx.userId;
        updates.escalated_at = now;
      }
    }

    // Auto-assign to the signed-in user performing the action
    updates.assigned_to = ctx.userId;

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

    // ── Write accountability log entry ────────────────────────────────────────
    const logAction =
      status === "started"     ? "started"    :
      status === "in_progress" ? "started"    :
      status === "completed"   ? "completed"  :
      status === "blocked"     ? "blocked"    :
      status === "delayed"     ? "delayed"    :
      status === "escalated"   ? "escalated"  :
      status === "missed"      ? "completed"  :   // treat missed as a completed event
      null;

    if (logAction) {
      const logEntry: Record<string, unknown> = {
        task_id:         params.id,
        site_id:         ctx.siteId,
        action:          logAction,
        actor_id:        ctx.userId,
        actor_name:      actor_name ?? null,
        timestamp:       now,
        notes:           blocker_reason ?? comments_end ?? comments_start ?? null,
        sla_met:         logAction === "completed" ? slaMet : null,
        minutes_from_sla: logAction === "completed" ? minutesFromSla : null,
      };

      // Fire-and-forget — don't block the response on log write
      supabase.from("task_accountability_log").insert(logEntry).then(() => {});
    }

    return NextResponse.json({ task: updated });
  } catch (err) {
    logger.error("Daily ops PATCH failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
