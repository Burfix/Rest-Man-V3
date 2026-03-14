/**
 * POST /api/risk/recompute
 *
 * Triggers a full risk recomputation for all zones in the given site.
 * Writes results to risk_scores (upsert) and zone_snapshots (append).
 *
 * Auth: requires a valid Supabase session OR a bearer CRON_SECRET
 * so this endpoint can also be called as a Vercel cron job.
 *
 * Body (optional):
 *   { siteId?: string }   — defaults to DEFAULT_SITE_ID
 *
 * Response:
 *   { ok: true, zones: ZoneSummary[], computed_at: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getZoneSummaries } from "@/services/universal/zoneSummary";
import { DEFAULT_SITE_ID } from "@/types/universal";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth: session OR cron secret ────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron =
    authHeader === `Bearer ${process.env.CRON_SECRET}` &&
    !!process.env.CRON_SECRET;

  if (!isCron) {
    // Require a valid dashboard session
    const supabase = createServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Resolve site ────────────────────────────────────────────────────────
  let body: { siteId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — use default
  }
  const siteId = body.siteId ?? DEFAULT_SITE_ID;

  // ── Recompute ──────────────────────────────────────────────────────────
  try {
    const zones = await getZoneSummaries(siteId, true); // persist = true
    return NextResponse.json({
      ok: true,
      zones,
      zone_count: zones.length,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[POST /api/risk/recompute]", err);
    return NextResponse.json(
      { error: "Risk recomputation failed" },
      { status: 500 }
    );
  }
}
