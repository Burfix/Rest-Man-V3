/**
 * GET /api/cron/daily-sync
 *
 * Vercel-scheduled cron (0 0 * * * → midnight UTC / 2AM SAST):
 *  1. Triggers labour + revenue syncs from MICROS/Oracle BIAPI
 *  2. Pulls full daily-ops data for every active site
 *  3. Builds a dark-theme HTML email and sends it to DAILY_REPORT_EMAIL
 *
 * Protected by Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerClient } from "@/lib/supabase/server";
import { MicrosSyncService } from "@/services/micros/MicrosSyncService";
import { runLabourDeltaSync } from "@/services/micros/labour/sync";
import { getMicrosConfigStatus } from "@/lib/micros/config";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Date in SAST (UTC+2)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

  // ── 1. Run syncs in parallel ────────────────────────────────────────────────
  const cfgStatus = getMicrosConfigStatus();
  if (cfgStatus.enabled && cfgStatus.configured) {
    await Promise.allSettled([
      new MicrosSyncService().runFullSync(today),
      runLabourDeltaSync(),
    ]);
  }

  // ── 2. Pull report data ─────────────────────────────────────────────────────
  const supabase = createServerClient() as any;

  const { data: sites } = await supabase
    .from("sites")
    .select("id, name, city, target_labour_pct")
    .eq("is_active", true);

  const siteList = (sites ?? []) as any[];
  const siteIds = siteList.map((s) => s.id);

  if (siteIds.length === 0) {
    logger.warn("[DailySync] No active sites — aborting email");
    return NextResponse.json({ ok: false, error: "No active sites" });
  }

  const todayDate = new Date(today);
  const in30 = new Date(todayDate);
  in30.setDate(in30.getDate() + 30);
  const sevenAgo = new Date(todayDate);
  sevenAgo.setDate(sevenAgo.getDate() - 7);
  const sevenAgoStr = sevenAgo.toLocaleDateString("en-CA");

  const [tasksRes, maintRes, complianceRes, snapshotRes, reviewRes, actionsRes] =
    await Promise.all([
      supabase.from("daily_ops_tasks").select("*").in("site_id", siteIds).eq("task_date", today).order("sort_order"),
      supabase.from("maintenance_logs")
        .select("id, site_id, issue_title, issue_description, priority, repair_status, impact_level, date_reported, reported_by")
        .in("site_id", siteIds).in("repair_status", ["open", "in_progress", "awaiting_parts"])
        .order("date_reported", { ascending: false }).limit(100),
      supabase.from("compliance_items")
        .select("id, site_id, category, display_name, status, next_due_date, is_critical")
        .in("site_id", siteIds).eq("is_active", true),
      supabase.from("store_snapshots")
        .select("site_id, snapshot_date, sales_net_vat, revenue_target, revenue_gap_pct, labour_pct, operating_score, score_grade")
        .in("site_id", siteIds).order("snapshot_date", { ascending: false }),
      supabase.from("reviews")
        .select("id, site_id, rating, sentiment, platform, reviewer_name, review_text, review_date")
        .in("site_id", siteIds).gte("review_date", sevenAgoStr)
        .order("review_date", { ascending: false }).limit(100),
      supabase.from("actions")
        .select("id, site_id, status, created_at")
        .in("site_id", siteIds).is("archived_at", null).neq("status", "completed"),
    ]);

  const taskList     = (tasksRes.data     ?? []) as any[];
  const maintList    = (maintRes.data     ?? []) as any[];
  const compList     = (complianceRes.data ?? []) as any[];
  const reviewList   = (reviewRes.data    ?? []) as any[];
  const actionsList  = (actionsRes.data   ?? []) as any[];

  // Latest snapshot per site
  const latestSnap: Record<string, any> = {};
  for (const s of (snapshotRes.data ?? []) as any[]) {
    if (!latestSnap[s.site_id]) latestSnap[s.site_id] = s;
  }

  // Live transactional fallback for sites without today's snapshot
  const fallbackIds = siteIds.filter((id) => !latestSnap[id] || latestSnap[id].snapshot_date !== today);
  const liveRev: Record<string, number> = {};
  const liveLab: Record<string, number> = {};
  if (fallbackIds.length > 0) {
    const [rr, lr] = await Promise.all([
      supabase.from("revenue_records").select("site_id, net_vat_excl").in("site_id", fallbackIds).eq("service_date", today),
      supabase.from("labour_records").select("site_id, labour_cost").in("site_id", fallbackIds).eq("service_date", today),
    ]);
    for (const r of (rr.data ?? []) as any[]) liveRev[r.site_id] = (liveRev[r.site_id] ?? 0) + Number(r.net_vat_excl || 0);
    for (const l of (lr.data ?? []) as any[]) liveLab[l.site_id] = (liveLab[l.site_id] ?? 0) + Number(l.labour_cost || 0);
  }

  // Compliance live status
  for (const ci of compList) {
    if (!ci.next_due_date) { ci._status = "unknown"; continue; }
    const due = new Date(ci.next_due_date);
    ci._status = due < todayDate ? "expired" : due <= in30 ? "due_soon" : "compliant";
  }

  // Resolve staff names
  const assignedIds = Array.from(new Set(taskList.filter((t) => t.assigned_to).map((t) => t.assigned_to)));
  const nameMap: Record<string, string> = {};
  if (assignedIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", assignedIds);
    for (const p of (profiles ?? []) as any[]) nameMap[p.id] = p.full_name || p.email;
  }

  const OVERDUE_MS = 24 * 3_600_000;
  const nowMs = Date.now();

  // ── Build per-store data ────────────────────────────────────────────────────
  const storeData = siteList.map((site) => {
    const tasks      = taskList.filter((t) => t.site_id === site.id);
    const maint      = maintList.filter((m) => m.site_id === site.id);
    const compliance = compList.filter((c) => c.site_id === site.id);
    const reviews    = reviewList.filter((r) => r.site_id === site.id);
    const actions    = actionsList.filter((a) => a.site_id === site.id);
    const snap       = latestSnap[site.id] ?? null;

    const total       = tasks.length;
    const completed   = tasks.filter((t) => t.status === "completed").length;
    const blocked     = tasks.filter((t) => ["blocked", "delayed"].includes(t.status)).length;
    const missed      = tasks.filter((t) => t.status === "missed").length;
    const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    const overdueTasks = tasks.filter((t) => {
      if (t.status === "completed" || !t.due_time) return false;
      const [h, m] = t.due_time.split(":").map(Number);
      const due = new Date(today); due.setHours(h, m, 0, 0);
      return new Date() > due;
    });

    // Financials with live fallback
    const snapIsToday = snap?.snapshot_date === today;
    const liveRevSite = liveRev[site.id] > 0 ? liveRev[site.id] : null;
    const liveLabSite = liveLab[site.id] > 0 ? liveLab[site.id] : null;
    const sales_net_vat = snapIsToday && snap.sales_net_vat != null ? Number(snap.sales_net_vat) : liveRevSite;
    const revenue_target = snap?.revenue_target != null ? Number(snap.revenue_target) : null;
    const labour_pct = (snapIsToday && snap.labour_pct != null)
      ? Number(snap.labour_pct)
      : (liveLabSite != null && liveRevSite != null && liveRevSite > 0
          ? Math.round((liveLabSite / liveRevSite) * 1000) / 10
          : null);

    let riskLevel: "green" | "yellow" | "red" = "green";
    if (completionPct < 70 || blocked >= 2 || missed > 0) riskLevel = "red";
    else if (completionPct < 90 || blocked > 0 || overdueTasks.length > 0) riskLevel = "yellow";

    const negativeCount = reviews.filter((r) => r.sentiment === "negative" || r.rating < 3).length;
    const avgRating = reviews.length > 0
      ? Math.round(reviews.reduce((s: number, r: any) => s + (r.rating ?? 0), 0) / reviews.length * 10) / 10
      : null;

    const overdueActions = actions.filter((a) => nowMs - new Date(a.created_at).getTime() > OVERDUE_MS);

    return {
      store: site.name,
      city: site.city,
      riskLevel,
      tasks: tasks.map((t) => ({
        action: t.action_name,
        status: t.status,
        started_by: t.assigned_to ? (nameMap[t.assigned_to] ?? "—") : "—",
        started_at: t.started_at,
        completed_at: t.completed_at,
        duration_minutes: t.duration_minutes,
        sla_met: t.status === "completed" && t.due_time ? (() => {
          if (!t.completed_at) return null;
          const [h, m] = t.due_time.split(":").map(Number);
          const due = new Date(today); due.setHours(h, m, 0, 0);
          return new Date(t.completed_at) <= due;
        })() : null,
        blocker_reason: t.blocker_reason,
        completion_comment: t.comments_end,
        start_comment: t.comments_start,
      })),
      summary: { total, completed, blocked, missed, overdue: overdueTasks.length, completion_pct: completionPct },
      financials: {
        sales_net_vat,
        revenue_target,
        labour_pct,
        target_labour_pct: site.target_labour_pct ?? 30,
        operating_score: snap?.operating_score ?? null,
        score_grade: snap?.score_grade ?? null,
      },
      maintenance: {
        open_count: maint.length,
        issues: maint.slice(0, 10).map((m) => ({
          title: m.issue_title,
          priority: m.priority,
          status: m.repair_status,
          reported: m.date_reported,
          description: m.issue_description || null,
          assigned_to: m.reported_by || null,
        })),
      },
      compliance: {
        expired: compliance.filter((c) => c._status === "expired").length,
        items: compliance.filter((c) => c._status === "expired").slice(0, 5)
          .map((c) => ({ name: c.display_name, category: c.category })),
      },
      reviews: { total_7d: reviews.length, avg_rating: avgRating, negative_count: negativeCount },
      actions: { open_count: actions.length, overdue_count: overdueActions.length },
    };
  });

  // ── 3. Send email ────────────────────────────────────────────────────────────
  const recipient = process.env.DAILY_REPORT_EMAIL;
  if (!recipient) {
    logger.warn("[DailySync] DAILY_REPORT_EMAIL not set — skipping send");
    return NextResponse.json({ ok: true, email_sent: false, note: "DAILY_REPORT_EMAIL not configured" });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logger.warn("[DailySync] RESEND_API_KEY not set — skipping send");
    return NextResponse.json({ ok: true, email_sent: false, note: "RESEND_API_KEY not configured" });
  }

  const storeLabel = storeData.length === 1 ? storeData[0].store : `${storeData.length} Stores`;
  const subject = `Daily Report · ${storeLabel} · ${today}`;
  const html = buildDailyReportEmail(storeData, today);

  const resend = new Resend(resendKey);
  const from = process.env.SMTP_FROM ?? "Daily Report <onboarding@resend.dev>";
  const { error: emailErr } = await resend.emails.send({ from, to: recipient, subject, html });

  if (emailErr) {
    logger.error("[DailySync] Email send failed", { err: emailErr });
    return NextResponse.json({ ok: true, email_sent: false, email_error: emailErr.message });
  }

  logger.info("[DailySync] Daily report sent", { to: recipient, stores: storeData.length, date: today });
  return NextResponse.json({ ok: true, email_sent: true, to: recipient, stores: storeData.length, date: today });
}

// ── Email helpers ─────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtZAR(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `R${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `R${Math.round(n / 1_000).toLocaleString()}k`;
  return `R${Math.round(n).toLocaleString()}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function statusStyle(status: string): string {
  switch (status) {
    case "completed":   return "background:#052e16;color:#22c55e;";
    case "started":
    case "in_progress": return "background:#1e3a5f;color:#60a5fa;";
    case "escalated":   return "background:#431407;color:#fbbf24;";
    case "blocked":
    case "delayed":
    case "missed":      return "background:#3b0a0a;color:#f87171;";
    default:            return "background:#1c1c1c;color:#9ca3af;";
  }
}

function priorityDot(priority: string): string {
  const color = (priority === "urgent" || priority === "critical") ? "#ef4444"
    : priority === "high" ? "#f59e0b"
    : "#6b7280";
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle;"></span>`;
}

function riskBadgeHtml(level: "green" | "yellow" | "red"): string {
  const map = {
    green:  { bg: "#052e16", color: "#22c55e", label: "OK" },
    yellow: { bg: "#422006", color: "#fbbf24", label: "ATTENTION" },
    red:    { bg: "#3b0a0a", color: "#ef4444", label: "AT RISK" },
  };
  const { bg, color, label } = map[level];
  return `<span style="background:${bg};color:${color};font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 8px;border-radius:4px;">${label}</span>`;
}

function kpiCard(label: string, value: string, subtext?: string, valueColor?: string): string {
  return `
    <td style="width:16%;padding:0 4px;">
      <div style="background:#252525;border-radius:8px;padding:12px 10px;text-align:center;">
        <div style="font-size:10px;color:#9ca3af;letter-spacing:.5px;margin-bottom:4px;">${esc(label)}</div>
        <div style="font-size:18px;font-weight:700;color:${valueColor ?? "#ffffff"};">${esc(value)}</div>
        ${subtext ? `<div style="font-size:9px;color:#6b7280;margin-top:2px;">${esc(subtext)}</div>` : ""}
      </div>
    </td>`;
}

// ── Email builder ─────────────────────────────────────────────────────────────

function buildDailyReportEmail(stores: any[], date: string): string {
  const storeBlocks = stores.map((s) => buildStoreBlock(s, date)).join(`
    <tr><td style="height:24px;"></td></tr>
  `);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Daily Ops Report · ${esc(date)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="680" cellpadding="0" cellspacing="0" style="max-width:680px;width:100%;">

          <!-- Top header -->
          <tr>
            <td style="padding:0 0 20px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:11px;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Head Office Operations</div>
                    <div style="font-size:22px;font-weight:700;color:#ffffff;">Daily Report</div>
                    <div style="font-size:13px;color:#9ca3af;margin-top:4px;">${esc(date)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${storeBlocks}

          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;border-top:1px solid #1f1f1f;margin-top:24px;">
              <p style="font-size:11px;color:#4b5563;text-align:center;margin:0;">
                Automated daily ops report · Generated ${esc(new Date().toISOString())}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildStoreBlock(s: any, date: string): string {
  const f = s.financials;

  // KPI values
  const dutyColor = s.summary.completion_pct >= 90 ? "#22c55e" : s.summary.completion_pct >= 70 ? "#fbbf24" : "#ef4444";
  const labourColor = f.labour_pct != null
    ? (f.labour_pct <= f.target_labour_pct ? "#22c55e" : "#ef4444")
    : "#9ca3af";

  // Duties table rows
  const taskRows = s.tasks.map((t: any) => {
    const slaCell = t.sla_met === true
      ? `<span style="color:#22c55e;font-weight:700;">Met</span>`
      : t.sla_met === false
      ? `<span style="color:#ef4444;font-weight:700;">Missed</span>`
      : `<span style="color:#4b5563;">—</span>`;

    const blockerCell = t.blocker_reason
      ? `<span style="color:#f87171;">${esc(t.blocker_reason)}</span>`
      : esc(t.completion_comment || t.start_comment || "—");

    return `
        <tr style="border-bottom:1px solid #1f1f1f;">
          <td style="padding:6px 8px;color:#e5e5e5;font-size:11px;max-width:160px;">${esc(t.action)}</td>
          <td style="padding:6px 8px;text-align:center;">
            <span style="font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 6px;border-radius:3px;${statusStyle(t.status)}">
              ${esc(t.status.replace(/_/g, " ").toUpperCase())}
            </span>
          </td>
          <td style="padding:6px 8px;color:#9ca3af;font-size:11px;">${esc(t.started_by)}</td>
          <td style="padding:6px 8px;color:#9ca3af;font-size:11px;">${fmtTime(t.started_at)}</td>
          <td style="padding:6px 8px;color:#9ca3af;font-size:11px;">${fmtTime(t.completed_at)}</td>
          <td style="padding:6px 8px;color:#9ca3af;font-size:11px;text-align:right;">${t.duration_minutes ?? "—"}</td>
          <td style="padding:6px 8px;text-align:center;font-size:11px;">${slaCell}</td>
          <td style="padding:6px 8px;color:#9ca3af;font-size:11px;max-width:160px;">${blockerCell}</td>
        </tr>`;
  }).join("");

  // Maintenance items (expanded)
  const maintItems = s.maintenance.issues.length === 0
    ? `<p style="font-size:12px;color:#4b5563;margin:0;">No open issues.</p>`
    : s.maintenance.issues.map((m: any) => {
        const priStyle = (m.priority === "urgent" || m.priority === "critical")
          ? "background:#3b0a0a;color:#f87171;border:1px solid #7f1d1d;"
          : m.priority === "high"
          ? "background:#431407;color:#fbbf24;border:1px solid #78350f;"
          : "background:#1c1c1c;color:#9ca3af;border:1px solid #374151;";
        const statusColor = m.status === "open" ? "#fbbf24" : m.status === "in_progress" ? "#60a5fa" : "#9ca3af";
        return `
        <div style="border:1px solid #2a2a2a;border-radius:6px;padding:10px 12px;margin-bottom:6px;">
          <div style="display:table;width:100%;margin-bottom:4px;">
            <div style="display:table-cell;vertical-align:top;">
              <span style="font-size:12px;font-weight:600;color:#e5e5e5;">${esc(m.title)}</span>
            </div>
            <div style="display:table-cell;text-align:right;vertical-align:top;white-space:nowrap;">
              <span style="font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:2px 6px;border-radius:3px;${priStyle}">${esc(m.priority)}</span>
              <span style="font-size:10px;color:#6b7280;margin-left:8px;">${esc(m.reported ?? "")}</span>
            </div>
          </div>
          <div style="font-size:11px;color:#6b7280;">
            ${m.assigned_to ? `<span>Reported by: <span style="color:#9ca3af;">${esc(m.assigned_to)}</span></span>&nbsp;·&nbsp;` : ""}
            <span style="color:${statusColor};font-weight:600;">${esc((m.status ?? "").replace(/_/g, " "))}</span>
          </div>
          ${m.description ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">${esc(m.description.slice(0, 120))}${m.description.length > 120 ? "…" : ""}</div>` : ""}
        </div>`;
      }).join("");

  // Compliance
  const complianceContent = s.compliance.expired === 0
    ? `<p style="font-size:12px;color:#22c55e;margin:0;">No overdue items.</p>`
    : `<p style="font-size:12px;color:#ef4444;margin:0 0 6px 0;font-weight:700;">${s.compliance.expired} overdue item${s.compliance.expired > 1 ? "s" : ""}</p>` +
      s.compliance.items.map((ci: any) =>
        `<div style="font-size:11px;color:#9ca3af;padding:3px 0;">· ${esc(ci.name)} <span style="color:#6b7280;">(${esc(ci.category)})</span></div>`
      ).join("");

  return `
    <tr>
      <td style="background:#141414;border-radius:12px;overflow:hidden;">

        <!-- Store header -->
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-bottom:1px solid #2a2a2a;">
          <tr>
            <td style="padding:16px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:16px;font-weight:700;color:#ffffff;">${esc(s.store)}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(s.city)} · Daily Report · ${esc(date)}</div>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    ${riskBadgeHtml(s.riskLevel)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div style="padding:20px;">

          <!-- KPI Tiles -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              ${kpiCard("Duties", `${s.summary.completion_pct}%`, `${s.summary.completed}/${s.summary.total}`, dutyColor)}
              ${kpiCard("Blocked", String(s.summary.blocked), undefined, s.summary.blocked > 0 ? "#ef4444" : "#9ca3af")}
              ${kpiCard("Overdue", String(s.summary.overdue), undefined, s.summary.overdue > 0 ? "#ef4444" : "#9ca3af")}
              ${kpiCard("Revenue", fmtZAR(f.sales_net_vat), f.revenue_target ? `Target: ${fmtZAR(f.revenue_target)}` : undefined)}
              ${kpiCard("Labour %", f.labour_pct != null ? `${f.labour_pct}%` : "—", `Target: ${f.target_labour_pct}%`, labourColor)}
              ${kpiCard("Score", f.operating_score != null ? String(f.operating_score) : "—", f.score_grade ?? undefined)}
            </tr>
          </table>

          <!-- Daily Duties Table -->
          <div style="margin-bottom:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">Daily Duties</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr style="background:#252525;border-bottom:1px solid #2a2a2a;">
                  <th style="padding:7px 8px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">Task</th>
                  <th style="padding:7px 8px;text-align:center;font-size:10px;color:#6b7280;font-weight:600;">Status</th>
                  <th style="padding:7px 8px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">By</th>
                  <th style="padding:7px 8px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">Started</th>
                  <th style="padding:7px 8px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">Done</th>
                  <th style="padding:7px 8px;text-align:right;font-size:10px;color:#6b7280;font-weight:600;">Mins</th>
                  <th style="padding:7px 8px;text-align:center;font-size:10px;color:#6b7280;font-weight:600;">SLA</th>
                  <th style="padding:7px 8px;text-align:left;font-size:10px;color:#6b7280;font-weight:600;">Blocker / Comment</th>
                </tr>
              </thead>
              <tbody>
                ${taskRows || `<tr><td colspan="8" style="padding:12px 8px;color:#4b5563;font-size:12px;text-align:center;">No duties recorded for today.</td></tr>`}
              </tbody>
            </table>
          </div>

          <!-- Maintenance (full width, expanded) -->
          <div style="margin-bottom:20px;">
            <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">
              Maintenance (${s.maintenance.open_count} Open)
            </div>
            ${maintItems}
          </div>

          <!-- Reviews + Actions -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
            <tr>
              <td width="50%" style="vertical-align:top;padding-right:10px;">
                <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">
                  Guest Reviews (7d)
                </div>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding-right:16px;">
                      <div style="font-size:10px;color:#6b7280;">Total</div>
                      <div style="font-size:16px;font-weight:700;color:#ffffff;">${s.reviews.total_7d}</div>
                    </td>
                    <td style="padding-right:16px;">
                      <div style="font-size:10px;color:#6b7280;">Avg</div>
                      <div style="font-size:16px;font-weight:700;color:${s.reviews.avg_rating != null && s.reviews.avg_rating >= 4 ? "#22c55e" : "#ef4444"};">
                        ${s.reviews.avg_rating ?? "—"}
                      </div>
                    </td>
                    <td>
                      <div style="font-size:10px;color:#6b7280;">Negative</div>
                      <div style="font-size:16px;font-weight:700;color:${s.reviews.negative_count > 0 ? "#ef4444" : "#9ca3af"};">
                        ${s.reviews.negative_count}
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
              <td width="50%" style="vertical-align:top;padding-left:10px;">
                <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">
                  Actions
                </div>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" style="padding-right:6px;">
                      <div style="background:#252525;border-radius:6px;padding:10px 12px;">
                        <div style="font-size:10px;color:#6b7280;">Open</div>
                        <div style="font-size:20px;font-weight:700;color:${s.actions.open_count > 0 ? "#fbbf24" : "#6b7280"};">${s.actions.open_count}</div>
                      </div>
                    </td>
                    <td width="50%" style="padding-left:6px;">
                      <div style="background:#252525;border-radius:6px;padding:10px 12px;">
                        <div style="font-size:10px;color:#6b7280;">Overdue</div>
                        <div style="font-size:20px;font-weight:700;color:${s.actions.overdue_count > 0 ? "#ef4444" : "#6b7280"};">${s.actions.overdue_count}</div>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Compliance (full width, bottom) -->
          <div>
            <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#6b7280;text-transform:uppercase;margin-bottom:8px;">
              Compliance
            </div>
            ${complianceContent}
          </div>

        </div>
      </td>
    </tr>`;
}
