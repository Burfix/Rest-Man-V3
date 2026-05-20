/**
 * Daily Ops Report API
 *
 * POST — generate an AI-powered daily report summarising daily_ops_tasks
 *         and maintenance issues across all stores in the user's org.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "POST /api/reports/daily");
  if (guard.error) return guard.error;

  const orgId = guard.ctx!.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "No organisation context" }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

    // 1. Get all active stores in the org
    const { data: sites } = await supabase
      .from("sites")
      .select("id, name, city")
      .eq("organisation_id", orgId)
      .eq("is_active", true)
      .order("name");

    const storeList = (sites ?? []) as any[];
    const siteIds = storeList.map((s: any) => s.id);
    const siteMap = Object.fromEntries(storeList.map((s: any) => [s.id, s.name]));

    if (siteIds.length === 0) {
      return NextResponse.json({
        ok: true,
        date: today,
        stores: [],
        narrative: "No active stores found for this organisation.",
        maintenanceIssues: [],
      });
    }

    // 2. Fetch today's daily ops tasks for all stores
    const { data: tasksData } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .in("site_id", siteIds)
      .eq("task_date", today)
      .order("sort_order");

    const tasks = (tasksData ?? []) as any[];

    // 3. Fetch open / recent maintenance issues
    const { data: maintData } = await supabase
      .from("maintenance_logs")
      .select("id, equipment_id, title, description, status, priority, reported_at, site_id")
      .in("site_id", siteIds)
      .in("status", ["open", "in_progress", "pending_parts"])
      .order("reported_at", { ascending: false })
      .limit(50);

    const maintenance = (maintData ?? []) as any[];

    // 4. Resolve assignee names
    const assigneeIds = Array.from(new Set(tasks.filter((t: any) => t.assigned_to).map((t: any) => t.assigned_to)));
    let nameMap: Record<string, string> = {};
    if (assigneeIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", assigneeIds);
      for (const p of (profiles ?? []) as any[]) {
        nameMap[p.id] = p.full_name || p.email || "Unknown";
      }
    }

    // 5. Build structured data per store
    const storeReports = storeList.map((store: any) => {
      const storeTasks = tasks.filter((t: any) => t.site_id === store.id);
      const storeMaintenanceIssues = maintenance.filter((m: any) => m.site_id === store.id);

      const total = storeTasks.length;
      const completed = storeTasks.filter((t: any) => t.status === "completed").length;
      const blocked = storeTasks.filter((t: any) => ["blocked", "delayed"].includes(t.status)).length;
      const escalated = storeTasks.filter((t: any) => t.status === "escalated").length;
      const missed = storeTasks.filter((t: any) => t.status === "missed").length;
      const inProgress = storeTasks.filter((t: any) => ["started", "in_progress"].includes(t.status)).length;
      const notStarted = storeTasks.filter((t: any) => t.status === "not_started").length;

      return {
        storeName: store.name,
        city: store.city,
        siteId: store.id,
        total,
        completed,
        blocked,
        escalated,
        missed,
        inProgress,
        notStarted,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : null,
        tasks: storeTasks.map((t: any) => ({
          action: t.action_name,
          status: t.status,
          assignedTo: t.assigned_to ? (nameMap[t.assigned_to] ?? "Unknown") : "Unassigned",
          dueTime: t.due_time,
          startedAt: t.started_at,
          completedAt: t.completed_at,
          duration: t.duration_minutes,
          commentStart: t.comments_start,
          commentEnd: t.comments_end,
          blockerReason: t.blocker_reason,
          escalatedTo: t.escalated_to,
        })),
        maintenance: storeMaintenanceIssues.map((m: any) => ({
          title: m.title || m.description,
          status: m.status,
          priority: m.priority,
          reportedAt: m.reported_at,
        })),
      };
    });

    // 6. Generate AI narrative
    const narrative = await generateAINarrative(today, storeReports);

    return NextResponse.json({
      ok: true,
      date: today,
      stores: storeReports,
      narrative,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[DailyReport] Generation failed", { err });
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}

// ── AI Narrative Generator ──────────────────────────────────────────────────

async function generateAINarrative(
  date: string,
  storeReports: any[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return buildFallbackNarrative(date, storeReports);
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const dataContext = JSON.stringify(storeReports, null, 2);

    const msg = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `You are the Head Office Operations Analyst for a restaurant group. Write a concise daily operations report for ${date}.

Here is today's operational data across all stores:

${dataContext}

Write a professional daily briefing that:
1. Opens with a one-line overall status summary
2. Highlights each store's completion rate and any standout performance
3. Calls out any blocked, delayed, escalated, or missed tasks with the manager comments/reasons
4. Notes any open maintenance issues that need attention
5. Ends with 2-3 recommended actions for leadership

Keep it concise, direct, and actionable. Use plain text with line breaks (no markdown headers). Address the audience as Head Office leadership.`,
        },
      ],
    });

    const textBlock = msg.content.find((b: any) => b.type === "text");
    return (textBlock as any)?.text ?? buildFallbackNarrative(date, storeReports);
  } catch (err) {
    logger.error("[DailyReport] AI generation failed, using fallback", { err });
    return buildFallbackNarrative(date, storeReports);
  }
}

function buildFallbackNarrative(date: string, storeReports: any[]): string {
  const lines: string[] = [];
  lines.push(`Daily Operations Report — ${date}\n`);

  const totalTasks = storeReports.reduce((s, r) => s + r.total, 0);
  const totalCompleted = storeReports.reduce((s, r) => s + r.completed, 0);
  const totalBlocked = storeReports.reduce((s, r) => s + r.blocked, 0);
  const overallRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  lines.push(`Overall: ${totalCompleted}/${totalTasks} tasks completed (${overallRate}%). ${totalBlocked} blocked.\n`);

  for (const store of storeReports) {
    lines.push(`${store.storeName}: ${store.completed}/${store.total} completed (${store.completionRate ?? 0}%)`);
    if (store.blocked > 0) lines.push(`  — ${store.blocked} blocked task(s)`);
    if (store.escalated > 0) lines.push(`  — ${store.escalated} escalated task(s)`);
    if (store.missed > 0) lines.push(`  — ${store.missed} missed task(s)`);

    for (const t of store.tasks) {
      if (t.blockerReason) lines.push(`  [BLOCKED] ${t.action}: ${t.blockerReason}`);
      if (t.status === "missed") lines.push(`  [MISSED] ${t.action}`);
    }

    if (store.maintenance.length > 0) {
      lines.push(`  Maintenance: ${store.maintenance.length} open issue(s)`);
      for (const m of store.maintenance) {
        lines.push(`    - ${m.title} (${m.priority}, ${m.status})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
