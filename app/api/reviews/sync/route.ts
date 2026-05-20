import { NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth/api-guard";
import { logger } from "@/lib/logger";
import { PERMISSIONS } from "@/lib/rbac/roles";
import { getGoogleLiveReviews } from "@/services/ops/googleReviews";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await apiGuard(PERMISSIONS.RESPOND_TO_REVIEWS, "POST /api/reviews/sync");
  if (guard.error) return guard.error;
  const { ctx, supabase } = guard;

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return NextResponse.json({
      ok: true,
      synced: 0,
      message: "Google Places API key not configured. Add reviews manually.",
    });
  }

  try {
    const live = await getGoogleLiveReviews();
    if (!live || live.reviews.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: "No reviews found from Google." });
    }

    let synced = 0;
    for (const r of live.reviews) {
      const reviewerName = r.author_name ?? "Anonymous";
      const reviewDate = r.time
        ? new Date(r.time * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      // Check if this review already exists to avoid duplicates
      const { data: existing } = await supabase
        .from("reviews")
        .select("id")
        .eq("site_id", ctx.siteId)
        .eq("platform", "google")
        .eq("review_date", reviewDate)
        .eq("reviewer_name", reviewerName)
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      const { error } = await supabase
        .from("reviews")
        .insert({
          site_id: ctx.siteId,
          platform: "google",
          review_date: reviewDate,
          rating: r.rating ?? 0,
          reviewer_name: reviewerName,
          review_text: r.text ?? null,
          sentiment: (r.rating ?? 0) >= 4 ? "positive" : (r.rating ?? 0) === 3 ? "neutral" : "negative",
          tags: [],
          flagged: (r.rating ?? 0) < 4,
        });

      if (error) {
        logger.warn("Review upsert failed", { reviewer: reviewerName, error: error.message });
      } else {
        synced++;
      }
    }

    logger.info("Reviews synced from Google", { siteId: ctx.siteId, synced, total: live.reviews.length });
    return NextResponse.json({
      ok: true,
      synced,
      total: live.reviews.length,
      placeName: live.placeName,
      overallRating: live.overallRating,
    });
  } catch (err) {
    logger.error("Google reviews sync failed", { route: "POST /api/reviews/sync", err });
    return NextResponse.json({ ok: false, error: "Failed to sync Google reviews" }, { status: 500 });
  }
}
