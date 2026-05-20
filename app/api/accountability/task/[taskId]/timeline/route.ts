/**
 * GET /api/accountability/task/[taskId]/timeline
 * Full audit trail for a single task from task_accountability_log.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";

export async function GET(
  _req: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/accountability/task/[taskId]/timeline");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    // Fetch the task to verify site access
    const { data: task, error: taskErr } = await supabase
      .from("daily_ops_tasks")
      .select("id,site_id,task_name,status,task_date,due_time,assigned_to,started_at,completed_at,blocker_reason,blocked_at,escalated_at,delayed_at,time_to_complete_minutes")
      .eq("id", params.taskId)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Scope check: GMs can only see tasks from their site
    const isElevated = ["super_admin", "head_office", "executive", "area_manager"].includes(ctx.role ?? "");
    if (!isElevated && (task as any).site_id !== ctx.siteId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch full audit trail
    const { data: events, error: eventsErr } = await supabase
      .from("task_accountability_log")
      .select("id,action,actor_id,actor_name,timestamp,notes,sla_met,minutes_from_sla")
      .eq("task_id", params.taskId)
      .order("timestamp", { ascending: true });

    if (eventsErr) {
      return NextResponse.json({ error: eventsErr.message }, { status: 500 });
    }

    return NextResponse.json({
      task,
      timeline: events ?? [],
    });
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
