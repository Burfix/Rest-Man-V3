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
 *   { siteId?: string }   — required; returns 400 if missing
 *
 * Response:
 *   { ok: true, zones: ZoneSummary[], computed_at: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/get-user-context";
import { getZoneSummaries } from "@/services/universal/zoneSummary";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth: session OR cron secret ────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron =
    authHeader === `Bearer ${process.env.CRON_SECRET}` &&
    !!process.env.CRON_SECRET;

  if (!isCron) {
    // Require a valid dashboard session — use getUser() (server-validated), never getSession()
    try {
      const userCtx = await getUserContext();
      // Validate siteId ownership (resolved after body parse below)
      // Store for post-parse check
      (req as unknown as { _userCtx: typeof userCtx })._userCtx = userCtx;
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Resolve site ────────────────────────────────────────────────────────
  let body: { siteId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body — will fail siteId check below
  }
  const siteId = body.siteId;
  if (!siteId) {
    return NextResponse.json(
      { error: "siteId is required in request body" },
      { status: 400 }
    );
  }

  // TENANT GUARD: non-cron callers must own the requested site
  if (!isCron) {
    const userCtx = (req as unknown as { _userCtx?: { siteIds: string[] } })._userCtx;
    if (!userCtx || !userCtx.siteIds.includes(siteId)) {
      return NextResponse.json(
        { error: "Access denied: you do not have access to this site" },
        { status: 403 }
      );
    }
  }

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
