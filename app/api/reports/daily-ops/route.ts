/**
 * POST /api/reports/daily-ops — AI-generated daily operations report
 *
 * Fetches today's daily_ops_tasks across all stores the user can see,
 * structures the data, and sends it to Claude for a narrative summary.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "POST /api/reports/daily-ops");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    const today = new Date().toLocaleDateString("en-CA");

    // Fetch all accessible sites
    const { data: sites } = await supabase
      .from("sites")
      .select("id, name")
      .eq("is_active", true)
      .in("id", ctx.siteIds);

    const siteList = (sites ?? []) as { id: string; name: string }[];
    const siteIds = siteList.map((s) => s.id);
    const siteMap = Object.fromEntries(siteList.map((s) => [s.id, s.name]));

    if (siteIds.length === 0) {
      return NextResponse.json({ error: "No accessible stores" }, { status: 400 });
    }

    // Fetch today's tasks across all stores
    const { data: tasks } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .in("site_id", siteIds)
      .eq("task_date", today)
      .order("sort_order");

    const taskList = (tasks ?? []) as any[];

    // Resolve team member names
    const assignedIds = Array.from(new Set(taskList.filter((t) => t.assigned_to).map((t) => t.assigned_to)));
    let nameMap: Record<string, string> = {};
    if (assignedIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", assignedIds);
      for (const p of (profiles ?? []) as any[]) {
        nameMap[p.id] = p.full_name || p.email;
      }
    }

    // Build structured data per store
    const storeData = siteList.map((site) => {
      const storeTasks = taskList.filter((t) => t.site_id === site.id);
      return {
        store: site.name,
        tasks: storeTasks.map((t) => ({
          action: t.action_name,
          status: t.status,
          priority: t.priority,
          department: t.department,
          due_time: t.due_time,
          started_at: t.started_at,
          completed_at: t.completed_at,
          duration_minutes: t.duration_minutes,
          started_by: t.assigned_to ? nameMap[t.assigned_to] ?? "Unknown" : null,
          start_comment: t.comments_start,
          completion_comment: t.comments_end,
          blocker_reason: t.blocker_reason,
          escalated_to: t.escalated_to,
          sla: t.sla_description,
        })),
        summary: {
          total: storeTasks.length,
          completed: storeTasks.filter((t) => t.status === "completed").length,
          in_progress: storeTasks.filter((t) => ["started", "in_progress"].includes(t.status)).length,
          blocked: storeTasks.filter((t) => ["blocked", "delayed"].includes(t.status)).length,
          escalated: storeTasks.filter((t) => t.status === "escalated").length,
          missed: storeTasks.filter((t) => t.status === "missed").length,
          not_started: storeTasks.filter((t) => t.status === "not_started").length,
        },
      };
    });

    // Group-level summary
    const groupSummary = {
      date: today,
      stores_reporting: siteList.length,
      total_tasks: taskList.length,
      completed: taskList.filter((t) => t.status === "completed").length,
      in_progress: taskList.filter((t) => ["started", "in_progress"].includes(t.status)).length,
      blocked: taskList.filter((t) => ["blocked", "delayed"].includes(t.status)).length,
      escalated: taskList.filter((t) => t.status === "escalated").length,
      missed: taskList.filter((t) => t.status === "missed").length,
      not_started: taskList.filter((t) => t.status === "not_started").length,
    };

    // Generate AI narrative
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let narrative = "";

    if (apiKey) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey });

      const prompt = `You are a senior hospitality operations analyst. Generate a concise, actionable daily operations report for a restaurant group's head office.

Today's date: ${today}
${groupSummary.stores_reporting} stores reporting.

GROUP SUMMARY:
- Total tasks: ${groupSummary.total_tasks}
- Completed: ${groupSummary.completed}
- In Progress: ${groupSummary.in_progress}
- Blocked/Delayed: ${groupSummary.blocked}
- Escalated: ${groupSummary.escalated}
- Missed: ${groupSummary.missed}
- Not Started: ${groupSummary.not_started}

STORE-BY-STORE DATA:
${JSON.stringify(storeData, null, 2)}

Write a report with these sections (use markdown headers):

## Executive Summary
A 2-3 sentence overview of group-wide operational status. Be direct. Flag any concerns.

## Store Highlights
For each store, 2-3 sentences covering: completion status, any blockers/delays, notable comments from managers, and SLA compliance. Include the manager's actual comments where relevant.

## Issues & Escalations
List any blocked, delayed, escalated, or missed tasks. Include the blocker reason and who it was escalated to. If none, say "No issues reported."

## SLA Compliance
Which tasks met their SLA deadlines and which didn't? Be specific about times.

## Recommendations
2-3 actionable recommendations based on today's data. Focus on patterns, recurring issues, or operational gaps.

Keep the tone professional but direct. Use bullet points where appropriate. Do not include any pleasantries or filler.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });

      narrative = message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
    } else {
      // Fallback: structured summary without AI
      narrative = buildFallbackReport(groupSummary, storeData);
    }

    return NextResponse.json({
      ok: true,
      date: today,
      groupSummary,
      stores: storeData,
      narrative,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[DailyOpsReport] Failed", { err });
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}

function buildFallbackReport(
  group: { total_tasks: number; completed: number; blocked: number; escalated: number; missed: number; not_started: number },
  stores: { store: string; summary: { total: number; completed: number; blocked: number; escalated: number } }[],
): string {
  const completionRate = group.total_tasks > 0 ? Math.round((group.completed / group.total_tasks) * 100) : 0;
  let report = `## Executive Summary\n\n`;
  report += `Group completion rate: **${completionRate}%** (${group.completed}/${group.total_tasks} tasks). `;
  if (group.blocked > 0) report += `**${group.blocked}** tasks blocked/delayed. `;
  if (group.escalated > 0) report += `**${group.escalated}** escalated. `;
  if (group.missed > 0) report += `**${group.missed}** missed. `;
  if (group.not_started > 0) report += `**${group.not_started}** not yet started.`;
  report += `\n\n## Store Highlights\n\n`;
  for (const s of stores) {
    const rate = s.summary.total > 0 ? Math.round((s.summary.completed / s.summary.total) * 100) : 0;
    report += `**${s.store}**: ${rate}% complete (${s.summary.completed}/${s.summary.total})`;
    if (s.summary.blocked > 0) report += ` — ${s.summary.blocked} blocked`;
    if (s.summary.escalated > 0) report += ` — ${s.summary.escalated} escalated`;
    report += `\n\n`;
  }
  return report;
}
