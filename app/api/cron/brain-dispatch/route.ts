/**
 * app/api/cron/brain-dispatch/route.ts
 *
 * POST /api/cron/brain-dispatch
 *
 * Vercel Cron — runs every 30 minutes.
 * Authentication: Bearer CRON_SECRET
 *
 * For each active site:
 *   1. Runs the operating brain (caller="scheduler" → bypasses all caches)
 *   2. Passes BrainOutput to dispatchBrainAlerts()
 *   3. dispatchBrainAlerts() sends WhatsApp alerts to eligible managers
 *      if the threat meets the severity threshold AND has not been sent
 *      within the last 2 hours (site-level dedup).
 *
 * This is the ONLY path that triggers automated WhatsApp alerts.
 * The brain's alertNeeded flag is evaluated here — not on page load or
 * API responses — so users browsing the dashboard never trigger sends.
 *
 * Usage (Vercel Cron):
 *   vercel.json → "path": "/api/cron/brain-dispatch", "schedule": "*\/30 * * * *"
 *
 * Manual test:
 *   curl -X POST https://<host>/api/cron/brain-dispatch \
 *     -H "Authorization: Bearer <CRON_SECRET>"
 */

import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { cronGuard } from "@/lib/auth/cron-guard";
import { createServerClient } from "@/lib/supabase/server";
import { runOperatingBrain } from "@/services/brain/operating-brain";
import { dispatchBrainAlerts, type BrainDispatchResult } from "@/services/brain/alert-dispatcher";
import { logger } from "@/lib/logger";
import { todayISO } from "@/lib/utils";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 60; // Vercel Pro allows up to 300s

// ── Types ─────────────────────────────────────────────────────────────────────

interface SiteResult {
  siteId:   string;
  ok:       boolean;
  brain?:   { alertNeeded: boolean; severity: string; title: string };
  dispatch?: BrainDispatchResult;
  error?:   string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = cronGuard(req, "POST /api/cron/brain-dispatch");
  if (denied) return denied;

  const startedAt = Date.now();
  const today     = todayISO();

  logger.info("[brain-dispatch] cron started", { today });

  // 1. Resolve all active sites
  let sites: { id: string }[] = [];
  try {
    const db = createServerClient();
    const { data, error } = await db
      .from("sites")
      .select("id")
      .eq("active", true);

    if (error) throw new Error(error.message);
    sites = (data ?? []) as { id: string }[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[brain-dispatch] failed to resolve active sites", { error: msg });
    Sentry.captureException(err, {
      tags: { route: "POST /api/cron/brain-dispatch", phase: "site_resolution" },
    });
    return NextResponse.json(
      { ok: false, error: "Could not resolve active sites", detail: msg },
      { status: 500 },
    );
  }

  if (sites.length === 0) {
    logger.warn("[brain-dispatch] no active sites found");
    return NextResponse.json({ ok: true, sites: [], durationMs: Date.now() - startedAt });
  }

  // 2. Run brain + dispatch per site (sequential to respect rate limits on
  //    WhatsApp provider — parallel would risk hitting Twilio/Meta rate limits
  //    if there are many sites all firing at once)
  const results: SiteResult[] = [];

  for (const site of sites) {
    const siteId = site.id;
    const siteStart = Date.now();

    try {
      // caller="scheduler" bypasses both L1 (in-memory) and L2 (Redis) caches
      // so we always get a fresh evaluation, not whatever the last dashboard
      // load cached.
      const brain = await runOperatingBrain(siteId, today, { caller: "scheduler" });

      const brainSummary = {
        alertNeeded: (["critical", "high"] as const).includes(brain.primaryThreat.severity),
        severity:    brain.primaryThreat.severity,
        title:       brain.primaryThreat.title,
      };

      logger.info("[brain-dispatch] brain evaluated", {
        siteId,
        ...brainSummary,
        durationMs: Date.now() - siteStart,
      });

      const dispatch = await dispatchBrainAlerts(brain, siteId);

      results.push({ siteId, ok: true, brain: brainSummary, dispatch });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[brain-dispatch] site failed", { siteId, error: msg });
      Sentry.captureException(err, {
        tags: { route: "POST /api/cron/brain-dispatch", siteId },
      });
      results.push({ siteId, ok: false, error: msg });
    }
  }

  const totalDurationMs = Date.now() - startedAt;
  const dispatched      = results.filter((r) => r.dispatch?.outcome === "dispatched").length;
  const failed          = results.filter((r) => !r.ok).length;

  logger.info("[brain-dispatch] cron complete", {
    sites:   sites.length,
    dispatched,
    failed,
    durationMs: totalDurationMs,
  });

  return NextResponse.json({
    ok:         true,
    today,
    sites:      results,
    summary:    { total: sites.length, dispatched, failed },
    durationMs: totalDurationMs,
  });
}
