/**
 * POST /api/reports/daily-ops — Head Office Daily Operations Report
 *
 * Enriched report for Head Office accountability: daily ops tasks,
 * maintenance issues, compliance status, labour metrics, revenue vs target,
 * review sentiment, and an AI narrative written for operations leadership.
 */

import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "POST /api/reports/daily-ops");
  if (guard.error) return guard.error;
  const { ctx, supabase: _sb } = guard;
  const supabase = _sb as any;

  try {
    const today = new Date().toLocaleDateString("en-CA");

    // ── 1. Sites ───────────────────────────────────────────────────────────────
    const { data: sites } = await supabase
      .from("sites")
      .select("id, name, city, target_labour_pct")
      .eq("is_active", true)
      .in("id", ctx.siteIds);

    const siteList = (sites ?? []) as { id: string; name: string; city: string; target_labour_pct: number | null }[];
    const siteIds = siteList.map((s) => s.id);
    const siteMap = Object.fromEntries(siteList.map((s) => [s.id, s.name]));

    if (siteIds.length === 0) {
      return NextResponse.json({ error: "No accessible stores" }, { status: 400 });
    }

    // ── 2. Daily Ops Tasks ─────────────────────────────────────────────────────
    const { data: tasks } = await supabase
      .from("daily_ops_tasks")
      .select("*")
      .in("site_id", siteIds)
      .eq("task_date", today)
      .order("sort_order");

    const taskList = (tasks ?? []) as any[];

    // ── 3. Resolve team member names ───────────────────────────────────────────
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

    // ── 4. Maintenance issues (open) ──────────────────────────────────────────
    const { data: maintData } = await supabase
      .from("maintenance_logs")
      .select("id, site_id, issue_title, issue_description, priority, repair_status, impact_level, date_reported, follow_up_required, reported_by")
      .in("site_id", siteIds)
      .in("repair_status", ["open", "in_progress", "awaiting_parts"])
      .order("date_reported", { ascending: false })
      .limit(100);

    const maintList = (maintData ?? []) as any[];

    // ── 5. Compliance items ───────────────────────────────────────────────────
    const { data: complianceData } = await supabase
      .from("compliance_items")
      .select("id, site_id, category, display_name, status, next_due_date, is_critical")
      .in("site_id", siteIds)
      .eq("is_active", true);

    const complianceList = (complianceData ?? []) as any[];

    // Compute live compliance status
    const todayDate = new Date(today);
    const in30Days = new Date(todayDate);
    in30Days.setDate(in30Days.getDate() + 30);

    for (const ci of complianceList) {
      if (!ci.next_due_date) {
        ci.live_status = "unknown";
      } else {
        const due = new Date(ci.next_due_date);
        if (due < todayDate) ci.live_status = "expired";
        else if (due <= in30Days) ci.live_status = "due_soon";
        else ci.live_status = "compliant";
      }
    }

    // ── 6. Store snapshots (latest) — revenue, labour, scores ─────────────────
    const { data: snapshotData } = await supabase
      .from("store_snapshots")
      .select("site_id, snapshot_date, sales_net_vat, revenue_target, revenue_gap_pct, labour_pct, operating_score, score_grade, risk_level, actions_total, actions_completed, actions_overdue")
      .in("site_id", siteIds)
      .order("snapshot_date", { ascending: false });

    const snapshotList = (snapshotData ?? []) as any[];
    const latestSnapshot: Record<string, any> = {};
    for (const snap of snapshotList) {
      if (!latestSnapshot[snap.site_id]) latestSnapshot[snap.site_id] = snap;
    }

    // ── 6b. Live financial fallback — query transactional tables for sites missing today's snapshot ──
    const fallbackSiteIds = siteIds.filter(
      (id) => !latestSnapshot[id] || latestSnapshot[id].snapshot_date !== today
    );

    const liveRevenue: Record<string, number> = {};
    const liveLabour: Record<string, number> = {};

    if (fallbackSiteIds.length > 0) {
      const [revRows, labRows] = await Promise.all([
        supabase
          .from("revenue_records")
          .select("site_id, net_vat_excl")
          .in("site_id", fallbackSiteIds)
          .eq("service_date", today),
        supabase
          .from("labour_records")
          .select("site_id, labour_cost")
          .in("site_id", fallbackSiteIds)
          .eq("service_date", today),
      ]);

      for (const r of (revRows.data ?? []) as any[]) {
        liveRevenue[r.site_id] = (liveRevenue[r.site_id] ?? 0) + (Number(r.net_vat_excl) || 0);
      }
      for (const l of (labRows.data ?? []) as any[]) {
        liveLabour[l.site_id] = (liveLabour[l.site_id] ?? 0) + (Number(l.labour_cost) || 0);
      }
    }

    // ── 7. Reviews (today + recent unanswered negatives) ──────────────────────
    const sevenDaysAgo = new Date(todayDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString("en-CA");

    const { data: reviewData } = await supabase
      .from("reviews")
      .select("id, site_id, rating, sentiment, platform, reviewer_name, review_text, flagged, review_date")
      .in("site_id", siteIds)
      .gte("review_date", sevenDaysAgoStr)
      .order("review_date", { ascending: false })
      .limit(100);

    const reviewList = (reviewData ?? []) as any[];

    // ── 8. Actions (overdue) ──────────────────────────────────────────────────
    const { data: actionsData } = await supabase
      .from("actions")
      .select("id, site_id, title, status, created_at, assigned_to")
      .in("site_id", siteIds)
      .is("archived_at", null)
      .neq("status", "completed");

    const actionsList = (actionsData ?? []) as any[];
    const OVERDUE_MS = 24 * 3_600_000;
    const nowMs = Date.now();

    // ── Build per-store data ───────────────────────────────────────────────────

    const storeData = siteList.map((site) => {
      const storeTasks = taskList.filter((t) => t.site_id === site.id);
      const storeMaint = maintList.filter((m) => m.site_id === site.id);
      const storeCompliance = complianceList.filter((c) => c.site_id === site.id);
      const storeReviews = reviewList.filter((r) => r.site_id === site.id);
      const storeActions = actionsList.filter((a) => a.site_id === site.id);
      const snap = latestSnapshot[site.id] ?? null;

      // Task summary
      const total = storeTasks.length;
      const completed = storeTasks.filter((t) => t.status === "completed").length;
      const in_progress = storeTasks.filter((t) => ["started", "in_progress"].includes(t.status)).length;
      const blocked = storeTasks.filter((t) => ["blocked", "delayed"].includes(t.status)).length;
      const escalated = storeTasks.filter((t) => t.status === "escalated").length;
      const missed = storeTasks.filter((t) => t.status === "missed").length;
      const not_started = storeTasks.filter((t) => t.status === "not_started").length;
      const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Overdue tasks (started but not completed, past due time)
      const overdueTasks = storeTasks.filter((t) => {
        if (t.status === "completed") return false;
        if (!t.due_time) return false;
        const now = new Date();
        const [h, m] = t.due_time.split(":").map(Number);
        const dueDate = new Date(today);
        dueDate.setHours(h, m, 0, 0);
        return now > dueDate;
      });

      // Average completion time
      const durations = storeTasks
        .filter((t) => t.duration_minutes != null)
        .map((t) => t.duration_minutes as number);
      const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
        : null;

      // Blocker themes
      const blockerReasons = storeTasks
        .filter((t) => t.blocker_reason)
        .map((t) => t.blocker_reason as string);

      // Compliance summary
      const complianceExpired = storeCompliance.filter((c) => c.live_status === "expired").length;
      const complianceDueSoon = storeCompliance.filter((c) => c.live_status === "due_soon").length;

      // Reviews summary
      const negativeReviews = storeReviews.filter((r) => r.sentiment === "negative" || r.rating < 3);
      const flaggedReviews = storeReviews.filter((r) => r.flagged);

      // Open actions
      const overdueActions = storeActions.filter(
        (a) => nowMs - new Date(a.created_at).getTime() > OVERDUE_MS
      );

      // Risk level
      let riskLevel: "green" | "yellow" | "red" = "green";
      if (completionPct < 70 || blocked >= 2 || missed > 0) {
        riskLevel = "red";
      } else if (completionPct < 90 || blocked > 0 || overdueTasks.length > 0) {
        riskLevel = "yellow";
      }

      return {
        store: site.name,
        siteId: site.id,
        city: site.city,

        // Daily duties
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
          evidence_urls: t.evidence_urls ?? [],
          sla: t.sla_description,
          sla_met: t.status === "completed" && t.due_time ? (() => {
            if (!t.completed_at) return null;
            const [h, m] = t.due_time.split(":").map(Number);
            const dueDate = new Date(today);
            dueDate.setHours(h, m, 0, 0);
            return new Date(t.completed_at) <= dueDate;
          })() : null,
        })),

        // Summary metrics
        summary: {
          total,
          completed,
          in_progress,
          blocked,
          escalated,
          missed,
          not_started,
          overdue: overdueTasks.length,
          completion_pct: completionPct,
          avg_duration: avgDuration,
          blocker_reasons: blockerReasons,
        },

        // Financial — prefer today's snapshot; fall back to live transactional data
        financials: (() => {
          const snapIsToday = snap?.snapshot_date === today;
          const liveRev = liveRevenue[site.id] > 0 ? liveRevenue[site.id] : null;
          const liveLab = liveLabour[site.id] > 0 ? liveLabour[site.id] : null;

          const sales_net_vat = snapIsToday && snap.sales_net_vat != null
            ? Number(snap.sales_net_vat)
            : liveRev;

          const revenue_target = snap?.revenue_target != null ? Number(snap.revenue_target) : null;

          const revenue_gap_pct = (() => {
            if (snapIsToday && snap.revenue_gap_pct != null) return Number(snap.revenue_gap_pct);
            if (sales_net_vat != null && revenue_target != null && revenue_target > 0) {
              return Math.round(((sales_net_vat - revenue_target) / revenue_target) * 1000) / 10;
            }
            return null;
          })();

          const labour_pct = (() => {
            if (snapIsToday && snap.labour_pct != null) return Number(snap.labour_pct);
            if (liveLab != null && liveRev != null && liveRev > 0) {
              return Math.round((liveLab / liveRev) * 1000) / 10;
            }
            return null;
          })();

          return {
            sales_net_vat,
            revenue_target,
            revenue_gap_pct,
            labour_pct,
            target_labour_pct: site.target_labour_pct ?? 30,
            operating_score: snap?.operating_score ?? null,
            score_grade: snap?.score_grade ?? null,
          };
        })(),

        // Maintenance
        maintenance: {
          open_count: storeMaint.length,
          urgent_count: storeMaint.filter((m) => m.priority === "urgent" || m.priority === "high").length,
          issues: storeMaint.map((m) => ({
            title: m.issue_title || m.issue_description,
            priority: m.priority,
            status: m.repair_status,
            impact: m.impact_level,
            reported: m.date_reported,
            description: m.issue_description || null,
            assigned_to: m.reported_by || null,
          })),
        },

        // Compliance
        compliance: {
          total: storeCompliance.length,
          expired: complianceExpired,
          due_soon: complianceDueSoon,
          overdue_items: storeCompliance
            .filter((c) => c.live_status === "expired")
            .map((c) => ({ name: c.display_name, category: c.category, due: c.next_due_date, critical: c.is_critical })),
        },

        // Guest Experience
        reviews: {
          total_7d: storeReviews.length,
          negative_count: negativeReviews.length,
          flagged_count: flaggedReviews.length,
          avg_rating: storeReviews.length > 0
            ? Math.round((storeReviews.reduce((s, r) => s + (r.rating ?? 0), 0) / storeReviews.length) * 10) / 10
            : null,
          negative_unanswered: negativeReviews.map((r) => ({
            platform: r.platform,
            rating: r.rating,
            reviewer: r.reviewer_name,
            text: r.review_text?.slice(0, 200),
            date: r.review_date,
          })),
        },

        // Actions
        actions: {
          open_count: storeActions.length,
          overdue_count: overdueActions.length,
        },

        // Risk
        riskLevel,
      };
    });

    // ── Group-level metrics ───────────────────────────────────────────────────

    const totalTasks = taskList.length;
    const totalCompleted = taskList.filter((t) => t.status === "completed").length;
    const totalBlocked = taskList.filter((t) => ["blocked", "delayed"].includes(t.status)).length;
    const totalEscalated = taskList.filter((t) => t.status === "escalated").length;
    const totalMissed = taskList.filter((t) => t.status === "missed").length;
    const completionPct = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

    const totalRevenue = storeData.reduce((s, sd) => s + (sd.financials.sales_net_vat ?? 0), 0);
    const totalTarget = storeData.reduce((s, sd) => s + (sd.financials.revenue_target ?? 0), 0);
    const avgLabour = (() => {
      const withLabour = storeData.filter((sd) => sd.financials.labour_pct !== null);
      if (withLabour.length === 0) return null;
      return Math.round((withLabour.reduce((s, sd) => s + (sd.financials.labour_pct ?? 0), 0) / withLabour.length) * 10) / 10;
    })();

    const groupSummary = {
      date: today,
      stores_reporting: siteList.length,
      total_tasks: totalTasks,
      completed: totalCompleted,
      in_progress: taskList.filter((t) => ["started", "in_progress"].includes(t.status)).length,
      blocked: totalBlocked,
      escalated: totalEscalated,
      missed: totalMissed,
      not_started: taskList.filter((t) => t.status === "not_started").length,
      completion_pct: completionPct,

      // Financial roll-ups
      total_revenue: totalRevenue || null,
      total_target: totalTarget || null,
      revenue_vs_target_pct: totalTarget > 0 ? Math.round(((totalRevenue / totalTarget) * 100)) : null,
      avg_labour_pct: avgLabour,

      // Store risk distribution
      stores_green: storeData.filter((s) => s.riskLevel === "green").length,
      stores_yellow: storeData.filter((s) => s.riskLevel === "yellow").length,
      stores_red: storeData.filter((s) => s.riskLevel === "red").length,

      // Cross-store aggregates
      open_maintenance: maintList.length,
      overdue_compliance: complianceList.filter((c) => c.live_status === "expired").length,
      negative_reviews_unanswered: reviewList.filter((r) => r.sentiment === "negative" || r.rating < 3).length,
      total_overdue_actions: actionsList.filter((a) => nowMs - new Date(a.created_at).getTime() > OVERDUE_MS).length,
    };

    // ── AI Narrative ──────────────────────────────────────────────────────────

    const apiKey = process.env.ANTHROPIC_API_KEY;
    let narrative = "";

    if (apiKey) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const anthropic = new Anthropic({ apiKey });

      const prompt = `You are the Operations Director for a multi-site restaurant group. Write a daily operations report for Head Office leadership — regional managers, owners, and executives.

Today's date: ${today}
${groupSummary.stores_reporting} stores reporting.

GROUP METRICS:
- Total daily duties: ${groupSummary.total_tasks}
- Completed: ${groupSummary.completed} (${groupSummary.completion_pct}%)
- Blocked/Delayed: ${groupSummary.blocked}
- Escalated: ${groupSummary.escalated}
- Missed: ${groupSummary.missed}
- Total revenue: R${totalRevenue?.toLocaleString() ?? "N/A"}
- Revenue vs target: ${groupSummary.revenue_vs_target_pct ?? "N/A"}%
- Average labour: ${avgLabour ?? "N/A"}%
- Stores at risk (red): ${groupSummary.stores_red}
- Open maintenance issues: ${groupSummary.open_maintenance}
- Overdue compliance items: ${groupSummary.overdue_compliance}
- Negative reviews (7d): ${groupSummary.negative_reviews_unanswered}

STORE-BY-STORE DATA:
${JSON.stringify(storeData.map((s) => ({
  store: s.store,
  completion: s.summary.completion_pct + "%",
  duties: { completed: s.summary.completed, total: s.summary.total, blocked: s.summary.blocked, overdue: s.summary.overdue, missed: s.summary.missed },
  financials: s.financials,
  maintenance: { open: s.maintenance.open_count, urgent: s.maintenance.urgent_count },
  compliance: { expired: s.compliance.expired, due_soon: s.compliance.due_soon },
  reviews: { negative: s.reviews.negative_count, avg_rating: s.reviews.avg_rating },
  risk: s.riskLevel,
  blockerReasons: s.summary.blocker_reasons,
  tasks: s.tasks.filter((t) => t.status !== "completed").map((t) => ({ action: t.action, status: t.status, started_by: t.started_by, blocker_reason: t.blocker_reason, escalated_to: t.escalated_to })),
})), null, 2)}

Write the report in this style — sound like an Operations Director briefing Head Office:

1. Open with a 2-3 sentence overall status assessment. Be direct — flag stores requiring intervention.

2. For EACH store, write 2-3 sentences covering: completion rate, any blocked/delayed/missed duties with manager comments, financial position (revenue vs target, labour %), and any maintenance or compliance flags. Name the managers involved. Example tone: "Primi Camps Bay completed 86% of required daily duties, with two delays in invoice capture and daily stock take. Labour remained slightly above target at 35%, although turnover finished 4% above plan. One urgent maintenance issue remains open."

3. Call out the WEAKEST store specifically with a clear recommendation. Example: "Si Cantina Sociale recorded the weakest completion rate today at 52%, with four overdue duties and two blocked tasks. Head office should follow up with the GM tomorrow morning."

4. End with 3-5 specific, actionable follow-up items for Head Office tomorrow. Be concrete — name stores, managers, and issues.

Keep the tone authoritative, professional, and accountability-focused. This report exists so Head Office can hold stores accountable. No pleasantries or filler. Use markdown headers and bullet points.`;

      const message = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      });

      narrative = message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
    } else {
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
  group: any,
  stores: any[],
): string {
  let report = `## Executive Summary\n\n`;
  report += `Group daily duties completion: **${group.completion_pct}%** (${group.completed}/${group.total_tasks}). `;
  if (group.stores_red > 0) report += `**${group.stores_red}** store(s) at risk. `;
  if (group.blocked > 0) report += `**${group.blocked}** duties blocked. `;
  if (group.missed > 0) report += `**${group.missed}** duties missed. `;
  if (group.open_maintenance > 0) report += `**${group.open_maintenance}** open maintenance issue(s). `;
  if (group.overdue_compliance > 0) report += `**${group.overdue_compliance}** overdue compliance item(s).`;
  report += `\n\n## Store Performance\n\n`;
  for (const s of stores) {
    const riskEmoji = s.riskLevel === "red" ? "🔴" : s.riskLevel === "yellow" ? "🟡" : "🟢";
    report += `**${riskEmoji} ${s.store}**: ${s.summary.completion_pct}% duties complete (${s.summary.completed}/${s.summary.total})`;
    if (s.summary.blocked > 0) report += ` — ${s.summary.blocked} blocked`;
    if (s.summary.missed > 0) report += ` — ${s.summary.missed} missed`;
    if (s.financials.labour_pct) report += ` | Labour: ${s.financials.labour_pct}%`;
    if (s.maintenance.open_count > 0) report += ` | ${s.maintenance.open_count} maintenance open`;
    report += `\n\n`;
  }
  return report;
}
