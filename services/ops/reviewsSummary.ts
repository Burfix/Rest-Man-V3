/**
 * Reviews summary service — last 7 reviews analytics for the dashboard.
 */

import { createServerClient } from "@/lib/supabase/server";
import { Review, ReviewPlatform, SevenDayReviewSummary } from "@/types";

const PLATFORMS: ReviewPlatform[] = ["google"];

export async function getSevenDayReviewSummary(): Promise<SevenDayReviewSummary> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .order("review_date", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(`[OpsSvc/Reviews] ${error.message}`);
  }

  const reviews = (data ?? []) as Review[];

  const byPlatform = PLATFORMS.map((platform) => {
    const pr = reviews.filter((r) => r.platform === platform);
    const avg =
      pr.length > 0
        ? pr.reduce((s, r) => s + Number(r.rating), 0) / pr.length
        : 0;
    return {
      platform,
      averageRating: Math.round(avg * 10) / 10,
      count: pr.length,
      lowRated: pr.filter((r) => Number(r.rating) <= 3).length,
    };
  });

  const allRatings = reviews.map((r) => Number(r.rating));
  const overallAverage =
    allRatings.length > 0
      ? Math.round(
          (allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 10
        ) / 10
      : 0;

  return {
    byPlatform,
    overallAverage,
    totalReviews: reviews.length,
    positiveCount: reviews.filter((r) => r.sentiment === "positive").length,
    neutralCount: reviews.filter((r) => r.sentiment === "neutral").length,
    negativeCount: reviews.filter((r) => r.sentiment === "negative").length,
    // Flag any review with rating < 4 (regardless of the DB `flagged` field)
    flaggedReviews: reviews.filter((r) => Number(r.rating) < 4),
  };
}

/** Full review list for the /dashboard/reviews page */
export async function getAllReviews(limit = 100): Promise<Review[]> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .order("review_date", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`[OpsSvc/Reviews] ${error.message}`);
  }

  return (data ?? []) as Review[];
}
