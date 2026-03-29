/**
 * GET  /api/daily-ops       — list today's tasks for current site
 * POST /api/daily-ops       — generate today's tasks from templates (idempotent)
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Untyped Supabase helper (table not in generated types yet) */
function db(guard: { supabase: any }) { return guard.supabase as any; }

export async function GET() {
  const guard = await apiGuard(PERMISSIONS.VIEW_OWN_STORE, "GET /api/daily-ops");
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const supabase = db(guard);

  try {
    const today = new Date().toLocaleDateString("en-CA");

    const { data, error } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .eq("site_id", ctx.siteId)
      .eq("task_date", today)
      .order("sort_order", { ascending: true });

    if (error) {
      logger.error("Failed to fetch daily ops tasks", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const tasks = data ?? [];
    const userIds = Array.from(new Set(tasks.map((t: any) => t.assigned_to).filter(Boolean))) as string[];
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", userIds);
      for (const p of (profiles ?? []) as any[]) {
        profileMap[p.id] = p.full_name || p.email;
      }
    }

    return NextResponse.json({
      tasks: tasks.map((t: any) => ({
        ...t,
        assigned_to_name: t.assigned_to ? profileMap[t.assigned_to] ?? null : null,
      })),
      date: today,
    });
  } catch (err) {
    logger.error("Daily ops GET failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.CREATE_ACTION, "POST /api/daily-ops");
  if (guard.error) return guard.error;
  const { ctx } = guard;
  const supabase = db(guard);

  try {
    const today = new Date().toLocaleDateString("en-CA");

    const { count } = await supabase
      .from("daily_ops_tasks")
      .select("id", { count: "exact", head: true })
      .eq("site_id", ctx.siteId)
      .eq("task_date", today);

    if ((count ?? 0) > 0) {
      return NextResponse.json({ message: "Tasks already generated for today", generated: false });
    }

    const { data: siteTemplates } = await supabase
      .from("daily_ops_task_templates")
      .select("*")
      .eq("site_id", ctx.siteId)
      .eq("is_active", true)
      .order("sort_order");

    const { data: globalTemplates } = await supabase
      .from("daily_ops_task_templates")
      .select("*")
      .is("site_id", null)
      .eq("is_active", true)
      .order("sort_order");

    const templates = (siteTemplates && siteTemplates.length > 0) ? siteTemplates : (globalTemplates ?? []);

    if (templates.length === 0) {
      return NextResponse.json({ error: "No task templates configured" }, { status: 400 });
    }

    const rows = templates.map((t: any) => ({
      site_id: ctx.siteId,
      template_id: t.id,
      task_date: today,
      action_name: t.action_name,
      department: t.department,
      priority: t.default_priority,
      due_time: t.default_due_time,
      sla_description: t.sla_description,
      sort_order: t.sort_order,
      status: "not_started",
      created_by: ctx.userId,
    }));

    const { error } = await supabase.from("daily_ops_tasks").insert(rows);

    if (error) {
      logger.error("Failed to generate daily ops tasks", { err: error });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ message: "Tasks generated", generated: true, count: rows.length }, { status: 201 });
  } catch (err) {
    logger.error("Daily ops POST failed", { err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
