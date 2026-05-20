/**
 * POST /api/alerts/run
 *
 * Triggers the operational alerts engine on demand.
 * Protected by a shared secret header (ALERTS_CRON_SECRET).
 *
 * Called automatically by Vercel Cron (every 30 minutes).
 * Configure in vercel.json:
 *
 *   "crons": [
 *     {
 *       "path": "/api/alerts/run",
 *       "schedule": "*\/30 * * * *"
 *     }
 *   ]
 *
 * Vercel sets the Authorization header to "Bearer <CRON_SECRET>"
 * automatically for cron invocations when CRON_SECRET env var is set.
 *
 * For local/manual testing:
 *   curl -X POST http://localhost:3000/api/alerts/run \
 *     -H "Authorization: Bearer <ALERTS_CRON_SECRET>"
 */

import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { runAlertsEngine } from "@/services/alerts/engine";
import { getAllLocationConfigs } from "@/lib/micros/micros-location-registry";
import { cronGuard } from "@/lib/auth/cron-guard";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // Vercel Pro: up to 300s; Hobby: 10s

export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = cronGuard(req, "POST /api/alerts/run");
  if (denied) return denied;

  try {
    // Resolve all registered sites and run alerts engine per site (tenant isolation)
    const supabase = createServerClient();
    const { data: sites, error: sitesErr } = await (supabase as any)
      .from("sites")
      .select("id")
      .eq("active", true);

    if (sitesErr || !sites?.length) {
      return NextResponse.json({ ok: false, error: "Could not resolve active sites" }, { status: 500 });
    }

    const results = await Promise.allSettled(
      (sites as { id: string }[]).map((s) => runAlertsEngine(s.id))
    );

    const summary = results.map((r, i) =>
      r.status === "fulfilled"
        ? { siteId: sites[i].id, ok: true, ...r.value }
        : { siteId: sites[i].id, ok: false, error: String((r as PromiseRejectedResult).reason) }
    );

    return NextResponse.json({ ok: true, sites: summary });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "POST /api/alerts/run", trigger: "cron" } });
    console.error("[POST /api/alerts/run]", err);
    return NextResponse.json(
      { error: "Alerts engine failed", detail: String(err) },
      { status: 500 }
    );
  }
}
