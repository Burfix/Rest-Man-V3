/**
 * services/reviews/googleSync.ts
 *
 * Core Google Reviews sync logic, shared between:
 *  - app/api/reviews/google-sync/route.ts (HTTP trigger)
 *  - lib/scheduler/async-scheduler.ts      (queue worker)
 *
 * All Places API calls and DB upserts live here. The route and worker are
 * thin callers with their own auth and error-handling concerns.
 */

import { createServerClient } from "@/lib/supabase/server";
import { getPlaceDetails } from "@/lib/google-places";
import { logger } from "@/lib/logger";

// ── Public types ──────────────────────────────────────────────────────────────

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

// ── Core sync function ────────────────────────────────────────────────────────

/**
 * Fetch live reviews for a single site and upsert them into the reviews table.
 */
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

  for (const r of details.reviews) {
    const googleReviewId = `${placeId}:${r.time}`;
    const reviewDate = r.time
      ? new Date(r.time * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const sentiment: "positive" | "neutral" | "negative" =
      r.rating >= 4 ? "positive" : r.rating === 3 ? "neutral" : "negative";

    const { error } = await supabase.from("reviews").upsert(
      {
        site_id:          siteId,
        platform:         "google" as const,
        rating:           r.rating,
        reviewer_name:    r.author_name || "Anonymous",
        review_text:      r.text || null,
        review_date:      reviewDate,
        google_review_id: googleReviewId,
        reviewer_photo:   r.profile_photo_url || null,
        source:           "google_api",
        sentiment,
        tags:             [],
        flagged:          r.rating < 4,
      },
      { onConflict: "google_review_id" },
    );

    if (error) {
      logger.warn("google_sync.upsert_failed", {
        siteId,
        googleReviewId,
        code: error.code,
        msg:  error.message,
      });
    }
  }

  return {
    connected:   true,
    totalRating: details.rating,
    totalCount:  details.user_ratings_total,
    reviews: details.reviews.map(
      (r): GoogleSyncReview => ({
        id:            `${placeId}:${r.time}`,
        rating:        r.rating,
        reviewerName:  r.author_name || "Anonymous",
        reviewerPhoto: r.profile_photo_url || null,
        text:          r.text || "",
        date:          r.relative_time_description,
        platform:      "google",
      }),
    ),
  };
}

/**
 * Sync all sites that have a google_place_id configured.
 * Returns { synced, total, errors }.
 */
export async function syncAllSiteReviews(
  supabase: ReturnType<typeof createServerClient>,
): Promise<{ synced: number; total: number; errors: string[] }> {
  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("id, name")
    .not("google_place_id", "is", null);

  if (sitesError) {
    throw new Error(`Failed to fetch sites: ${sitesError.message}`);
  }

  if (!sites?.length) {
    return { synced: 0, total: 0, errors: [] };
  }

  let synced = 0;
  const errors: string[] = [];

  for (const site of sites) {
    try {
      const result = await syncSiteReviews(supabase, site.id);
      if (result.connected) synced++;
    } catch (err) {
      logger.error("google_sync.site_failed", { siteId: site.id, err });
      errors.push(site.id);
    }
  }

  return { synced, total: sites.length, errors };
}
