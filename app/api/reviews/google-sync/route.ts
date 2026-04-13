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
import { getPlaceDetails } from "@/lib/google-places";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Shared types ───────────────────────────────────────────────────────────────

export interface GoogleSyncReview {
  id: string;
  rating: number;
  reviewerName: string;
  reviewerPhoto: string | null;
  text: string;
  date: string; // relative time, e.g. "2 days ago"
  platform: "google";
}

export interface GoogleSyncResult {
  connected: boolean;
  totalRating: number;
  totalCount: number;
  reviews: GoogleSyncReview[];
}

// ── Core sync logic (shared with Reviews page server component) ────────────────

export async function syncSiteReviews(
  supabase: ReturnType<typeof createServerClient>,
  siteId: string,
): Promise<GoogleSyncResult> {
  const { data: site } = await supabase
    .from("sites")
    .select("google_place_id")
    .eq("id", siteId)
    .single();

  const placeId = site?.google_place_id ?? null;

  if (!placeId) {
    return { connected: false, totalRating: 0, totalCount: 0, reviews: [] };
  }

  const details = await getPlaceDetails(placeId);
  if (!details) {
    return { connected: false, totalRating: 0, totalCount: 0, reviews: [] };
  }

  // Upsert reviews — ON CONFLICT (google_review_id) DO UPDATE
  for (const r of details.reviews) {
    const googleReviewId = `${placeId}:${r.time}`;
    const reviewDate = r.time
      ? new Date(r.time * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const sentiment: "positive" | "neutral" | "negative" =
      r.rating >= 4 ? "positive" : r.rating === 3 ? "neutral" : "negative";

    const { error } = await supabase.from("reviews").upsert(
      {
        site_id: siteId,
        platform: "google" as const,
        rating: r.rating,
        reviewer_name: r.author_name || "Anonymous",
        review_text: r.text || null,
        review_date: reviewDate,
        google_review_id: googleReviewId,
        reviewer_photo: r.profile_photo_url || null,
        source: "google_api",
        sentiment,
        tags: [],
        flagged: r.rating < 4,
      },
      { onConflict: "google_review_id" },
    );

    if (error) {
      logger.warn("Review upsert failed", {
        siteId,
        googleReviewId,
        code: error.code,
        msg: error.message,
      });
    }
  }

  return {
    connected: true,
    totalRating: details.rating,
    totalCount: details.user_ratings_total,
    reviews: details.reviews.map(
      (r): GoogleSyncReview => ({
        id: `${placeId}:${r.time}`,
        rating: r.rating,
        reviewerName: r.author_name || "Anonymous",
        reviewerPhoto: r.profile_photo_url || null,
        text: r.text || "",
        date: r.relative_time_description,
        platform: "google",
      }),
    ),
  };
}

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

    const { data: sites, error: sitesError } = await supabase
      .from("sites")
      .select("id, name")
      .not("google_place_id", "is", null);

    if (sitesError) {
      logger.error("Failed to fetch sites for google-sync", { err: sitesError });
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }

    if (!sites?.length) {
      return NextResponse.json({
        ok: true,
        synced: 0,
        message: "No sites with google_place_id configured.",
      });
    }

    let synced = 0;
    const errors: string[] = [];
    for (const site of sites) {
      try {
        const result = await syncSiteReviews(supabase, site.id);
        if (result.connected) synced++;
      } catch (err) {
        logger.error("Google sync failed for site", { siteId: site.id, err });
        errors.push(site.id);
      }
    }

    logger.info("Cron: Google reviews synced", { synced, total: sites.length });
    return NextResponse.json({ ok: true, synced, total: sites.length, errors });
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
