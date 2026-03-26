/**
 * Weekly Report Email — HTML template + delivery via Resend.
 *
 * buildWeeklyReportEmail(report) → HTML string
 * sendWeeklyReportEmail(report, recipients) → boolean
 */

import { Resend } from "resend";
import { logger } from "@/lib/logger";
import type { WeeklyReport, TrendDirection } from "@/types/weekly-report";

const CURRENCY = process.env.CURRENCY_SYMBOL ?? "R";

// ── Helpers ────────────────────────────────────────────────────────────────────

function money(v: number | null): string {
  if (v == null) return "—";
  return `${CURRENCY}${Math.abs(v).toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function arrow(t: TrendDirection): string {
  if (t === "up") return "↑";
  if (t === "down") return "↓";
  return "→";
}

function trendColor(t: TrendDirection, inverseIsGood = false): string {
  if (t === "up") return inverseIsGood ? "#ef4444" : "#22c55e";
  if (t === "down") return inverseIsGood ? "#22c55e" : "#ef4444";
  return "#a8a29e";
}

function gradeColor(grade: string | null): string {
  if (!grade) return "#a8a29e";
  if (grade === "A") return "#22c55e";
  if (grade === "B") return "#3b82f6";
  if (grade === "C") return "#f59e0b";
  if (grade === "D") return "#f97316";
  return "#ef4444";
}

function severityBg(severity: string): string {
  if (severity === "critical") return "#7f1d1d";
  if (severity === "high") return "#78350f";
  return "#44403c";
}

// ── HTML Builder ───────────────────────────────────────────────────────────────

export function buildWeeklyReportEmail(report: WeeklyReport): string {
  const { summary: s, storeRanking, gmPerformance, executionStats, impactSummary, serviceInsights, interventionList, nextWeekFocus, weekRange } = report;
  const venueName = process.env.VENUE_NAME ?? "ForgeStack";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Performance Report — W${weekRange.weekNumber}</title>
</head>
<body style="margin:0;padding:0;background:#1c1917;color:#e7e5e4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;">
  <div style="max-width:680px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding-bottom:24px;border-bottom:1px solid #44403c;">
      <h1 style="margin:0;font-size:20px;font-weight:800;color:#fafaf9;">📊 Weekly Performance Report</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#a8a29e;">
        ${venueName} · Week ${weekRange.weekNumber} · ${weekRange.start} → ${weekRange.end}
      </p>
      <p style="margin:2px 0 0;font-size:11px;color:#78716c;">
        Generated ${new Date(report.generatedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}
      </p>
    </div>

    <!-- Executive Summary -->
    <div style="margin-top:24px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">Executive Summary</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 12px;background:#292524;border-radius:8px 0 0 0;">
            <div style="font-size:11px;color:#a8a29e;">Revenue</div>
            <div style="font-size:18px;font-weight:700;color:#fafaf9;">${money(s.totalRevenue)}</div>
            <div style="font-size:11px;color:${trendColor(s.revenueTrend)};">${arrow(s.revenueTrend)} vs prev week</div>
          </td>
          <td style="padding:8px 12px;background:#292524;">
            <div style="font-size:11px;color:#a8a29e;">Execution</div>
            <div style="font-size:18px;font-weight:700;color:${gradeColor(s.executionGrade)};">${s.avgExecutionScore ?? "—"}<span style="font-size:12px;color:#78716c;">/100</span></div>
            <div style="font-size:11px;color:${trendColor(s.executionTrend)};">${arrow(s.executionTrend)} Grade ${s.executionGrade ?? "—"}</div>
          </td>
          <td style="padding:8px 12px;background:#292524;border-radius:0 8px 0 0;">
            <div style="font-size:11px;color:#a8a29e;">Completion</div>
            <div style="font-size:18px;font-weight:700;color:#fafaf9;">${pct(s.completionRate)}</div>
            <div style="font-size:11px;color:#a8a29e;">${s.actionsCompleted}/${s.actionsAssigned} actions</div>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 12px;background:#292524;border-radius:0 0 0 8px;">
            <div style="font-size:11px;color:#a8a29e;">Revenue Gap</div>
            <div style="font-size:16px;font-weight:600;color:${(s.revenueGapPct ?? 0) > 10 ? "#ef4444" : "#fafaf9"};">${pct(s.revenueGapPct)}</div>
          </td>
          <td style="padding:8px 12px;background:#292524;">
            <div style="font-size:11px;color:#a8a29e;">Overdue</div>
            <div style="font-size:16px;font-weight:600;color:${s.actionsOverdue > 3 ? "#ef4444" : "#fafaf9"};">${s.actionsOverdue}</div>
          </td>
          <td style="padding:8px 12px;background:#292524;border-radius:0 0 8px 0;">
            <div style="font-size:11px;color:#a8a29e;">Escalated</div>
            <div style="font-size:16px;font-weight:600;color:${s.actionsEscalated > 2 ? "#f59e0b" : "#fafaf9"};">${s.actionsEscalated}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Store Ranking -->
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">Store Ranking</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="border-bottom:1px solid #44403c;">
          <th style="text-align:left;padding:6px 8px;color:#a8a29e;font-weight:600;">#</th>
          <th style="text-align:left;padding:6px 8px;color:#a8a29e;font-weight:600;">Store</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Score</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Revenue</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Done</th>
          <th style="text-align:center;padding:6px 8px;color:#a8a29e;font-weight:600;">Trend</th>
        </tr>
        ${storeRanking.map((store, i) => `
        <tr style="border-bottom:1px solid #292524;${i < 3 ? "background:#1a2e1a;" : store.avgExecutionScore != null && store.avgExecutionScore < 45 ? "background:#2e1a1a;" : ""}">
          <td style="padding:6px 8px;font-weight:700;color:#a8a29e;">${store.rank}</td>
          <td style="padding:6px 8px;color:#fafaf9;font-weight:500;">${store.storeName}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;color:${gradeColor(gradeForScore(store.avgExecutionScore))};">${store.avgExecutionScore ?? "—"}</td>
          <td style="padding:6px 8px;text-align:right;color:#d6d3d1;">${money(store.totalRevenue)}</td>
          <td style="padding:6px 8px;text-align:right;color:#d6d3d1;">${pct(store.completionRate)}</td>
          <td style="padding:6px 8px;text-align:center;color:${trendColor(store.trend)};">${arrow(store.trend)}</td>
        </tr>`).join("")}
      </table>
    </div>

    <!-- GM Performance -->
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">GM Performance</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="border-bottom:1px solid #44403c;">
          <th style="text-align:left;padding:6px 8px;color:#a8a29e;font-weight:600;">GM</th>
          <th style="text-align:left;padding:6px 8px;color:#a8a29e;font-weight:600;">Store</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Score</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Δ</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Done%</th>
          <th style="text-align:right;padding:6px 8px;color:#a8a29e;font-weight:600;">Overdue</th>
        </tr>
        ${gmPerformance.map((gm) => `
        <tr style="border-bottom:1px solid #292524;">
          <td style="padding:6px 8px;color:#fafaf9;">${gm.gmName ?? "—"}</td>
          <td style="padding:6px 8px;color:#a8a29e;">${gm.storeName}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:700;color:${gradeColor(gradeForScore(gm.executionScore))};">${gm.executionScore ?? "—"}</td>
          <td style="padding:6px 8px;text-align:right;color:${(gm.scoreDelta ?? 0) > 0 ? "#22c55e" : (gm.scoreDelta ?? 0) < 0 ? "#ef4444" : "#a8a29e"};">${gm.scoreDelta != null ? (gm.scoreDelta > 0 ? "+" : "") + gm.scoreDelta : "—"}</td>
          <td style="padding:6px 8px;text-align:right;color:#d6d3d1;">${pct(gm.completionRate)}</td>
          <td style="padding:6px 8px;text-align:right;color:${gm.overdueActions > 2 ? "#ef4444" : "#d6d3d1"};">${gm.overdueActions}</td>
        </tr>`).join("")}
      </table>
    </div>

    <!-- Impact Summary -->
    ${impactSummary.actionsWithImpact > 0 ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">Impact Generated</h2>
      <div style="background:#292524;border-radius:8px;padding:16px;">
        <div style="font-size:24px;font-weight:800;color:#22c55e;">${money(impactSummary.totalImpact)}</div>
        <div style="font-size:11px;color:#a8a29e;">from ${impactSummary.actionsWithImpact} measured action${impactSummary.actionsWithImpact !== 1 ? "s" : ""}</div>
        ${impactSummary.byCategory.length > 0 ? `
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          ${impactSummary.byCategory.slice(0, 5).map((c) => `
          <span style="background:#44403c;border-radius:4px;padding:2px 8px;font-size:11px;color:#d6d3d1;">
            ${c.category}: ${money(c.totalImpact)}
          </span>`).join("")}
        </div>` : ""}
      </div>
    </div>` : ""}

    <!-- Service Insights -->
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">Service Insights</h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:10px 12px;background:#292524;border-radius:8px 0 0 8px;">
            <div style="font-size:11px;color:#a8a29e;">Avg Spend</div>
            <div style="font-size:16px;font-weight:700;color:#fafaf9;">${money(serviceInsights.avgSpend)}</div>
            <div style="font-size:11px;color:${trendColor(serviceInsights.avgSpendTrend)};">${arrow(serviceInsights.avgSpendTrend)} prev: ${money(serviceInsights.avgSpendPrevWeek)}</div>
          </td>
          <td style="padding:10px 12px;background:#292524;">
            <div style="font-size:11px;color:#a8a29e;">Total Covers</div>
            <div style="font-size:16px;font-weight:700;color:#fafaf9;">${serviceInsights.totalCovers ?? "—"}</div>
            <div style="font-size:11px;color:#a8a29e;">prev: ${serviceInsights.coversPrevWeek ?? "—"}</div>
          </td>
          <td style="padding:10px 12px;background:#292524;border-radius:0 8px 8px 0;">
            <div style="font-size:11px;color:#a8a29e;">Avg Rating</div>
            <div style="font-size:16px;font-weight:700;color:#fafaf9;">${serviceInsights.avgRating?.toFixed(1) ?? "—"}</div>
            <div style="font-size:11px;color:${trendColor(serviceInsights.ratingTrend)};">${arrow(serviceInsights.ratingTrend)} prev: ${serviceInsights.ratingPrevWeek?.toFixed(1) ?? "—"}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Interventions -->
    ${interventionList.length > 0 ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">⚠ Interventions Required</h2>
      ${interventionList.slice(0, 8).map((item) => `
      <div style="background:${severityBg(item.severity)};border-radius:6px;padding:10px 12px;margin-bottom:6px;">
        <div style="font-size:12px;font-weight:600;color:#fafaf9;">${item.store} — ${item.issue}</div>
        <div style="font-size:11px;color:#d6d3d1;margin-top:2px;">→ ${item.recommendation}</div>
      </div>`).join("")}
    </div>` : ""}

    <!-- Next Week Focus -->
    ${nextWeekFocus.length > 0 ? `
    <div style="margin-top:28px;">
      <h2 style="font-size:15px;font-weight:700;color:#fafaf9;margin:0 0 12px;">🎯 Next Week Focus</h2>
      ${nextWeekFocus.map((f, i) => `
      <div style="padding:8px 0;${i < nextWeekFocus.length - 1 ? "border-bottom:1px solid #292524;" : ""}">
        <div style="font-size:12px;font-weight:600;color:#fafaf9;">${f.area}</div>
        <div style="font-size:11px;color:#a8a29e;">${f.description}</div>
      </div>`).join("")}
    </div>` : ""}

    <!-- Footer -->
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #44403c;text-align:center;">
      <p style="font-size:11px;color:#78716c;margin:0;">
        ${venueName} · ForgeStack Operating Brain · Report W${weekRange.weekNumber}/${weekRange.year}
      </p>
    </div>
  </div>
</body>
</html>`;
}

function gradeForScore(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ── Email Delivery ─────────────────────────────────────────────────────────────

export async function sendWeeklyReportEmail(
  report: WeeklyReport,
  recipients: string[],
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn("[WeeklyReport] RESEND_API_KEY not configured — skipping email");
    return false;
  }

  if (recipients.length === 0) {
    logger.warn("[WeeklyReport] No recipients — skipping email");
    return false;
  }

  const resend = new Resend(apiKey);
  const venueName = process.env.VENUE_NAME ?? "ForgeStack";
  const fromAddress = process.env.SMTP_FROM ?? `${venueName} <onboarding@resend.dev>`;
  const html = buildWeeklyReportEmail(report);

  try {
    await resend.emails.send({
      from: fromAddress,
      to: recipients,
      subject: `📊 Weekly Report W${report.weekRange.weekNumber} — ${venueName} (${report.weekRange.start} → ${report.weekRange.end})`,
      html,
    });
    logger.info("[WeeklyReport] Email sent", { recipients: recipients.length, week: report.weekRange.start });
    return true;
  } catch (err) {
    logger.error("[WeeklyReport] Email send failed", { err });
    return false;
  }
}
