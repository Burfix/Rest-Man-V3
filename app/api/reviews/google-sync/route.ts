/**
 * GET /api/reviews/google-sync
 *
 * Fetches live Google reviews via Places API (New), upserts them into the
 * reviews table, and returns structured review data.
 *
 * Query params:
 *   ?siteId=<uuid>  – sync a specific site (requires user session)
 *   ?siteId=ALL     – sync all sites with a google_place_id (requires CRON_SECRET)
 *
 * Security: GOOGLE_PLACES_API_KEY is server-side only — never sent to client.
 */

import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { createServerClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { syncSiteReviews, syncAllSiteReviews } from "@/services/reviews/googleSync";
import type { GoogleSyncReview, GoogleSyncResult } from "@/services/reviews/googleSync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Re-export types for components that import them from this route path
export type { GoogleSyncReview, GoogleSyncResult };

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const siteIdParam = req.nextUrl.searchParams.get("siteId");

  // ── ALL-sites cron path — requires CRON_SECRET ─────────────────────────────
  if (siteIdParam === "ALL") {
    const cronSecret = process.env.CRON_SECRET;
    if (
      !cronSecret ||
      req.headers.get("authorization") !== `Bearer ${cronSecret}`
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServerClient();

    try {
      const { synced, total, errors } = await syncAllSiteReviews(supabase);

      if (total === 0) {
        return NextResponse.json({
          ok: true, synced: 0, message: "No sites with google_place_id configured.",
        });
      }

      logger.info("Cron: Google reviews synced", { synced, total });
      return NextResponse.json({ ok: true, synced, total, errors });
    } catch (err) {
      logger.error("Failed to sync all sites for google-sync", { err });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
  }

  // ── Single-site user-triggered path — requires user session ───────────────
  const guard = await apiGuard(
    PERMISSIONS.RESPOND_TO_REVIEWS,
    "GET /api/reviews/google-sync",
  );
  if (guard.error) return guard.error;

  const { ctx, supabase } = guard;
  const siteId = siteIdParam ?? ctx.siteId;

  try {
    const result = await syncSiteReviews(supabase, siteId);
    return NextResponse.json(result);
  } catch (err) {
    logger.error("Google reviews sync failed", {
      route: "GET /api/reviews/google-sync",
      err,
    });
    return NextResponse.json(
      { error: "Failed to sync Google reviews" },
      { status: 500 },
    );
  }
}
