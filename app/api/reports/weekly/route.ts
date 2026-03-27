/**
 * Weekly Performance Report API
 *
 * POST — manual trigger (authenticated, VIEW_ALL_STORES permission)
 * GET  — Vercel Cron trigger (CRON_SECRET bearer auth)
 *
 * Both generate the weekly report for the org and optionally send email.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { generateWeeklyReport } from "@/services/reports/weeklyReport";
import { sendWeeklyReportEmail } from "@/services/reports/weeklyReportEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// ── POST: manual trigger ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = await apiGuard(PERMISSIONS.VIEW_ALL_STORES, "POST /api/reports/weekly");
  if (guard.error) return guard.error;

  const orgId = guard.ctx!.orgId;
  if (!orgId) {
    return NextResponse.json({ error: "No organisation context" }, { status: 400 });
  }

  let sendEmail = false;
  let recipients: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    sendEmail = body.sendEmail === true;
    if (Array.isArray(body.recipients)) {
      recipients = body.recipients.filter((r: unknown) => typeof r === "string" && r.includes("@"));
    }
  } catch { /* body is optional */ }

  try {
    const report = await generateWeeklyReport(orgId);

    let emailSent = false;
    if (sendEmail && recipients.length > 0) {
      emailSent = await sendWeeklyReportEmail(report, recipients);
    }

    return NextResponse.json({
      ok: true,
      report,
      emailSent,
      source: "manual",
      generatedAt: report.generatedAt,
    });
  } catch (err) {
    logger.error("[WeeklyReport] Manual trigger failed", { err });
    return NextResponse.json({ error: "Report generation failed" }, { status: 500 });
  }
}

// ── GET: Vercel Cron ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all active organisations
    const { createServerClient } = await import("@/lib/supabase/server");
    const supabase = createServerClient();
    const { data: orgs } = await supabase
      .from("organisations")
      .select("id")
      .eq("is_active", true);

    const orgIds = (orgs ?? []).map((o: { id: string }) => o.id);
    if (orgIds.length === 0) {
      // Fallback to env var for backward-compat
      const envOrg = process.env.DEFAULT_ORG_ID;
      if (envOrg) orgIds.push(envOrg);
    }

    if (orgIds.length === 0) {
      logger.warn("[WeeklyReport] No active organisations found — skipping cron");
      return NextResponse.json({ ok: false, message: "No active organisations" });
    }

    const results: { orgId: string; week: number; emailSent: boolean }[] = [];

    for (const orgId of orgIds) {
      try {
        const report = await generateWeeklyReport(orgId);

        // Send to configured recipients
        const recipientEnv = process.env.WEEKLY_REPORT_RECIPIENTS ?? process.env.RESTAURANT_EMAIL ?? "";
        const recipients = recipientEnv.split(",").map((e) => e.trim()).filter(Boolean);

        let emailSent = false;
        if (recipients.length > 0) {
          emailSent = await sendWeeklyReportEmail(report, recipients);
        }

        logger.info("[WeeklyReport] Cron completed for org", {
          orgId,
          week: report.weekRange.weekNumber,
          emailSent,
          recipients: recipients.length,
        });

        results.push({ orgId, week: report.weekRange.weekNumber, emailSent });
      } catch (err) {
        logger.error("[WeeklyReport] Cron failed for org", { orgId, err });
      }
    }

    return NextResponse.json({
      ok: true,
      orgs_processed: results.length,
      results,
      source: "cron",
    });
  } catch (err) {
    logger.error("[WeeklyReport] Cron failed", { err });
    return NextResponse.json({ ok: false, error: "Report generation failed" }, { status: 500 });
  }
}
